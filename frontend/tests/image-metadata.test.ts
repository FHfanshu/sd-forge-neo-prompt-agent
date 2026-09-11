import { afterEach, describe, expect, it, vi } from "vitest";
import { extractImageMetadata } from "../src/image-metadata";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("image metadata extraction", () => {
  it("returns parsed metadata from the host", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        metadata: {
          metadata_status: "available",
          parser_format: "a1111",
          width: 64,
          height: 48,
          infotext: "cat",
          data: {},
          missing_fields: [],
          warnings: [],
        },
      }),
    })));
    const metadata = await extractImageMetadata("data:image/png;base64,AAAA");
    expect(metadata?.parser_format).toBe("a1111");
    expect(fetch).toHaveBeenCalledWith("/prompt-agent/api/images/metadata", expect.objectContaining({ method: "POST" }));
  });

  it("degrades to null when the host fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    await expect(extractImageMetadata("data:image/png;base64,AAAA")).resolves.toBeNull();
  });

  it("skips the request without a data url", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(extractImageMetadata("")).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
