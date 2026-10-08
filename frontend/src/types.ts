export type Role = "user" | "assistant" | "tool";
export type MessageStatus = "complete" | "streaming" | "stopped" | "error" | "interrupted";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AttachmentRef {
  id: string;
  width: number;
  height: number;
}

export interface Message {
  id: string;
  seq?: number;
  role: Role;
  status: MessageStatus;
  content: string;
  reasoning: string;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  attachments: AttachmentRef[] | null;
  error: string | null;
  usage: Record<string, number> | null;
  created_at: number;
}

export interface Session {
  id: string;
  title: string;
  profile_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Profile {
  id: string;
  name: string;
  base_url: string;
  model: string;
  reasoning_effort: "" | "low" | "medium" | "high";
  vision: boolean;
  temperature: number | null;
  max_tokens: number | null;
  has_api_key: boolean;
}

export interface Settings {
  civitai_enabled: boolean;
  has_civitai_key: boolean;
}

export type Target = "txt2img" | "img2img";

export interface ToolResult {
  ok: boolean;
  error?: { code: string; message: string; [key: string]: unknown };
  [key: string]: unknown;
}

export type TurnState = "idle" | "requesting" | "streaming" | "tool_running";
