import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import plugin from "../dist/index.js";

function fixture({ skills = [], servers = [] } = {}) {
  const skillMap = new Map(skills);
  const serverMap = new Map(servers);
  const transforms = [];
  const context = {
    skill: { async transform(callback) {
      const run = () => callback({ get: id => skillMap.get(id), add: value => skillMap.set(value.id, value) });
      transforms.push(run); run();
    } },
    mcp: { async transform(callback) {
      const run = () => callback({ get: id => serverMap.get(id), set: (id, value) => serverMap.set(id, value) });
      transforms.push(run); run();
    } },
  };
  return { context, skillMap, serverMap, replay() { transforms.forEach(run => run()); } };
}

test("v2 registers the complete native skill body, metadata and installed path", async () => {
  const f = fixture();
  await plugin.setup(f.context);
  const skill = f.skillMap.get("hypersolutions");
  const markdown = readFileSync(new URL("../skills/hypersolutions/SKILL.md", import.meta.url), "utf8");
  const [, yaml, content] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
  assert.deepEqual(skill, { ...parse(yaml), id: "hypersolutions", content,
    path: fileURLToPath(new URL("../skills/hypersolutions/SKILL.md", import.meta.url)) });
  assert.equal(f.serverMap.get("powhttp").oauth, false);
  assert.equal(f.serverMap.get("powhttp").codemode, false);
  assert.equal(f.serverMap.get("har-analyzer").codemode, false);
  assert.equal(f.serverMap.get("har-analyzer").url, "https://har-mcp.hypersolutions.co/mcp");
  const before = JSON.stringify([...f.serverMap, ...f.skillMap]);
  f.replay();
  await plugin.setup(f.context);
  assert.equal(JSON.stringify([...f.serverMap, ...f.skillMap]), before);
});

test("v2 preserves user skills, native disabled definitions, Code Mode and transports", async () => {
  const userSkill = { id: "hypersolutions", name: "User skill", content: "user", path: "/user/SKILL.md" };
  const disabled = { type: "remote", url: "https://custom.invalid/mcp", disabled: true, codemode: true,
    oauth: { client_id: "custom" }, headers: { test: "value" }, timeout: { catalog: 1234 } };
  const local = { type: "local", command: ["custom"], disabled: false };
  const f = fixture({ skills: [["hypersolutions", userSkill]], servers: [["powhttp", disabled], ["har-analyzer", local], ["other", local]] });
  await plugin.setup(f.context);
  f.replay();
  assert.equal(f.skillMap.get("hypersolutions"), userSkill);
  assert.equal(f.serverMap.get("powhttp"), disabled);
  assert.equal(f.serverMap.get("har-analyzer"), local);
  assert.equal(f.serverMap.get("other"), local);
});
