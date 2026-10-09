import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";

// V2's public SkillEditor accepts an embedded Info; it exposes no path-scanning
// registration API. Compile metadata once instead of adding a runtime YAML loader.
const markdown = await readFile(new URL("../skills/hypersolutions/SKILL.md", import.meta.url), "utf8");
const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
if (!match) throw new Error("Bundled skill needs YAML frontmatter");
const metadata = parse(match[1]);
if (metadata.name !== "hypersolutions" || typeof metadata.description !== "string") {
  throw new Error("Unexpected bundled skill metadata; review the upstream change");
}
const skill = { id: metadata.name, name: metadata.name, description: metadata.description, content: match[2] };
await writeFile(new URL("../src/generated-skill.ts", import.meta.url),
  `// Generated from the complete bundled SKILL.md by scripts/build-skill.mjs.\nexport const skillData: { id: string; name: string; description: string; content: string } = ${JSON.stringify(skill, null, 2)};\n`);
