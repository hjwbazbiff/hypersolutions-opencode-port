import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import plugin from "../dist/index.js";

const skillsPath = fileURLToPath(new URL("../skills", import.meta.url));
const apply = async (config) => (await plugin.server()).config(config);

test("registers native skills and both native URL transports", async () => {
  const config = {};
  await apply(config);
  assert.deepEqual(config, {
    skills: { paths: [skillsPath] },
    mcp: {
      powhttp: { type: "remote", url: "http://localhost:8383/mcp", oauth: false },
      "har-analyzer": { type: "remote", url: "https://har-mcp.hypersolutions.co/mcp" },
    },
  });
});

test("repeated initialization is idempotent and preserves unrelated config", async () => {
  const config = {
    skills: { paths: ["/user/skills"], urls: ["https://example.com/skills"] },
    permission: { skill: { hypersolutions: "deny" } },
    plugin: ["another-plugin"],
    mcp: { other: { type: "local", command: ["example"] } },
  };
  await apply(config);
  const once = structuredClone(config);
  await apply(config);
  await apply(config);
  assert.deepEqual(config, once);
  assert.deepEqual(config.skills.paths, ["/user/skills", skillsPath]);
  assert.equal(config.permission.skill.hypersolutions, "deny");
  assert.deepEqual(config.mcp.other, { type: "local", command: ["example"] });
});

for (const override of [
  { enabled: false },
  { type: "remote", url: "https://example.com/mcp", enabled: false },
  { type: "local", command: ["custom-mcp", "--stdio"], environment: { EXAMPLE: "value" } },
  { type: "remote", url: "https://example.com/mcp", oauth: false, headers: { Authorization: "{env:TEST_TOKEN}" }, timeout: 12345 },
  { type: "remote", url: "https://example.com/mcp", oauth: { clientId: "custom", scope: "mcp" } },
]) {
  test(`preserves complete user entries: ${JSON.stringify(override)}`, async () => {
    const config = { mcp: { powhttp: structuredClone(override), "har-analyzer": structuredClone(override) } };
    const expected = structuredClone(config.mcp);
    const originalPowhttp = config.mcp.powhttp;
    await apply(config);
    assert.deepEqual(config.mcp, expected);
    assert.equal(config.mcp.powhttp, originalPowhttp);
  });
}

test("defaults are independent between project instances", async () => {
  const first = {};
  const second = {};
  await apply(first);
  first.mcp.powhttp.url = "http://changed.invalid";
  await apply(second);
  assert.equal(second.mcp.powhttp.url, "http://localhost:8383/mcp");
});
