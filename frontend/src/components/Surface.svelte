<script lang="ts">
  import { onMount } from "svelte";
  import {
    AlertTriangle, ChevronLeft, ChevronRight, Grip, RefreshCw, Sparkles, X,
  } from "lucide-svelte";
  import type {
    ChatAttachment, ChatMessage, HistoryRow, PromptAgentActionHandlers, MessageSubmission,
    ReasoningEffort, SendMessageInput,
  } from "../contracts";
  import {
    AttachmentError, attachmentPreviewUrl,
    assertAttachmentTotal,
    createImageAttachment,
    displayImageAttachment,
    materializeImageAttachments,
    MAX_ATTACHMENTS,
    releaseImageAttachment,
    releaseImageAttachments,
    retainImageAttachments,
    type PreparedImageAttachment,
  } from "../attachments";
  import { noopActions } from "../mock-data";
  import type { PromptAgentController } from "../agent/controller";
  import { connectPromptAgentController } from "../runtime-connection";
  import { errorText } from "../errors";
  import { useChatStore } from "../stores/chat";
  import { useI18nStore } from "../stores/i18n";
  import { useProfileStore } from "../stores/profiles";
  import { useRuntimeStore } from "../stores/runtime";
  import { useUiStore } from "../stores/ui";
  import { clampLauncherPosition, clampWindowLayout, minimumForViewport, pointerPosition, pointerWindow, readViewportRect, resolveViewportAfterKeyboard, viewportKind, type FloatingPosition, type LayoutViewport } from "../window-interactions";
  import { windowIn, windowOut } from "../motion";
  import ProfileSettings from "./ProfileSettings.svelte";
  import ChatHeader from "./chat/ChatHeader.svelte";
  import ChatTranscript from "./chat/ChatTranscript.svelte";
  import ChatComposer from "./chat/ChatComposer.svelte";

  interface Props {
    messages?: ChatMessage[];
    history?: HistoryRow[];
    actions?: Partial<PromptAgentActionHandlers>;
    initialAttachments?: ChatAttachment[];
    initialOpen?: boolean;
  }

  let {
    messages: providedMessages,
    history: providedHistory,
    actions: actionOverrides = {},
    initialAttachments = [],
    initialOpen = false,
  }: Props = $props();

  let draft = $state("");
  let attachments = $state<PreparedImageAttachment[]>([]);
  let reasoning = $state<ReasoningEffort>("low");
  let lightbox = $state<{ attachments: PreparedImageAttachment[]; index: number } | null>(null);
  let copiedId = $state<string | null>(null);
  let collapsedMessageIds = $state<Set<string>>(new Set());
  let dropActive = $state(false);
  let interacting = $state(false);
  let launcherInteracting = $state(false);
  let launcherDragged = $state(false);
  let mobileHintDismissed = $state(false);
  let stableViewport = readViewportRect();
  let viewportRecovering = $state(false);
  let kind = $state<LayoutViewport>(viewportKind(stableViewport));
  let viewport = $state(stableViewport);
  let launcherButton = $state<HTMLButtonElement | null>(null);
  let composerRef = $state<ReturnType<typeof ChatComposer>>();
  let transcriptRef = $state<ReturnType<typeof ChatTranscript>>();
  let composerFocused = $state(false);
  let replacementId = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let editingMessageId = $state<string | null>(null);
  let preEditDraft = $state<{ text: string; attachments: PreparedImageAttachment[] } | null>(null);
  let returnToChatAfterSettings = $state(false);
  let controller = $state<PromptAgentController | null>(null);
  let controllerReady: Promise<PromptAgentController> | null = null;
  let controllerAbort: AbortController | null = null;
  let connectionState = $state<"idle" | "connecting" | "ready" | "failed">("idle");
  let connectionError = $state<string | null>(null);
  let sessionTransition: Promise<void> | null = null;
  let submissionInFlight = $state(false);
  let queueSubmissionInFlight = $state(false);
  let followLatest = $state(true);
  let wasShellOpen = false;

  const visibleMessages = $derived(providedMessages ?? $useChatStore.messages);
  const runtimeUnavailable = $derived(connectionState === "failed" && !Object.keys(actionOverrides).length);
  const visibleHistory = $derived(providedHistory ?? (controller ? $useRuntimeStore.history : []));
  const windowMinimum = $derived(minimumForViewport(kind));
  const currentLayout = $derived(clampWindowLayout($useUiStore.layouts[kind], viewport, windowMinimum));
  const activeProfile = $derived($useProfileStore.profiles.find((profile) => profile.id === $useProfileStore.activeProfileId && profile.enabled));
  const contextLimit = $derived(activeProfile?.modelInfo.contextLimit || activeProfile?.nCtx || 131072);
  const contextTokens = $derived([...visibleMessages].reverse().find((message) => message.role === "assistant" && (message.usage?.inputTokens ?? 0) > 0)?.usage?.inputTokens ?? 0);
  const workingPhase = $derived($useRuntimeStore.workingPhase);
  const requestActive = $derived(Boolean($useChatStore.activeRequestId));
  const queuedFollowUps = $derived($useRuntimeStore.queuedFollowUps);
  const submissionPending = $derived(submissionInFlight && !requestActive && queuedFollowUps.length === 0);
  const visibleWorkingPhase = $derived((submissionInFlight || requestActive) && workingPhase === "idle" ? "submitting" : workingPhase);
  const runtimeStarting = $derived($useRuntimeStore.startup === "starting");
  const hasVisibleTerminalError = $derived(visibleMessages.some((message) => message.role === "assistant" && message.status === "error"));
  const visibleAlert = $derived(hasVisibleTerminalError ? null : notice || $useRuntimeStore.error);
  const renderMessages = $derived.by(() => {
    const groups: Array<{ message: ChatMessage; processMessages: ChatMessage[] }> = [];
    const pendingTools: ChatMessage[] = [];
    let processMessages: ChatMessage[] = [];

    function flushProcess(): void {
      const finalMessage = [...processMessages].reverse().find((message) => message.role === "assistant");
      if (finalMessage) groups.push({ message: finalMessage, processMessages: [...processMessages] });
      else pendingTools.push(...processMessages.filter((message) => message.role === "tool"));
      processMessages = [];
    }

    for (const message of visibleMessages) {
      if (message.role === "tool" || message.role === "assistant") {
        processMessages.push(message);
        continue;
      }
      flushProcess();
      groups.push({ message, processMessages: [] });
    }

    flushProcess();

    return { groups, pendingTools };
  });

  function t(key: string, fallback: string): string {
    const value = $useI18nStore.t(key);
    return value === key ? fallback : value;
  }

  function tf(key: string, fallback: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      t(key, fallback),
    );
  }

  function toggleMessage(messageId: string): void {
    const next = new Set(collapsedMessageIds);
    if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
    collapsedMessageIds = next;
  }

  function runtimeErrorText(value: string): string {
    return value;
  }

  function megabytes(bytes = 0): string {
    return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2);
  }

  function attachmentErrorText(error: unknown): string {
    if (!(error instanceof AttachmentError)) return errorText(error);
    const name = error.details.name ?? t("assistant.attachment.unknown", "This image");
    const limit = megabytes(error.details.limitBytes);
    if (error.code === "source_too_large") return tf("assistant.error.image_source_too_large", "{name} is larger than {limit} MB. Choose a smaller image.", { name, limit });
    if (error.code === "optimized_too_large") return tf("assistant.error.image_optimized_too_large", "{name} is still larger than {limit} MB after optimization. Resize or recompress it and try again.", { name, limit });
    if (error.code === "total_too_large") return tf("assistant.error.image_total_too_large", "The attached images total {total} MB, above the {limit} MB sending limit. Remove an image or use smaller files; your draft and attachments were kept.", { total: megabytes(error.details.totalBytes), limit });
    if (error.code === "data_unavailable") return tf("assistant.error.image_data_unavailable", "The image data for {name} is no longer available. Remove it and attach the file again.", { name });
    return t("assistant.error.image_read_failed", "The image could not be read. Remove it and attach the file again.");
  }

  function scrollToLatest(force = false): void {
    const messageScroll = transcriptRef?.getScrollElement();
    if (!messageScroll || (!force && !followLatest)) return;
    requestAnimationFrame(() => {
      const el = transcriptRef?.getScrollElement();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }

  function updateFollowLatest(): void {
    const messageScroll = transcriptRef?.getScrollElement();
    if (!messageScroll) return;
    followLatest = messageScroll.scrollHeight - messageScroll.scrollTop - messageScroll.clientHeight < 72;
  }

  function syncReasoningFromProfile(): void {
    const profileValue = String(activeProfile?.parameters.reasoningEffort ?? "low").toLowerCase();
    reasoning = ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(profileValue)
      ? profileValue as ReasoningEffort
      : "none";
  }

  function id(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function updateLayout(next: typeof currentLayout): void {
    $useUiStore.setLayout(kind, next);
    if (kind !== "desktop") $useUiStore.markMobileResizeHintSeen();
  }

  function updateLauncherPosition(next: FloatingPosition): void {
    $useUiStore.setLauncherPosition(next);
  }

  function recoverLauncherPosition(): void {
    const stored = $useUiStore.launcherPosition;
    const element = launcherButton;
    if (!stored || !element || !element.offsetWidth) return;
    const next = clampLauncherPosition(stored, readViewportRect(), { width: element.offsetWidth, height: element.offsetHeight });
    if (next.left !== stored.left || next.top !== stored.top) $useUiStore.setLauncherPosition(next);
  }

  function openLauncher(): void {
    if (launcherDragged) {
      launcherDragged = false;
      return;
    }
    $useUiStore.setShellOpen(true);
    $useUiStore.bringToFront("chat");
    void ensureControllerReady().catch(() => undefined);
    requestAnimationFrame(() => composerRef?.focusComposer());
  }

  function isTextEntryFocused(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLTextAreaElement
      || active instanceof HTMLSelectElement
      || (active instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit"].includes(active.type));
  }

  function refreshViewport(): void {
    const focused = isTextEntryFocused();
    const next = resolveViewportAfterKeyboard(stableViewport, readViewportRect(), focused, viewportRecovering);
    stableViewport = next.stable;
    viewportRecovering = next.recovering;
    viewport = next.viewport;
    if (!focused) kind = viewportKind(viewport);
    recoverLauncherPosition();
  }

  async function ensureControllerReady(): Promise<PromptAgentController | null> {
    if (Object.keys(actionOverrides).length) return null;
    if (controller) return controller;
    if (controllerReady) return controllerReady;
    connectionState = "connecting";
    connectionError = null;
    const abort = new AbortController();
    controllerAbort = abort;
    const pending = connectPromptAgentController(abort.signal)
      .then(async (next) => {
        if (abort.signal.aborted) {
          next.destroy();
          throw new DOMException("Aborted", "AbortError");
        }
        controller = next;
        await next.mount();
        if (abort.signal.aborted) {
          next.destroy();
          controller = null;
          throw new DOMException("Aborted", "AbortError");
        }
        connectionState = "ready";
        return next;
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          connectionState = "failed";
          connectionError = error instanceof Error ? error.message : String(error);
        }
        throw error;
      })
      .finally(() => {
        if (controllerReady === pending) controllerReady = null;
      });
    controllerReady = pending;
    return pending;
  }

  function action<K extends keyof PromptAgentActionHandlers>(name: K): PromptAgentActionHandlers[K] {
    const resolved = actionOverrides[name] ?? controller?.actions[name];
    if (resolved) return resolved as PromptAgentActionHandlers[K];
    if (Object.keys(actionOverrides).length || ["attachFiles", "replaceAttachment", "removeAttachment", "copyMessage", "clearChat"].includes(name)) {
      return noopActions[name] as PromptAgentActionHandlers[K];
    }
    return (() => {
      notice = connectionError ?? "Prompt Agent is still connecting to the Forge runtime.";
      void ensureControllerReady().catch(() => undefined);
    }) as PromptAgentActionHandlers[K];
  }

  async function send(input: SendMessageInput): Promise<MessageSubmission | void> {
    if (actionOverrides.sendMessage) {
      return await actionOverrides.sendMessage(input);
    }
    const activeController = await ensureControllerReady();
    if (!activeController) throw new Error("Prompt Agent runtime controller is unavailable");
    return await activeController.actions.sendMessage(input);
  }

  async function queueMessage(input: SendMessageInput): Promise<MessageSubmission | void> {
    if (actionOverrides.queueMessage) return await actionOverrides.queueMessage(input);
    const activeController = await ensureControllerReady();
    if (!activeController) throw new Error("Prompt Agent runtime controller is unavailable");
    return await activeController.actions.queueMessage(input);
  }

  async function submit(): Promise<void> {
    const queueing = requestActive || queuedFollowUps.length > 0;
    if ((queueing ? queueSubmissionInFlight : submissionInFlight) || (!draft.trim() && !attachments.length)) return;
    if (queueing) queueSubmissionInFlight = true;
    else submissionInFlight = true;
    notice = null;
    const submittedDraft = draft;
    const submittedAttachments = [...attachments];
    draft = "";
    attachments = [];
    requestAnimationFrame(() => composerRef?.resizeComposer());
    try {
      await sessionTransition;
      assertAttachmentTotal(submittedAttachments);
      const input = {
        text: submittedDraft.trim(),
        attachments: await materializeImageAttachments(submittedAttachments),
        displayAttachments: submittedAttachments.map(displayImageAttachment),
        reasoning,
        editOf: editingMessageId ?? undefined,
      };
      if (queueing) await queueMessage(input);
      else await send(input);
      releaseImageAttachments(submittedAttachments);
      if (editingMessageId === input.editOf) {
        releaseImageAttachments(preEditDraft?.attachments ?? []);
        editingMessageId = null;
        preEditDraft = null;
      }
      requestAnimationFrame(() => composerRef?.resizeComposer());
    } catch (error) {
      if (!draft) draft = submittedDraft;
      if (!attachments.length) attachments = submittedAttachments;
      requestAnimationFrame(() => composerRef?.resizeComposer());
      if (error instanceof DOMException && error.name === "AbortError") return;
      notice = attachmentErrorText(error) || t("assistant.error.send", "Message could not be sent. Check the active model and try again.");
    } finally {
      if (queueing) queueSubmissionInFlight = false;
      else submissionInFlight = false;
    }
  }

  async function removeQueuedMessage(queueId: string): Promise<void> {
    notice = null;
    try {
      await action("removeQueuedMessage")(queueId);
    } catch (error) {
      notice = errorText(error);
    }
  }

  async function resumeQueuedMessages(): Promise<void> {
    notice = null;
    try {
      await action("resumeQueuedMessages")();
    } catch (error) {
      notice = errorText(error);
    }
  }

  function keepComposerFocus(event: PointerEvent): void {
    if (composerFocused && event.pointerType !== "mouse") event.preventDefault();
  }

  function beginEdit(message: ChatMessage): void {
    if (!editingMessageId) preEditDraft = { text: draft, attachments: [...attachments] };
    else releaseImageAttachments(attachments);
    editingMessageId = message.id;
    draft = message.content;
    attachments = [...message.attachments];
    retainImageAttachments(attachments);
    notice = null;
    requestAnimationFrame(() => {
      composerRef?.resizeComposer();
      composerRef?.focusComposer();
      const el = composerRef?.getComposerInput();
      el?.setSelectionRange(draft.length, draft.length);
    });
  }

  function cancelEdit(): void {
    releaseImageAttachments(attachments);
    draft = preEditDraft?.text ?? "";
    attachments = [...(preEditDraft?.attachments ?? [])];
    editingMessageId = null;
    preEditDraft = null;
    requestAnimationFrame(() => composerRef?.resizeComposer());
  }

  function stop(): void {
    if (actionOverrides.stopRequest) actionOverrides.stopRequest();
    else if (controller) controller.actions.stopRequest();
    else $useChatStore.cancelRequest();
  }

  function openSettings(): void {
    actionOverrides.openSettings?.();
    returnToChatAfterSettings = kind !== "desktop" && $useUiStore.shellOpen;
    if (returnToChatAfterSettings) $useUiStore.setShellOpen(false);
    $useUiStore.setProfileSettingsOpen(true);
    $useUiStore.bringToFront("profiles");
  }

  function closeSettings(): void {
    $useUiStore.setProfileSettingsOpen(false);
    if (returnToChatAfterSettings) {
      returnToChatAfterSettings = false;
      $useUiStore.setShellOpen(true);
      $useUiStore.bringToFront("chat");
      requestAnimationFrame(() => composerRef?.focusComposer());
    }
  }

  function useSuggestion(text: string): void {
    draft = text;
    requestAnimationFrame(() => {
      composerRef?.resizeComposer();
      composerRef?.focusComposer();
      const el = composerRef?.getComposerInput();
      el?.setSelectionRange(draft.length, draft.length);
    });
  }

  function toggleHistory(): void {
    const next = !$useUiStore.historyOpen;
    $useUiStore.setHistoryOpen(next);
    if (next) {
      $useRuntimeStore.setLoading(true);
      void ensureControllerReady()
        .then((activeController) => {
          if (!activeController) return [];
          if ($useRuntimeStore.startup === "error") throw new Error($useRuntimeStore.error ?? t("assistant.runtime.retry", "Prompt Agent is unavailable. Retry or check Model profiles."));
          return activeController.loadHistory();
        })
        .then(async (rows) => {
          if (rows.some((row) => row.source === "prompt-agent")) return;
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          await controller?.loadHistory();
        })
        .then(() => $useRuntimeStore.setError(null))
        .catch((error) => $useRuntimeStore.setError(error instanceof Error ? error.message : t("assistant.error.history", "Chat history could not be loaded. Try again.")))
        .finally(() => $useRuntimeStore.setLoading(false));
    }
  }

  async function createNewSession(): Promise<void> {
    notice = null;
    const previousDraft = draft;
    const previousAttachments = [...attachments];
    const previousEditingMessageId = editingMessageId;
    const previousPreEditDraft = preEditDraft;
    try {
      if (actionOverrides.newSession) await actionOverrides.newSession();
      else {
        const activeController = await ensureControllerReady();
        if (!activeController) throw new Error("Prompt Agent runtime controller is unavailable");
        await activeController.actions.newSession();
      }
      if (draft === previousDraft) draft = "";
      if (attachments.length === previousAttachments.length && attachments.every((item, index) => item.id === previousAttachments[index]?.id)) {
        attachments = [];
        releaseImageAttachments(previousAttachments);
      }
      if (editingMessageId === previousEditingMessageId) editingMessageId = null;
      if (preEditDraft === previousPreEditDraft) {
        releaseImageAttachments(previousPreEditDraft?.attachments ?? []);
        preEditDraft = null;
      }
    } catch (error) {
      notice = error instanceof Error ? error.message : t("assistant.error.new_chat", "A new chat could not be started. Stop the current response and try again.");
    }
  }

  async function newSession(): Promise<void> {
    if (sessionTransition) return sessionTransition;
    const pending = createNewSession();
    sessionTransition = pending;
    try { await pending; } finally { if (sessionTransition === pending) sessionTransition = null; }
  }

  async function addFiles(files: File[]): Promise<void> {
    if (replacementId && files.length === 1) {
      try {
        await replaceAttachment(files[0]);
      } catch (error) {
        notice = attachmentErrorText(error) || t("assistant.error.attach", "The images could not be attached. Try them again.");
      }
      return;
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      notice = t("assistant.error.image_only", "Only image files can be attached.");
      return;
    }
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (!remaining) {
      notice = tf("assistant.error.image_limit", "You can attach up to {count} images.", { count: MAX_ATTACHMENTS });
      return;
    }
    const accepted = images.slice(0, remaining);
    notice = images.length > accepted.length ? tf("assistant.error.image_limit_first", "Only the first {count} images were attached.", { count: MAX_ATTACHMENTS }) : null;
    const added: PreparedImageAttachment[] = [];
    try {
      for (const file of accepted) {
        const attachment = await createImageAttachment(file, id("attachment"));
        assertAttachmentTotal([...attachments, ...added, attachment]);
        added.push(attachment);
      }
      await action("attachFiles")(accepted);
      attachments = [...attachments, ...added];
    } catch (error) {
      releaseImageAttachments(added);
      notice = attachmentErrorText(error) || t("assistant.error.attach", "The images could not be attached. Try them again.");
    }
  }

  async function chooseAttachments(): Promise<void> {
    type ImagePickerWindow = Window & {
      showOpenFilePicker?: (options: {
        multiple: boolean;
        excludeAcceptAllOption: boolean;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<Array<{ getFile(): Promise<File> }>>;
    };
    const picker = (window as ImagePickerWindow).showOpenFilePicker;
    if (!picker) {
      composerRef?.triggerFileInput();
      return;
    }
    try {
      const handles = await picker({
        multiple: true,
        excludeAcceptAllOption: true,
        types: [{ description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"] } }],
      });
      await addFiles(await Promise.all(handles.map((handle) => handle.getFile())));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      composerRef?.triggerFileInput();
    }
  }

  async function replaceAttachment(file: File): Promise<void> {
    if (!replacementId) return;
    const next = await createImageAttachment(file, id("attachment"));
    try {
      assertAttachmentTotal(attachments.map((item) => item.id === replacementId ? next : item));
      await action("replaceAttachment")(replacementId, file);
      const previous = attachments.find((item) => item.id === replacementId);
      attachments = attachments.map((item) => item.id === replacementId ? next : item);
      if (previous) releaseImageAttachment(previous);
      replacementId = null;
    } catch (error) {
      releaseImageAttachment(next);
      throw error;
    }
  }

  async function removeAttachment(attachmentId: string): Promise<void> {
    await action("removeAttachment")(attachmentId);
    const removed = attachments.find((item) => item.id === attachmentId);
    if (lightbox?.attachments.some((item) => item.id === attachmentId)) lightbox = null;
    attachments = attachments.filter((item) => item.id !== attachmentId);
    if (removed) releaseImageAttachment(removed);
  }

  async function copyMessage(message: ChatMessage): Promise<void> {
    await action("copyMessage")(message);
    copiedId = message.id;
    window.setTimeout(() => { if (copiedId === message.id) copiedId = null; }, 1200);
  }

  async function undoToolMutation(message: ChatMessage): Promise<void> {
    notice = null;
    try {
      await action("undoToolMutation")(message);
    } catch (error) {
      notice = errorText(error) || t("assistant.error.undo", "The saved Forge state could not be restored.");
    }
  }

  function resizeKey(event: KeyboardEvent): void {
    const delta = event.shiftKey ? 40 : 10;
    const width = event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0;
    const height = event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0;
    if (!width && !height) return;
    event.preventDefault();
    updateLayout(clampWindowLayout({ ...currentLayout, width: currentLayout.width + width, height: currentLayout.height + height }, viewport, windowMinimum));
  }

  onMount(() => {
    let focusRecoveryTimer: number | undefined;
    const recoverAfterFocus = () => {
      window.clearTimeout(focusRecoveryTimer);
      focusRecoveryTimer = window.setTimeout(refreshViewport, 80);
    };
    attachments = [...initialAttachments];
    syncReasoningFromProfile();
    if (initialOpen) $useUiStore.setShellOpen(true);
    void ensureControllerReady().catch(() => undefined);
    window.addEventListener("resize", refreshViewport);
    requestAnimationFrame(recoverLauncherPosition);
    window.visualViewport?.addEventListener("resize", refreshViewport);
    window.visualViewport?.addEventListener("scroll", refreshViewport);
    document.addEventListener("focusin", refreshViewport);
    document.addEventListener("focusout", recoverAfterFocus);
    return () => {
      window.clearTimeout(focusRecoveryTimer);
      window.removeEventListener("resize", refreshViewport);
      window.visualViewport?.removeEventListener("resize", refreshViewport);
      window.visualViewport?.removeEventListener("scroll", refreshViewport);
      document.removeEventListener("focusin", refreshViewport);
      document.removeEventListener("focusout", recoverAfterFocus);
      controllerAbort?.abort();
      controllerAbort = null;
      controller?.destroy();
      controller = null;
      controllerReady = null;
      releaseImageAttachments(attachments);
      releaseImageAttachments(preEditDraft?.attachments ?? []);
    };
  });

  $effect(() => {
    activeProfile?.parameters.reasoningEffort;
    activeProfile?.capabilities.reasoning;
    syncReasoningFromProfile();
  });

  $effect(() => {
    const open = $useUiStore.shellOpen;
    const latest = visibleMessages.at(-1);
    latest?.id;
    latest?.content;
    latest?.reasoning;
    latest?.status;
    $useChatStore.activeRequestId;
    if (open) scrollToLatest(!wasShellOpen);
    wasShellOpen = open;
  });
</script>

<div class="pa-surface pa-viewport-{kind}" data-prompt-agent-surface="true">
  <button
    class:pa-launcher-interacting={launcherInteracting}
    class:pa-launcher-active={$useUiStore.shellOpen || $useUiStore.profileSettingsOpen}
    class="pa-launcher"
    type="button"
    bind:this={launcherButton}
    aria-label={t("assistant.open", "Open Prompt Agent")}
    aria-expanded={$useUiStore.shellOpen}
    title={t("assistant.drag", "Drag to move")}
    style:left={$useUiStore.launcherPosition ? `${$useUiStore.launcherPosition.left}px` : undefined}
    style:top={$useUiStore.launcherPosition ? `${$useUiStore.launcherPosition.top}px` : undefined}
    style:right={$useUiStore.launcherPosition ? "auto" : undefined}
    style:bottom={$useUiStore.launcherPosition ? "auto" : undefined}
    use:pointerPosition={{ position: () => $useUiStore.launcherPosition, update: updateLauncherPosition, interacting: (active) => launcherInteracting = active, moved: (moved) => launcherDragged = moved }}
    onclick={openLauncher}
  >
    <Sparkles size={15} />
    <span>{t("assistant.launcher", "Prompt Agent")}</span>
  </button>

  {#if $useUiStore.shellOpen}
    <div
      class:pa-window-interacting={interacting}
      class:pa-keyboard-overflow={viewportRecovering}
      class="pa-window"
      in:windowIn
      out:windowOut
      style:left="{currentLayout.left}px"
      style:top="{currentLayout.top}px"
      style:width="{currentLayout.width}px"
      style:height="{currentLayout.height}px"
      style:z-index={$useUiStore.frontWindow === "chat" ? 1002 : 1000}
      role="dialog"
      aria-modal="false"
      aria-label={t("assistant.chat_dialog", "Prompt Agent chat")}
      tabindex="-1"
      data-prompt-agent-pending="false"
      onpointerdown={() => $useUiStore.bringToFront("chat")}
      onkeydown={(event) => { if (event.key === "Escape") $useUiStore.setShellOpen(false); }}
    >
      <ChatHeader
        filteredHistory={visibleHistory}
        {runtimeUnavailable}
        dragAction={pointerWindow}
        dragParams={{ mode: "drag", layout: () => currentLayout, update: updateLayout, minimum: windowMinimum, interacting: (active: boolean) => interacting = active }}
        ontogglehistory={toggleHistory}
        onselecthistory={(row) => { void action("selectHistory")(row); }}
        onnewsession={() => void newSession()}
        onopensettings={openSettings}
        onclose={() => $useUiStore.setShellOpen(false)}
      />

      <div class="pa-window-body">
        {#if connectionState === "connecting"}
          <div class="pa-inline-alert" role="status" aria-live="polite"><RefreshCw size={15} /><span>Connecting to Forge runtime…</span></div>
        {:else if connectionState === "failed"}
          <div class="pa-inline-alert" role="alert"><AlertTriangle size={15} /><span>{connectionError}</span><button type="button" onclick={() => void ensureControllerReady().catch(() => undefined)}>Retry</button></div>
        {:else if runtimeStarting}
          <div class="pa-inline-alert" role="status" aria-live="polite"><RefreshCw size={15} /><span>{t("assistant.runtime.retry", "Prompt Agent is starting or unavailable. Retry or check Model profiles.")}</span></div>
        {/if}
        {#if visibleAlert}
          <div class="pa-inline-alert" role="alert"><AlertTriangle size={15} /><span>{runtimeErrorText(visibleAlert)}</span>{#if notice}<button type="button" onclick={() => notice = null} aria-label={t("common.dismiss_message", "Dismiss message")}><X size={14} /></button>{/if}</div>
        {/if}

        <ChatTranscript
          bind:this={transcriptRef}
          {visibleMessages}
          {renderMessages}
          {collapsedMessageIds}
          {copiedId}
          {submissionInFlight}
          {requestActive}
          {visibleWorkingPhase}
          onscroll={updateFollowLatest}
          ontogglecollapse={toggleMessage}
          oncopy={(msg) => void copyMessage(msg)}
          onbeginedit={beginEdit}
          onundo={undoToolMutation}
          onpreviewattachments={(att, idx) => lightbox = { attachments: att, index: idx }}
          onusesuggestion={useSuggestion}
          onchooseattachments={() => void chooseAttachments()}
        />

        <ChatComposer
          bind:this={composerRef}
          bind:draft
          bind:attachments
          {editingMessageId}
          {dropActive}
          {submissionPending}
          {queueSubmissionInFlight}
          {submissionInFlight}
          {requestActive}
          {contextTokens}
          {contextLimit}
          onsubmit={() => void submit()}
          onaddfiles={(files) => void addFiles(files)}
          oncanceledit={cancelEdit}
          onresumequeued={() => void resumeQueuedMessages()}
          onremovequeued={(queueId) => void removeQueuedMessage(queueId)}
          onchooseattachments={() => void chooseAttachments()}
          onreplacerequest={(attId) => replacementId = attId}
          onremoveattachment={(attId) => void removeAttachment(attId)}
          onpreviewattachment={(idx) => lightbox = { attachments, index: idx }}
          onstop={stop}
          onkeepcomposerfocus={keepComposerFocus}
          onfocus={() => { composerFocused = true; $useUiStore.bringToFront("chat"); }}
          onblur={() => composerFocused = false}
        />
      </div>

      {#if !composerFocused}
        <button
          type="button"
          class="pa-resize-handle"
          data-prompt-agent-interaction-handle="true"
          use:pointerWindow={{ mode: "resize", layout: () => currentLayout, update: updateLayout, minimum: windowMinimum, interacting: (active) => interacting = active }}
          onkeydown={resizeKey}
          aria-label={t("assistant.resize", "Resize chat window")}
        >
          <Grip size={15} />
        </button>
      {/if}
      {#if kind !== "desktop" && !$useUiStore.hasSeenMobileResizeHint && !mobileHintDismissed}
        <div class="pa-mobile-resize-hint" role="status">
          <Grip size={14} /> {t("assistant.resize_hint", "Drag the corner to resize")}
          <button type="button" onclick={() => { mobileHintDismissed = true; $useUiStore.markMobileResizeHintSeen(); }}>{t("common.dismiss", "Dismiss")}</button>
        </div>
      {/if}
    </div>
  {/if}

  <ProfileSettings open={$useUiStore.profileSettingsOpen} onclose={closeSettings} />

  {#if lightbox && lightbox.attachments[lightbox.index]}
    <div
      class="pa-lightbox"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label={t("lightbox.title", "Image preview")}
      onclick={() => lightbox = null}
      onkeydown={(event) => { if (event.key === "Escape") lightbox = null; }}
    >
      <div class="pa-lightbox-panel" onclick={(event) => event.stopPropagation()} role="presentation">
        <button type="button" class="pa-lightbox-close" onclick={() => lightbox = null} aria-label={t("lightbox.close", "Close preview")}>
          <X size={18} />
        </button>
        <img src={attachmentPreviewUrl(lightbox.attachments[lightbox.index])} alt={lightbox.attachments[lightbox.index].name} width="900" height="900" />
        {#if lightbox.attachments.length > 1}
          <button type="button" class="pa-lightbox-nav pa-lightbox-prev" disabled={lightbox.index === 0} onclick={() => lightbox && (lightbox = { ...lightbox, index: Math.max(0, lightbox.index - 1) })} aria-label={t("lightbox.previous", "Previous image")}>
            <ChevronLeft size={22} />
          </button>
          <button type="button" class="pa-lightbox-nav pa-lightbox-next" disabled={lightbox.index === lightbox.attachments.length - 1} onclick={() => lightbox && (lightbox = { ...lightbox, index: Math.min(lightbox.attachments.length - 1, lightbox.index + 1) })} aria-label={t("lightbox.next", "Next image")}>
            <ChevronRight size={22} />
          </button>
          <span class="pa-lightbox-count">{lightbox.index + 1} / {lightbox.attachments.length}</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
