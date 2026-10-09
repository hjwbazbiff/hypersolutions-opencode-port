import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../skills/hypersolutions/", import.meta.url);
const helper = fileURLToPath(new URL("scripts/sec_ch_ua.py", root));
test("upstream Python test vectors and comparison modes work", () => {
  const output = execFileSync("python3", [helper, "--selftest"], { encoding: "utf8" });
  assert.match(output, /12\/12 passed/);
  const expected = execFileSync("python3", [helper, "149"], { encoding: "utf8" }).trim();
  assert.match(execFileSync("python3", [helper, "--check", "149", expected], { encoding: "utf8" }), /MATCH/);
  const mismatch = spawnSync("python3", [helper, "--check", "149", "incorrect"], { encoding: "utf8" });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stdout, /MISMATCH/);
});

test("skill reference index reaches all bundled reference documents", () => {
  const manifest = JSON.parse(readFileSync(new URL("../provenance/upstream.json", import.meta.url)));
  const skill = readFileSync(new URL("SKILL.md", root), "utf8");
  const references = manifest.files.filter(file => file.portPath?.includes("/references/"));
  assert.equal(references.length, 11);
  for (const file of references) {
    const path = file.portPath.replace("skills/hypersolutions/", "");
    assert.ok(skill.includes(path), `missing index entry: ${path}`);
    assert.ok(existsSync(new URL(path, root)), `missing file: ${path}`);
  }
});
