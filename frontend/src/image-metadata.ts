export type ImageMetadataStatus = "available" | "partial" | "absent" | "unsupported" | "error";

export interface ImageMetadata {
  metadata_status: ImageMetadataStatus;
  parser_format: string;
  width: number;
  height: number;
  infotext: string | null;
  data: Record<string, unknown>;
  missing_fields: string[];
  warnings: string[];
}

const API = "/prompt-agent/api";

async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function extractImageMetadata(dataUrl: string): Promise<ImageMetadata | null> {
  if (typeof fetch !== "function" || !dataUrl) return null;
  try {
    const response = await fetch(`${API}/images/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ data_url: dataUrl }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return (payload?.metadata as ImageMetadata) ?? null;
  } catch {
    return null;
  }
}

export async function readOriginalImageMetadata(file: Blob): Promise<ImageMetadata | null> {
  if (typeof fetch !== "function") return null;
  try {
    return await extractImageMetadata(await blobToBase64DataUrl(file));
  } catch {
    return null;
  }
}
