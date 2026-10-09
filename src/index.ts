import { fileURLToPath } from "node:url";
import type { Plugin, Config as PluginConfig } from "@opencode-ai/plugin";
import { setup } from "./v2.js";

// A structural input keeps published declarations usable without installing the
// development SDK. Extra native settings remain on the original objects.
interface ConfigInput {
  skills?: { paths?: string[] };
  mcp?: Record<string, unknown>;
}

// Resolve against this module, including when OpenCode installs it in its cache.
const skillsPath = fileURLToPath(new URL("../skills", import.meta.url));

const hypersolutions = (async () => ({
  // Plugin 1.18.35 still types its hook with SDK v1, which omits native skills.
  // The narrow structural input also accepts the runtime's native skills field.
  async config(config: ConfigInput) {
    config.skills ??= {};
    config.skills.paths ??= [];
    if (!config.skills.paths.includes(skillsPath)) {
      config.skills.paths.push(skillsPath);
    }

    config.mcp ??= {};
    // An existing entry belongs entirely to the user, including disabled entries,
    // local transports, custom OAuth settings, headers, and timeouts.
    config.mcp.powhttp ??= {
      type: "remote",
      url: "http://localhost:8383/mcp",
      oauth: false,
    } satisfies NonNullable<PluginConfig["mcp"]>[string];
    config.mcp["har-analyzer"] ??= {
      type: "remote",
      url: "https://har-mcp.hypersolutions.co/mcp",
    } satisfies NonNullable<PluginConfig["mcp"]>[string];
  },
})) satisfies Plugin;

// Both hosts select their own native lifecycle; no compatibility client is used.
export default { id: "hypersolutions", setup, server: hypersolutions };
