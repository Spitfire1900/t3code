/**
 * OpenCodeProvider - Health checks and model catalog for OpenCode.
 */
import { ServiceMap } from "effect";
import type {
  ModelCapabilities,
  OpenCodeSettings,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Result, Stream } from "effect";

import type { ServerProviderShape } from "../Services/ServerProvider";
import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  spawnAndCollect,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { ServerSettingsService } from "../../serverSettings";

export interface OpenCodeProviderShape extends ServerProviderShape {}

export class OpenCodeProvider extends ServiceMap.Service<OpenCodeProvider, OpenCodeProviderShape>()(
  "t3/provider/Layers/OpenCodeProvider",
) {}

const PROVIDER = "opencode" as const;

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "anthropic/claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "high", label: "High", isDefault: true },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

export const OpenCodeProviderLive = Layer.effect(
  OpenCodeProvider,
  Effect.gen(function* () {
    console.log("[DEBUG] OpenCodeProviderLive initializing...");
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    console.log("[DEBUG] OpenCodeProviderLive got settings, providers:", settings.providers);
    
    const opencodeSettings = settings.providers.opencode;
    console.log("[DEBUG] OpenCodeProviderLive opencode settings:", opencodeSettings);
    
    if (!opencodeSettings.enabled) {
      console.log("[DEBUG] OpenCodeProvider disabled");
      return null;
    }

    const models = [...BUILT_IN_MODELS];
    for (const slug of opencodeSettings.customModels ?? []) {
      const existing = models.find((m) => m.slug === slug);
      if (!existing) {
        models.push({
          slug,
          name: slug,
          isCustom: true,
          capabilities: DEFAULT_MODEL_CAPABILITIES,
        });
      }
    }

    console.log("[DEBUG] OpenCodeProvider returning:", { provider: PROVIDER, models });
    
    return {
      provider: PROVIDER,
      displayName: "OpenCode",
      version: "0.0.0",
      configuredModels: models,
      homePath: opencodeSettings.homePath ?? null,
    } as ServerProvider;
  }),
);

async function probeOpenCode(settings: OpenCodeSettings): Promise<ServerProvider | null> {
  if (!settings.enabled) {
    return null;
  }

  const models = [...BUILT_IN_MODELS];
  for (const slug of settings.customModels ?? []) {
    const existing = models.find((m) => m.slug === slug);
    if (!existing) {
      models.push({
        slug,
        name: slug,
        isCustom: true,
        capabilities: DEFAULT_MODEL_CAPABILITIES,
      });
    }
  }

  return {
    provider: PROVIDER,
    displayName: "OpenCode",
    version: "0.0.0",
    configuredModels: models,
    homePath: settings.homePath ?? null,
  };
}

export { PROVIDER as OPENCODE_PROVIDER };