export type PatchOp =
  | { op: "replace"; find: string; replace: string; all?: boolean }
  | { op: "delete"; find: string; all?: boolean }
  | { op: "insert_before" | "insert_after"; anchor: string; text: string }
  | { op: "append" | "prepend"; text: string; separator?: string };

export class PatchError extends Error {
  constructor(
    readonly code: "INVALID_ARGS" | "NOT_FOUND" | "AMBIGUOUS",
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function count(haystack: string, needle: string): number {
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

function locate(text: string, needle: string, all: boolean | undefined, index: number): void {
  if (!needle) throw new PatchError("INVALID_ARGS", `第 ${index + 1} 个补丁缺少要匹配的文本`);
  const hits = count(text, needle);
  if (hits === 0) throw new PatchError("NOT_FOUND", `第 ${index + 1} 个补丁没有找到：${needle}`, { patch: index });
  if (hits > 1 && !all) {
    throw new PatchError("AMBIGUOUS", `第 ${index + 1} 个补丁匹配到 ${hits} 处，请提供更长的上下文或设置 all`, { patch: index, matches: hits });
  }
}

function joinParts(first: string, second: string, separator: string): string {
  if (!first.trim()) return second;
  if (!second.trim()) return first;
  return first.replace(/[\s,]+$/, "") + separator + second.replace(/^[\s,]+/, "");
}

/** Apply all patches atomically; throws PatchError without partial changes. */
export function applyPatches(text: string, patches: PatchOp[]): string {
  if (!Array.isArray(patches) || patches.length === 0) throw new PatchError("INVALID_ARGS", "patches 不能为空");
  if (patches.length > 32) throw new PatchError("INVALID_ARGS", "一次最多 32 个补丁");
  let result = text;
  patches.forEach((patch, index) => {
    switch (patch?.op) {
      case "replace":
        locate(result, patch.find, patch.all, index);
        result = patch.all ? result.split(patch.find).join(patch.replace ?? "") : result.replace(patch.find, () => patch.replace ?? "");
        break;
      case "delete":
        locate(result, patch.find, patch.all, index);
        result = patch.all ? result.split(patch.find).join("") : result.replace(patch.find, "");
        result = result.replace(/,\s*,/g, ",").replace(/^\s*,\s*|\s*,\s*$/g, "");
        break;
      case "insert_before":
      case "insert_after": {
        locate(result, patch.anchor, false, index);
        if (typeof patch.text !== "string") throw new PatchError("INVALID_ARGS", `第 ${index + 1} 个补丁缺少 text`);
        const at = result.indexOf(patch.anchor);
        const split = patch.op === "insert_before" ? at : at + patch.anchor.length;
        result = result.slice(0, split) + patch.text + result.slice(split);
        break;
      }
      case "append":
      case "prepend": {
        if (typeof patch.text !== "string" || !patch.text) throw new PatchError("INVALID_ARGS", `第 ${index + 1} 个补丁缺少 text`);
        const separator = patch.separator ?? ", ";
        result = patch.op === "append" ? joinParts(result, patch.text, separator) : joinParts(patch.text, result, separator);
        break;
      }
      default:
        throw new PatchError("INVALID_ARGS", `第 ${index + 1} 个补丁的 op 不支持`);
    }
  });
  return result;
}
