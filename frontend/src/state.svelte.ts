import type { Message, ModelEntry, Profile, Session, Settings, TurnState } from "./types";

export type PanelMode = "squeeze" | "overlay";

export interface PanelPrefs {
  open: boolean;
  mode: PanelMode;
  width: number;
}

export interface DraftAttachment {
  id: string;
  width: number;
  height: number;
}

const PANEL_KEY = "pa2.panel";
const SESSION_KEY = "pa2.session";
export const PAGE_SIZE = 60;

function loadPanel(): PanelPrefs {
  const fallback: PanelPrefs = { open: true, mode: "squeeze", width: 400 };
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      open: value.open !== false,
      mode: value.mode === "overlay" ? "overlay" : "squeeze",
      width: Math.min(720, Math.max(320, Number(value.width) || 400)),
    };
  } catch {
    return fallback;
  }
}

export function savePanel(prefs: PanelPrefs): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(prefs));
  } catch {
    // storage may be unavailable; defaults are fine
  }
}

export function rememberSession(id: string | null): void {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

const MODEL_KEY = "pa2.model";

/** Last provider/model the user picked; new sessions start with it. */
export function rememberModel(profileId: string, model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify({ profileId, model }));
  } catch {
    // ignore
  }
}

export function rememberedModel(): { profileId: string | null; model: string | null } {
  try {
    const value = JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null");
    return { profileId: typeof value?.profileId === "string" ? value.profileId : null, model: typeof value?.model === "string" ? value.model : null };
  } catch {
    return { profileId: null, model: null };
  }
}

const EFFORT_KEY = "pa2.effort";

/** Per provider/model reasoning effort chosen in the picker; "" means the provider setting. */
function loadEfforts(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(EFFORT_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function saveEfforts(efforts: Record<string, string>): void {
  try {
    localStorage.setItem(EFFORT_KEY, JSON.stringify(efforts));
  } catch {
    // ignore
  }
}

export function rememberedSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Single source of UI state. Message objects are immutable and replaced only on discrete events;
 * streamed tokens go to `live`, which only the streaming message reads.
 */
class AppState {
  sessions = $state.raw<Session[]>([]);
  sessionId = $state<string | null>(null);
  draftProfileId = $state<string | null>(rememberedModel().profileId);
  draftModel = $state<string | null>(rememberedModel().model);
  messages = $state.raw<Message[]>([]);
  visibleCount = $state(PAGE_SIZE);
  live = $state({ id: "", content: "", reasoning: "" });
  turn = $state<TurnState>("idle");
  turnNote = $state("");
  profiles = $state.raw<Profile[]>([]);
  defaultProfileId = $state("");
  settings = $state.raw<Settings>({ civitai_enabled: true, has_civitai_key: false });
  importNote = $state("");
  view = $state<"chat" | "settings">("chat");
  panel = $state<PanelPrefs>(loadPanel());
  drafts = $state.raw<DraftAttachment[]>([]);
  notice = $state("");
  lastError = $state(false);
  efforts = $state.raw<Record<string, string>>(loadEfforts());

  get session(): Session | null {
    return this.sessions.find((s) => s.id === this.sessionId) ?? null;
  }

  get profileId(): string {
    const wanted = this.session?.profile_id ?? this.draftProfileId ?? this.defaultProfileId;
    return this.profiles.some((p) => p.id === wanted) ? wanted! : (this.profiles[0]?.id ?? "");
  }

  get profile(): Profile | null {
    return this.profiles.find((p) => p.id === this.profileId) ?? null;
  }

  /** Selected model of the selected provider; falls back to the provider's first model. */
  get model(): ModelEntry | null {
    const models = this.profile?.models ?? [];
    const wanted = this.session ? this.session.model : this.draftModel;
    return models.find((m) => m.id === wanted) ?? models[0] ?? null;
  }

  get effort(): string {
    return this.efforts[`${this.profileId}/${this.model?.id ?? ""}`] ?? "";
  }

  get busy(): boolean {
    return this.turn !== "idle";
  }
}

export const app = new AppState();
