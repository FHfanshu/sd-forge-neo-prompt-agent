import type { Target } from "../types";

export type OptionKey = "checkpoint" | "preset" | "sampler" | "scheduler" | "hr_upscaler";

export interface ParamSpec {
  key: string;
  kind: "int" | "number" | "bool" | "choice";
  selector: (target: Target) => string;
  min?: number;
  max?: number;
  multipleOf?: number;
  options?: OptionKey;
  only?: Target;
}

export const PARAMS: ParamSpec[] = [
  { key: "checkpoint", kind: "choice", selector: () => "#setting_sd_model_checkpoint", options: "checkpoint" },
  { key: "preset", kind: "choice", selector: () => "#forge_ui_preset", options: "preset" },
  { key: "sampler", kind: "choice", selector: (t) => `#${t}_sampling`, options: "sampler" },
  { key: "scheduler", kind: "choice", selector: (t) => `#${t}_scheduler`, options: "scheduler" },
  { key: "steps", kind: "int", selector: (t) => `#${t}_steps`, min: 1, max: 150 },
  { key: "cfg_scale", kind: "number", selector: (t) => `#${t}_cfg_scale`, min: 0, max: 30 },
  { key: "seed", kind: "int", selector: (t) => `#${t}_seed`, min: -1, max: 2147483647 },
  { key: "width", kind: "int", selector: (t) => `#${t}_width`, min: 64, max: 4096, multipleOf: 8 },
  { key: "height", kind: "int", selector: (t) => `#${t}_height`, min: 64, max: 4096, multipleOf: 8 },
  { key: "batch_count", kind: "int", selector: (t) => `#${t}_batch_count`, min: 1, max: 16 },
  { key: "batch_size", kind: "int", selector: (t) => `#${t}_batch_size`, min: 1, max: 8 },
  { key: "enable_hr", kind: "bool", selector: () => "#txt2img_hr-visible-checkbox", only: "txt2img" },
  { key: "hr_scale", kind: "number", selector: () => "#txt2img_hr_scale", min: 1, max: 4, only: "txt2img" },
  { key: "hr_upscaler", kind: "choice", selector: () => "#txt2img_hr_upscaler", options: "hr_upscaler", only: "txt2img" },
  { key: "hr_steps", kind: "int", selector: () => "#txt2img_hires_steps", min: 0, max: 150, only: "txt2img" },
  { key: "hr_denoising", kind: "number", selector: () => "#txt2img_denoising_strength", min: 0, max: 1, only: "txt2img" },
  { key: "denoising_strength", kind: "number", selector: () => "#img2img_denoising_strength", min: 0, max: 1, only: "img2img" },
];

export type ParamValues = Record<string, number | boolean | string>;

export function specsFor(target: Target): ParamSpec[] {
  return PARAMS.filter((spec) => !spec.only || spec.only === target);
}

/** Validate a requested change set. Returns a list of problems; empty means valid. */
export function validateParams(target: Target, values: unknown, options: Partial<Record<OptionKey, string[]>>): string[] {
  if (!values || typeof values !== "object" || Array.isArray(values)) return ["values 必须是对象"];
  const specs = new Map(specsFor(target).map((spec) => [spec.key, spec]));
  const problems: string[] = [];
  const entries = Object.entries(values as Record<string, unknown>);
  if (!entries.length) problems.push("values 不能为空");
  for (const [key, value] of entries) {
    const spec = specs.get(key);
    if (!spec) {
      problems.push(PARAMS.some((p) => p.key === key) ? `${key} 只在 ${PARAMS.find((p) => p.key === key)?.only} 可用` : `未知参数 ${key}`);
      continue;
    }
    if (spec.kind === "bool") {
      if (typeof value !== "boolean") problems.push(`${key} 必须是 true/false`);
    } else if (spec.kind === "choice") {
      const list = options[spec.options!] ?? [];
      if (typeof value !== "string" || !list.includes(value)) problems.push(`${key} 必须是可选值之一（先用 read_generation_parameters 查看 options）`);
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.push(`${key} 必须是数字`);
        continue;
      }
      if (spec.kind === "int" && !Number.isInteger(value)) problems.push(`${key} 必须是整数`);
      if (value < spec.min! || value > spec.max!) problems.push(`${key} 范围是 ${spec.min}–${spec.max}`);
      if (spec.multipleOf && value % spec.multipleOf !== 0) problems.push(`${key} 必须是 ${spec.multipleOf} 的倍数`);
    }
  }
  return problems;
}
