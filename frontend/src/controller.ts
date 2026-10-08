import { api, ApiError } from "./api";
import { blankMessage, errorText, runTurn } from "./agent/loop";
import { buildSystemPrompt, type PromptContext } from "./agent/system-prompt";
import { openAiTools } from "./agent/tool-defs";
import type { StreamDelta } from "./agent/sse";
import * as dom from "./forge/dom";
import * as forgeTools from "./forge/tools";
import { app, PAGE_SIZE, rememberedModel, rememberedSession, rememberModel, rememberSession, saveEfforts } from "./state.svelte";
import type { AttachmentRef, Message, ToolCall } from "./types";
import { zh } from "./zh";

const BROWSER_TOOLS = new Set(["read_prompt", "edit_prompt", "read_generation_parameters", "set_generation_parameters", "read_latest_image"]);
const IMAGE_CACHE_LIMIT = 12;

let abort: AbortController | null = null;
let promptContext: PromptContext | null = null;
let writeChain: Promise<unknown> = Promise.resolve();
/** Resolves once the open session's full history is loaded; turns wait for it so context is complete. */
let historyReady: Promise<void> = Promise.resolve();
const imageCache = new Map<string, string>();
let pendingDelta: StreamDelta = { content: "", reasoning: "" };
let deltaFrame = 0;

const newId = () => `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function notify(text: string): void {
  app.notice = text;
}

// -- messages ------------------------------------------------------------------------

function replaceMessage(message: Message): void {
  const index = app.messages.findIndex((m) => m.id === message.id);
  if (index === -1) app.messages = [...app.messages, message];
  else {
    const next = app.messages.slice();
    next[index] = message;
    app.messages = next;
  }
}

function persist(message: Message): void {
  const sessionId = app.sessionId;
  if (!sessionId) return;
  // writes are serialized so the server assigns seq in creation order
  writeChain = writeChain
    .then(() => api.putMessage(sessionId, message))
    .then(({ seq }) => {
      const current = app.messages.find((m) => m.id === message.id);
      if (current && current.seq !== seq && app.sessionId === sessionId) replaceMessage({ ...current, seq });
    })
    .catch((error) => notify(`${zh.saveFailed}：${errorText(error)}`));
}

function flushDelta(): void {
  deltaFrame = 0;
  if (!pendingDelta.content && !pendingDelta.reasoning) return;
  app.live.content += pendingDelta.content;
  app.live.reasoning += pendingDelta.reasoning;
  pendingDelta = { content: "", reasoning: "" };
}

function onDelta(messageId: string, delta: StreamDelta): void {
  if (app.live.id !== messageId) {
    flushDelta();
    app.live.id = messageId;
    app.live.content = "";
    app.live.reasoning = "";
  }
  pendingDelta.content += delta.content;
  pendingDelta.reasoning += delta.reasoning;
  if (!deltaFrame) deltaFrame = requestAnimationFrame(flushDelta);
}

async function imageDataUrl(attachmentId: string): Promise<string> {
  const cached = imageCache.get(attachmentId);
  if (cached) return cached;
  const response = await fetch(api.modelImageUrl(attachmentId), { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, "ATTACHMENT", zh.attachmentMissing);
  const blob = await response.blob();
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  imageCache.set(attachmentId, url);
  if (imageCache.size > IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value!);
  return url;
}

async function executeTool(call: ToolCall, signal: AbortSignal) {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments || "{}");
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error();
  } catch {
    return { result: { ok: false, error: { code: "INVALID_ARGS", message: "参数不是合法的 JSON 对象" } } };
  }
  if (BROWSER_TOOLS.has(call.name)) {
    switch (call.name) {
      case "read_prompt":
        return forgeTools.readPrompt(args);
      case "edit_prompt":
        return forgeTools.editPrompt(args);
      case "read_generation_parameters":
        return forgeTools.readParams(args);
      case "set_generation_parameters":
        return forgeTools.setParams(args);
      default:
        return forgeTools.readLatestImage(args, app.sessionId!, signal);
    }
  }
  const result = await api.tool(call.name, args, signal);
  const wantsImage = call.name === "read_attachment" && result.ok && args.include_image === true && app.model?.vision;
  return { result, imageAttachmentId: wantsImage ? String(args.attachment_id) : undefined };
}

// -- sessions -------------------------------------------------------------------------

export async function refreshSessions(): Promise<void> {
  app.sessions = (await api.sessions()).sessions;
}

export async function openSession(id: string | null): Promise<void> {
  if (app.busy) return;
  app.view = "chat";
  app.sessionId = id;
  app.messages = [];
  app.visibleCount = PAGE_SIZE;
  app.drafts = [];
  app.live.id = "";
  rememberSession(id);
  if (!id) {
    ({ profileId: app.draftProfileId, model: app.draftModel } = rememberedModel());
    return;
  }
  try {
    // show the latest page at once, then fetch older history in the background
    const first = await api.messages(id);
    if (app.sessionId !== id) return;
    app.messages = first.messages;
    historyReady = (async () => {
      let page = first;
      let older: Message[] = [];
      while (page.has_more) {
        const oldest = (older[0] ?? first.messages[0])?.seq;
        if (!oldest) break;
        page = await api.messages(id, oldest, 500);
        older = [...page.messages, ...older];
      }
      if (older.length && app.sessionId === id) app.messages = [...older, ...app.messages];
    })().catch((error) => notify(errorText(error)));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      app.sessionId = null;
      rememberSession(null);
      await refreshSessions();
    } else notify(errorText(error));
  }
}

async function ensureSession(firstText: string): Promise<string> {
  if (app.sessionId) {
    const session = app.session;
    if (session && !session.title && firstText) {
      const updated = await api.updateSession(session.id, { title: titleFrom(firstText) });
      app.sessions = app.sessions.map((s) => (s.id === updated.id ? updated : s));
    }
    return app.sessionId;
  }
  const session = await api.createSession({ title: titleFrom(firstText), profile_id: app.profileId || null, model: app.model?.id ?? null });
  app.sessions = [session, ...app.sessions];
  app.sessionId = session.id;
  app.draftProfileId = null;
  app.draftModel = null;
  rememberSession(session.id);
  return session.id;
}

function titleFrom(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 24);
}

export async function renameSession(id: string, title: string): Promise<void> {
  const updated = await api.updateSession(id, { title });
  app.sessions = app.sessions.map((s) => (s.id === id ? updated : s));
}

export async function deleteSession(id: string): Promise<void> {
  await api.deleteSession(id);
  app.sessions = app.sessions.filter((s) => s.id !== id);
  if (app.sessionId === id) await openSession(null);
}

export function chooseEffort(effort: string): void {
  const key = `${app.profileId}/${app.model?.id ?? ""}`;
  const { [key]: _old, ...rest } = app.efforts;
  app.efforts = effort ? { ...rest, [key]: effort } : rest;
  saveEfforts(app.efforts);
}

export async function chooseModel(profileId: string, model: string): Promise<void> {
  rememberModel(profileId, model);
  if (app.sessionId) {
    const updated = await api.updateSession(app.sessionId, { profile_id: profileId, model });
    app.sessions = app.sessions.map((s) => (s.id === updated.id ? updated : s));
  } else {
    app.draftProfileId = profileId;
    app.draftModel = model;
  }
}

// -- turns ----------------------------------------------------------------------------

async function startTurn(): Promise<void> {
  const profile = app.profile;
  const model = app.model;
  if (!profile || !model) {
    notify(zh.noProfile);
    return;
  }
  abort = new AbortController();
  app.lastError = false;
  const signal = abort.signal;
  try {
    await historyReady;
    // refetched every turn: the memory file may have changed (agent edits, settings, or by hand)
    promptContext = (await api.context().catch(() => null)) ?? promptContext;
    await runTurn(
      {
        history: () => app.messages,
        add: (message) => replaceMessage(message),
        update: (message, save) => {
          if (message.status !== "streaming" && app.live.id === message.id) {
            flushDelta();
            app.live.id = "";
          }
          replaceMessage(message);
          if (save) persist(message);
          if (message.status === "error") app.lastError = true;
        },
        delta: onDelta,
        setState: (state, note) => {
          app.turn = state;
          app.turnNote = note ?? "";
        },
        chat: (body, s) => api.chat(body, s),
        executeTool,
        imageUrl: imageDataUrl,
        newId,
        profileId: profile.id,
        model: model.id,
        reasoningEffort: app.effort,
        vision: model.vision,
        systemPrompt: buildSystemPrompt(promptContext),
        tools: openAiTools(),
      },
      signal,
    );
  } finally {
    abort = null;
    app.turn = "idle";
    app.turnNote = "";
  }
}

export async function send(text: string): Promise<boolean> {
  const content = text.trim();
  const attachments: AttachmentRef[] = app.drafts.map(({ id, width, height }) => ({ id, width, height }));
  if (app.busy || (!content && !attachments.length)) return false;
  if (!app.model) {
    notify(zh.noProfile);
    return false;
  }
  try {
    await ensureSession(content || zh.imageOnlyTitle);
  } catch (error) {
    notify(errorText(error));
    return false;
  }
  const message = blankMessage(newId(), "user", { content, attachments: attachments.length ? attachments : null });
  app.drafts = [];
  replaceMessage(message);
  persist(message);
  void startTurn();
  return true;
}

export function stop(): void {
  abort?.abort();
}

/** Resend from a user message: drop it and everything after, then send `text` with its attachments. */
export async function editAndResend(messageId: string, text: string): Promise<void> {
  const index = app.messages.findIndex((m) => m.id === messageId);
  const message = app.messages[index];
  if (app.busy || !message || !app.sessionId) return;
  await writeChain;
  const seq = app.messages[index].seq;
  if (seq) await api.deleteMessagesFrom(app.sessionId, seq);
  app.messages = app.messages.slice(0, index);
  app.drafts = message.attachments ?? [];
  await send(text);
}

/** Re-run the last turn after an error: keep the user message, drop the failed replies. */
export async function retry(): Promise<void> {
  if (app.busy || !app.sessionId) return;
  const lastUser = app.messages.map((m) => m.role).lastIndexOf("user");
  if (lastUser === -1) return;
  await writeChain;
  const next = app.messages[lastUser + 1];
  if (next?.seq) await api.deleteMessagesFrom(app.sessionId, next.seq);
  app.messages = app.messages.slice(0, lastUser + 1);
  void startTurn();
}

// -- attachments ----------------------------------------------------------------------

export async function addAttachment(blob: Blob): Promise<void> {
  if (app.drafts.length >= 4) {
    notify(zh.tooManyImages);
    return;
  }
  if (blob.size > 10 * 1024 * 1024) {
    notify(zh.imageTooLarge);
    return;
  }
  try {
    const sessionId = await ensureSession("");
    const saved = await api.upload(sessionId, blob);
    app.drafts = [...app.drafts, { id: saved.id, width: saved.width, height: saved.height }];
  } catch (error) {
    notify(errorText(error));
  }
}

export async function attachLatestOutput(): Promise<void> {
  const target = dom.activeTarget() ?? "txt2img";
  const blob = await forgeTools.latestImageBlob(target).catch(() => null);
  if (!blob) {
    notify(zh.noOutput);
    return;
  }
  await addAttachment(blob);
}

export function removeDraft(id: string): void {
  app.drafts = app.drafts.filter((d) => d.id !== id);
}

// -- profiles and boot ------------------------------------------------------------------

export async function refreshProfiles(): Promise<void> {
  const result = await api.profiles();
  app.profiles = result.profiles;
  app.defaultProfileId = result.default_id;
  if (result.import_report) app.importNote = zh.importReport(result.import_report.imported, result.import_report.skipped);
}

export async function boot(): Promise<void> {
  try {
    await api.recover();
    await Promise.all([refreshProfiles(), refreshSessions(), api.settings().then((s) => (app.settings = s))]);
    const remembered = rememberedSession();
    const target = app.sessions.find((s) => s.id === remembered)?.id ?? app.sessions[0]?.id ?? null;
    await openSession(target);
  } catch (error) {
    notify(errorText(error));
  }
}

export function onPanelFocus(): void {
  if (!app.busy) void refreshSessions().catch(() => {});
}
