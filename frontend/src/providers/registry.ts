import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createProviderAdapter, type ProviderAdapter, type ProviderProfileMetadata } from "./adapter";
import { allProviderCapabilities, type ModelCapabilities } from "./capabilities";

interface ProviderRow {
  id: string;
  capabilities: ModelCapabilities;
  matches(profile: ProviderProfileMetadata): boolean;
}

const normalizeId = (profile: ProviderProfileMetadata): string =>
  String(profile.providerId ?? profile.modelInfo?.providerId ?? "").toLowerCase();

const endpoint = (profile: ProviderProfileMetadata): string => String(profile.endpoint ?? "").toLowerCase();

const providerTable: ProviderRow[] = [
  {
    id: "openai-compatible",
    capabilities: allProviderCapabilities(),
    matches: (profile) =>
      profile.protocol !== "gemini-native"
      && normalizeId(profile) !== "gemini"
      && !endpoint(profile).includes("generativelanguage.googleapis.com"),
  },
  {
    id: "gemini",
    capabilities: allProviderCapabilities(),
    matches: (profile) =>
      normalizeId(profile) === "gemini"
      || normalizeId(profile) === "google"
      || profile.protocol === "gemini-native"
      || endpoint(profile).includes("generativelanguage.googleapis.com"),
  },
];

const adapters = providerTable.map((row) => createProviderAdapter(row.id, row.capabilities, row.matches));

export const normalizeProviderId = (id: string): string => ({
  openai: "openai-compatible",
  "openai-chat-completions": "openai-compatible",
  "openai_compatible": "openai-compatible",
  openrouter: "openai-compatible",
  google: "gemini",
}[id.trim().toLowerCase()] ?? id.trim().toLowerCase());

export const providerRegistry = {
  list: (): ProviderAdapter[] => [...adapters],
  get(id: string): ProviderAdapter {
    const adapter = adapters.find((candidate) => candidate.id === normalizeProviderId(id));
    if (!adapter) throw new Error(`Unknown provider adapter: ${id}`);
    return adapter;
  },
  resolve(profile: ProviderProfileMetadata): ProviderAdapter {
    const explicit = String(profile.providerId ?? "").trim();
    if (explicit) return providerRegistry.get(explicit);
    const adapter = adapters.find((candidate) => candidate.matches(profile));
    if (!adapter) throw new Error("No provider adapter matches the selected profile.");
    return adapter;
  },
};

export const createProviderStream = (profile: ProviderProfileMetadata & { id: string }): StreamFn =>
  providerRegistry.resolve(profile).createStream(profile.id);
