import type { Message, Profile, Session, Settings, ToolResult } from "./types";

const BASE = "/prompt-agent/v2";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function errorFrom(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    return new ApiError(response.status, body?.error?.code ?? "HTTP", body?.error?.message ?? `HTTP ${response.status}`);
  } catch {
    return new ApiError(response.status, "HTTP", `HTTP ${response.status}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(BASE + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

export const api = {
  profiles: () => call<{ profiles: Profile[]; default_id: string; import_report: { imported: number; skipped: number } | null }>("GET", "/profiles"),
  saveProfile: (id: string | null, body: Record<string, unknown>) => call<Profile>("PUT", `/profiles/${id ?? "new"}`, body),
  deleteProfile: (id: string) => call("DELETE", `/profiles/${id}`),
  setDefaultProfile: (id: string) => call("PUT", "/profiles/default", { id }),
  listModels: (id: string) => call<{ models: string[] }>("POST", `/profiles/${id}/models`),
  countTokens: (profileId: string, model: string, text: string) => call<{ tokens: number }>("POST", "/tokens", { profile_id: profileId, model, text }),
  settings: () => call<Settings>("GET", "/settings"),
  saveSettings: (body: Record<string, unknown>) => call<Settings>("PUT", "/settings", body),

  sessions: () => call<{ sessions: Session[] }>("GET", "/sessions"),
  createSession: (body: { id?: string; title?: string; profile_id?: string | null; model?: string | null }) => call<Session>("POST", "/sessions", body),
  updateSession: (id: string, body: { title?: string; profile_id?: string | null; model?: string | null }) => call<Session>("PATCH", `/sessions/${id}`, body),
  deleteSession: (id: string) => call("DELETE", `/sessions/${id}`),
  recover: () => call<{ recovered: number }>("POST", "/sessions/recover"),
  messages: (id: string, beforeSeq?: number, limit = 60) =>
    call<{ messages: Message[]; has_more: boolean }>("GET", `/sessions/${id}/messages?limit=${limit}${beforeSeq ? `&before_seq=${beforeSeq}` : ""}`),
  putMessage: (sessionId: string, message: Message) =>
    call<{ seq: number }>("PUT", `/sessions/${sessionId}/messages/${message.id}`, message),
  deleteMessagesFrom: (sessionId: string, fromSeq: number) => call("DELETE", `/sessions/${sessionId}/messages?from_seq=${fromSeq}`),

  async upload(sessionId: string, blob: Blob) {
    const response = await fetch(`${BASE}/attachments?session_id=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as { id: string; width: number; height: number; pnginfo: Record<string, unknown> };
  },
  attachmentUrl: (id: string) => `${BASE}/attachments/${id}`,
  modelImageUrl: (id: string) => `${BASE}/attachments/${id}/model`,

  tool: (name: string, args: unknown, signal?: AbortSignal) => call<ToolResult>("POST", `/tools/${name}`, args, signal),
  context: () => call<{ skills: { name: string; description: string; references: string[] }[]; characters: { name: string; short_description: string }[]; memory: string }>("GET", "/context"),
  memory: () => call<{ text: string; path: string; max_chars: number }>("GET", "/memory"),
  saveMemory: (text: string) => call<{ ok: boolean; chars: number }>("PUT", "/memory", { text }),
  forgeOptions: () => call<Record<string, string[]>>("GET", "/forge/options"),

  async chat(body: unknown, signal: AbortSignal): Promise<Response> {
    const response = await fetch(`${BASE}/chat`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw await errorFrom(response);
    return response;
  },
};
