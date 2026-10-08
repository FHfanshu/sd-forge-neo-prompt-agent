import { describe, expect, it } from "vitest";
import { diffPrompt } from "../lib/diff";
import { hashText } from "../lib/hash";
import { validateParams } from "./params";
import { applyPatches, PatchError } from "./prompt-edit";

describe("applyPatches", () => {
  const base = "masterpiece, 1girl, city street, depth of field";

  it("applies operations in order", () => {
    expect(
      applyPatches(base, [
        { op: "replace", find: "city street", replace: "rainy night" },
        { op: "insert_after", anchor: "1girl", text: ", silver hair" },
        { op: "append", text: "neon signs" },
        { op: "prepend", text: "best quality" },
      ]),
    ).toBe("best quality, masterpiece, 1girl, silver hair, rainy night, depth of field, neon signs");
  });

  it("delete cleans the dangling separator", () => {
    expect(applyPatches(base, [{ op: "delete", find: "city street" }])).toBe("masterpiece, 1girl, depth of field");
  });

  it("append to an empty field adds no separator", () => {
    expect(applyPatches("", [{ op: "append", text: "1girl" }])).toBe("1girl");
  });

  it("is atomic and reports not found / ambiguous", () => {
    const run = (patches: Parameters<typeof applyPatches>[1]) => {
      try {
        applyPatches("a, b, a", patches);
        return null;
      } catch (error) {
        return (error as PatchError).code;
      }
    };
    expect(run([{ op: "replace", find: "b", replace: "c" }, { op: "delete", find: "zzz" }])).toBe("NOT_FOUND");
    expect(run([{ op: "replace", find: "a", replace: "x" }])).toBe("AMBIGUOUS");
    expect(applyPatches("a, b, a", [{ op: "replace", find: "a", replace: "x", all: true }])).toBe("x, b, x");
    expect(run([])).toBe("INVALID_ARGS");
    expect(run([{ op: "nope" } as never])).toBe("INVALID_ARGS");
  });

  it("does not treat replacement text as a regex pattern", () => {
    expect(applyPatches("a b", [{ op: "replace", find: "a", replace: "$&$&" }])).toBe("$&$& b");
  });
});

describe("hashText", () => {
  it("is stable and sensitive", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("")).toHaveLength(14);
  });
});

describe("diffPrompt", () => {
  it("diffs comma segments with one line of context", () => {
    const result = diffPrompt("masterpiece, 1girl, silver hair, city street, a, b, c, depth of field", "masterpiece, 1girl, silver hair, rainy night, a, b, c, depth of field");
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:…", "same:silver hair,", "del:city street,", "add:rainy night,", "same:a,", "same:…"]);
  });
});

describe("validateParams", () => {
  const options = { sampler: ["Euler a"], checkpoint: ["model.safetensors"] };
  it("accepts valid values", () => {
    expect(validateParams("txt2img", { steps: 30, sampler: "Euler a", enable_hr: true, width: 832 }, options)).toEqual([]);
  });
  it("collects every problem", () => {
    const problems = validateParams("img2img", { steps: 0, sampler: "Nope", width: 833, enable_hr: true, foo: 1, cfg_scale: "5" }, options);
    expect(problems).toHaveLength(6);
  });
  it("rejects non-object values", () => {
    expect(validateParams("txt2img", null, options)).toEqual(["values 必须是对象"]);
  });
});
