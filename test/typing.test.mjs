import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, cp, copyFile, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");

test("published declarations resolve with their declared native SDK dependency", async () => {
  // Outside the repository: TypeScript cannot accidentally resolve its development
  // dependencies when checking the consumer's copy of the published declarations.
  const directory = await mkdtemp(join(tmpdir(), "hypersolutions-types-"));
  try {
    const installed = join(directory, "node_modules", "hypersolutions-opencode");
    await mkdir(installed, { recursive: true });
    await copyFile(new URL("../package.json", import.meta.url), join(installed, "package.json"));
    await cp(new URL("../dist/", import.meta.url), join(installed, "dist"), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
    assert.equal(manifest.dependencies["@opencode/plugin"], "2.0.24");
    // Link only the declared SDK, not all development dependencies. Its own
    // dependencies resolve through its real installed location as with npm.
    await mkdir(join(directory, "node_modules", "@opencode"), { recursive: true });
    await symlink(resolve(dirname(fileURLToPath(import.meta.resolve("@opencode/plugin"))), "../.."),
      join(directory, "node_modules", "@opencode", "plugin"), "junction");
    await writeFile(join(directory, "consumer.mts"), `
import plugin from "hypersolutions-opencode";
const hooks = await plugin.server();
await hooks.config({});
await hooks.config({
  skills: { paths: ["/installed/skills"] },
  mcp: { "har-analyzer": { enabled: false } },
});
// @ts-expect-error Native skill paths must remain an array of strings.
await hooks.config({ skills: { paths: 42 } });
`);
    await writeFile(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["consumer.mts"],
    }));
    const result = spawnSync(process.execPath, [compiler, "-p", join(directory, "tsconfig.json")], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
