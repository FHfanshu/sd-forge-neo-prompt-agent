import { api } from "../api";
import { hashText } from "../lib/hash";
import type { Target, ToolResult } from "../types";
import * as dom from "./dom";
import { applyPatches, PatchError, type PatchOp } from "./prompt-edit";
import { specsFor, validateParams, type OptionKey, type ParamValues } from "./params";

export interface ToolOutcome {
  result: ToolResult;
  /** Attachment the loop should show to a vision model alongside the result. */
  imageAttachmentId?: string;
}

const fail = (code: string, message: string, extra: Record<string, unknown> = {}): ToolOutcome => ({
  result: { ok: false, error: { code, message, ...extra } },
});

function resolveTarget(raw: unknown): Target | ToolOutcome {
  if (raw === "txt2img" || raw === "img2img") return raw;
  if (raw !== undefined && raw !== "active") return fail("INVALID_ARGS", "target 只能是 active、txt2img、img2img");
  if (!dom.forgeReady()) return fail("FORGE_UNAVAILABLE", "Forge 页面还没加载完成");
  return dom.activeTarget() ?? fail("NOT_ON_GENERATION_TAB", "当前不在 txt2img/img2img 页面，请指定 target");
}

let optionsCache: { at: number; value: Partial<Record<OptionKey, string[]>> } | null = null;
async function forgeOptions(): Promise<Partial<Record<OptionKey, string[]>>> {
  if (optionsCache && Date.now() - optionsCache.at < 30_000) return optionsCache.value;
  const value = (await api.forgeOptions()) as Partial<Record<OptionKey, string[]>>;
  optionsCache = { at: Date.now(), value };
  return value;
}

function cfgOf(target: Target): number | null {
  const el = dom.controlRoot(`#${target}_cfg_scale`);
  return el ? dom.readNumber(el) : null;
}

export function readPrompt(args: Record<string, unknown>): ToolOutcome {
  const target = resolveTarget(args.target);
  if (typeof target !== "string") return target;
  const positive = dom.promptTextarea(target, "positive");
  const negative = dom.promptTextarea(target, "negative");
  if (!positive || !negative) return fail("FORGE_UNAVAILABLE", "找不到提示词输入框");
  const cfg = cfgOf(target);
  return {
    result: {
      ok: true,
      target,
      positive: { text: positive.value, hash: hashText(positive.value) },
      negative: { text: negative.value, hash: hashText(negative.value), effective: cfg === null || cfg !== 1 },
    },
  };
}

export function editPrompt(args: Record<string, unknown>): ToolOutcome {
  const target = resolveTarget(args.target);
  if (typeof target !== "string") return target;
  const field = args.field;
  if (field !== "positive" && field !== "negative") return fail("INVALID_ARGS", "field 只能是 positive 或 negative");
  const textarea = dom.promptTextarea(target, field);
  if (!textarea) return fail("FORGE_UNAVAILABLE", "找不到提示词输入框");
  const current = textarea.value;
  const currentHash = hashText(current);
  if (args.base_hash !== currentHash) {
    return fail("STALE", "提示词已变化，请使用这里返回的最新 text 和 hash 重新修改", { text: current, hash: currentHash });
  }
  let next: string;
  if (args.text !== undefined) {
    if (args.patches !== undefined) return fail("INVALID_ARGS", "text 与 patches 不能同时使用");
    if (current.trim()) return fail("INVALID_ARGS", "字段不为空时只能用 patches 修改");
    if (typeof args.text !== "string" || !args.text.trim()) return fail("INVALID_ARGS", "text 不能为空");
    next = args.text;
  } else {
    try {
      next = applyPatches(current, args.patches as PatchOp[]);
    } catch (error) {
      if (error instanceof PatchError) return fail(error.code, error.message, error.detail);
      throw error;
    }
  }
  dom.writeText(textarea, next);
  const result: ToolResult = { ok: true, target, field, before: current, text: next, hash: hashText(next), before_hash: currentHash };
  const cfg = cfgOf(target);
  if (field === "negative" && cfg === 1) result.note = "负向提示词当前不生效（CFG=1）";
  return { result };
}

function snapshot(target: Target): { values: ParamValues; missing: string[] } {
  const values: ParamValues = {};
  const missing: string[] = [];
  for (const spec of specsFor(target)) {
    const el = dom.controlRoot(spec.selector(target));
    if (!el) {
      missing.push(spec.key);
      continue;
    }
    if (spec.kind === "bool") values[spec.key] = (el as HTMLInputElement).checked;
    else if (spec.kind === "choice") {
      const value = dom.readDropdown(el);
      if (value === null) missing.push(spec.key);
      else values[spec.key] = value;
    } else {
      const value = dom.readNumber(el);
      if (value === null) missing.push(spec.key);
      else values[spec.key] = value;
    }
  }
  return { values, missing };
}

const contextHash = (target: Target, values: ParamValues) => hashText(JSON.stringify([target, values]));

export async function readParams(args: Record<string, unknown>): Promise<ToolOutcome> {
  const target = resolveTarget(args.target);
  if (typeof target !== "string") return target;
  const { values, missing } = snapshot(target);
  let options: Partial<Record<OptionKey, string[]>> = {};
  try {
    options = await forgeOptions();
  } catch {
    // options are advisory; values still help the model
  }
  return { result: { ok: true, target, context_hash: contextHash(target, values), values, missing, options } };
}

export async function setParams(args: Record<string, unknown>): Promise<ToolOutcome> {
  const target = resolveTarget(args.target);
  if (typeof target !== "string") return target;
  const before = snapshot(target);
  const currentHash = contextHash(target, before.values);
  if (args.context_hash !== currentHash) {
    return fail("STALE", "参数已变化，请用这里返回的最新值和 context_hash 重试", { values: before.values, context_hash: currentHash });
  }
  const options = await forgeOptions();
  const problems = validateParams(target, args.values, options);
  if (problems.length) return fail("INVALID_ARGS", problems.join("；"), { problems });
  const requested = args.values as ParamValues;
  const failed: string[] = [];
  for (const spec of specsFor(target)) {
    if (!(spec.key in requested)) continue;
    const value = requested[spec.key];
    const el = dom.controlRoot(spec.selector(target));
    let ok = !!el;
    if (el && spec.kind === "bool") ok = dom.writeHires(Boolean(value));
    else if (el && spec.kind === "choice") ok = await dom.writeDropdown(el, String(value));
    else if (el) ok = dom.writeNumber(el, Number(value));
    if (!ok) failed.push(spec.key);
  }
  const after = snapshot(target);
  const result: ToolResult = { ok: failed.length === 0, target, values: after.values, context_hash: contextHash(target, after.values) };
  if (failed.length) result.error = { code: "FORGE_UNAVAILABLE", message: `这些参数没能写入：${failed.join("、")}`, failed };
  if ("checkpoint" in requested) result.note = "切换 checkpoint 会触发模型加载";
  return { result };
}

export async function readLatestImage(args: Record<string, unknown>, sessionId: string, signal: AbortSignal): Promise<ToolOutcome> {
  const target = resolveTarget(args.target);
  if (typeof target !== "string") return target;
  const blob = await latestImageBlob(target, signal);
  if (!blob) return fail("NOT_FOUND", "当前页面还没有出图");
  const saved = await api.upload(sessionId, blob);
  return {
    result: { ok: true, target, attachment_id: saved.id, width: saved.width, height: saved.height, pnginfo: saved.pnginfo },
    imageAttachmentId: saved.id,
  };
}

export async function latestImageBlob(target: Target, signal?: AbortSignal): Promise<Blob | null> {
  const url = dom.latestImageUrl(target);
  if (!url) return null;
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) return null;
  return response.blob();
}
