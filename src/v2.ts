import { fileURLToPath } from "node:url";
import type { Plugin, Skill } from "@opencode/plugin";
import { skillData } from "./generated-skill.js";

export const setup = (async (context: Plugin.Context) => {
  // V2 exposes native skill registration, not a skill-directory config hook.
  // Build-time metadata preserves the entire Markdown body; the host owns skill
  // discovery, permissions, on-demand loading, and the installed resource path.
  const skill = {
    ...skillData,
    path: fileURLToPath(new URL("../skills/hypersolutions/SKILL.md", import.meta.url)),
  } as Skill.Info; // The native host validates the branded Info at registration.
  await context.skill.transform((editor) => {
    if (!editor.get(skill.id)) editor.add(skill);
  });
  await context.mcp.transform((editor) => {
    if (!editor.get("powhttp")) {
      editor.set("powhttp", {
        type: "remote",
        url: "http://localhost:8383/mcp",
        oauth: false,
        codemode: false,
      });
    }
    if (!editor.get("har-analyzer")) {
      editor.set("har-analyzer", {
        type: "remote",
        url: "https://har-mcp.hypersolutions.co/mcp",
        codemode: false,
      });
    }
  });
}) satisfies Plugin.Plugin["setup"];
