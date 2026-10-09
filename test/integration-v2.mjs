/** Native @opencode/cli 2.x integration. All services/model replies below are synthetic. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  mkdtemp,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import net from "node:net";
import { startMockServices, har } from "./fixtures/mock-services.mjs";
const binary = process.env.OPENCODE_V2_BIN || "opencode";
const tarball = path.resolve(
  process.argv[2] || "hypersolutions-opencode-0.2.0.tgz",
);
const bytes = await readFile(tarball),
  sha256 = createHash("sha256").update(bytes).digest("hex");
const evidence = path.resolve(".work", `native2 integration-${Date.now()}`);
const work = await mkdtemp(
  path.join(os.tmpdir(), "hypersolutions-opencode-v2-"),
);
await symlink(work, evidence, "dir");
const managedFixtures = [];
const children = new Set(),
  checks = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: work,
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.output = "";
  child.stdout.on("data", (d) => (child.output += d));
  child.stderr.on("data", (d) => (child.output += d));
  child.on("exit", () => children.delete(child));
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), pause(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
async function run(command, args, options = {}) {
  const child = start(command, args, options);
  const timer = setTimeout(() => child.kill("SIGKILL"), 90000);
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, child.output);
    return child.output;
  } finally {
    clearTimeout(timer);
  }
}
function passed(text) {
  checks.push(text);
  console.log(`PASS ${text}`);
}
async function fixture(name, global = false) {
  const dir = path.join(work, name),
    project = path.join(dir, "project"),
    configDir = path.join(dir, "config", "opencode");
  await Promise.all([
    mkdir(project, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(path.join(dir, "home"), { recursive: true }),
  ]);
  const env = {
    PATH: process.env.PATH,
    HOME: path.join(dir, "home"),
    XDG_CONFIG_HOME: path.join(dir, "config"),
    XDG_DATA_HOME: path.join(dir, "data"),
    XDG_CACHE_HOME: path.join(dir, "cache"),
    XDG_STATE_HOME: path.join(dir, "state"),
    OPENCODE_TEST_HOME: path.join(dir, "home"),
    OPENCODE_DB: "native2-fixture.db",
    CI: "1",
    NO_COLOR: "1",
    BROWSER: "false",
  };
  const portServer = net.createServer();
  await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
  const port = portServer.address().port;
  await new Promise((r) => portServer.close(r));
  await writeFile(
    path.join(configDir, "service.json"),
    JSON.stringify({ hostname: "127.0.0.1", port }),
  );
  const prefix = global ? configDir : path.join(project, ".opencode");
  await mkdir(prefix, { recursive: true });
  await run("npm", [
    "install",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ]);
  const installed = path.join(
    prefix,
    "node_modules",
    "hypersolutions-opencode",
  );
  const configPath = path.join(global ? configDir : project, "opencode.json");
  const config = {
    plugins: [
      "-opencode.config.skill",
      "./" +
        path
          .relative(path.dirname(configPath), installed)
          .split(path.sep)
          .join("/"),
    ],
    mcp: {
      servers: {
        powhttp: {
          type: "remote",
          url: "http://localhost:8383/mcp",
          disabled: true,
        },
        "har-analyzer": {
          type: "remote",
          url: "https://har-mcp.hypersolutions.co/mcp",
          disabled: true,
        },
      },
    },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  };
  const save = () => writeFile(configPath, JSON.stringify(config, null, 2));
  await save();
  const cli = (...args) => run(binary, args, { cwd: project, env });
  const api = async (route) =>
    JSON.parse(
      await cli(
        "api",
        "GET",
        route + "?location%5Bdirectory%5D=" + encodeURIComponent(project),
      ),
    );
  const result = {
    dir,
    project,
    env,
    installed,
    config,
    configPath,
    save,
    cli,
    api,
  };
  managedFixtures.push(result);
  return result;
}
async function serve(f) {
  const child = start(
    binary,
    ["serve", "--hostname", "127.0.0.1", "--port", "0"],
    { cwd: f.project, env: f.env },
  );
  let base;
  for (let n = 0; n < 300 && !base; n++) {
    base = child.output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (child.exitCode !== null) throw new Error(child.output);
    if (!base) await pause(100);
  }
  assert.ok(base, child.output);
  while (!child.output.includes("server password")) await pause(10);
  const password = child.output.match(/server password (\S+)/)[1];
  return {
    async api(route, method = "GET", body) {
      const url = new URL(base + route);
      url.searchParams.set("location[directory]", f.project);
      const response = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization:
            "Basic " + Buffer.from("opencode:" + password).toString("base64"),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      const text = await response.text();
      assert.ok(response.ok, `${method} ${route}: ${response.status} ${text}`);
      return text ? JSON.parse(text) : undefined;
    },
    close: () => stop(child),
  };
}
async function status(server, name) {
  for (let n = 0; n < 100; n++) {
    const found = (await server.api("/api/mcp")).data.find(
      (s) => s.name === name,
    );
    if (found && found.status.status !== "pending") return found.status;
    await pause(100);
  }
  throw new Error("MCP remained pending");
}
async function skillsReady(f) {
  let skills;
  // Package-name activation can include a cold npm dependency install. Counted
  // polls gave fast machines only ~17 seconds; use a bounded wall-clock budget.
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    skills = (await f.api("/api/skill")).data;
    const found = skills.find((s) => s.name === "hypersolutions");
    if (found) return skills;
    await pause(100);
  }
  throw new Error(
    "Plugin skill did not activate; " +
      JSON.stringify(await f.api("/api/plugin")),
  );
}
async function cliMcpReady(f) {
  let result;
  for (let n = 0; n < 100; n++) {
    result = await f.cli("mcp", "list");
    if (
      result.includes("powhttp") &&
      result.includes("har-analyzer") &&
      !result.includes("pending")
    )
      return result;
    await pause(100);
  }
  throw new Error("MCP CLI remained incomplete: " + result);
}
let mock, server, manifest;
try {
  assert.match(await run(binary, ["--version"]), /2\.0\.24/);
  for (const global of [false, true]) {
    const f = await fixture(global ? "global" : "project", global);
    manifest = JSON.parse(
      await readFile(path.join(f.installed, "package.json"), "utf8"),
    );
    const skills = await skillsReady(f);
    const skill = skills.find((s) => s.name === "hypersolutions");
    assert.ok(skill, JSON.stringify(skills));
    assert.ok(skill.path.startsWith(f.installed));
    assert.match(
      await readFile(
        path.join(
          f.installed,
          "skills/hypersolutions/references/request-rules.md",
        ),
        "utf8",
      ),
      /sec-ch-ua/,
    );
    assert.match(
      await run("python3", [
        path.join(f.installed, "skills/hypersolutions/scripts/sec_ch_ua.py"),
        "--selftest",
      ]),
      /12\/12 passed/,
    );
    assert.match(
      await run(
        process.execPath,
        [path.join(f.installed, "scripts/sync-upstream.mjs"), "--check"],
        { cwd: f.installed },
      ),
      /audit passed/,
    );
    const list = await cliMcpReady(f);
    assert.match(list, /powhttp\s+disabled/);
    assert.match(list, /har-analyzer\s+disabled/);
    assert.equal(
      (await f.api("/api/skill")).data.filter(
        (s) => s.name === "hypersolutions",
      ).length,
      1,
    );
    assert.deepEqual(
      JSON.parse(await readFile(f.configPath, "utf8")),
      f.config,
    );
    passed(
      `native2 ${global ? "global" : "project"} relative-directory packed install, skill discovery, full content audit, helper, disabled overrides, repeated initialization, standalone MCP CLI`,
    );
  }
  const packageFixture = {
    manifest,
    tarball: bytes,
    proxyRegistry: true,
    tarballDelayMs: 0,
  };
  mock = await startMockServices(packageFixture);
  for (const global of [false, true]) {
    // Regression: startup must tolerate a real pending package download, not
    // merely a warm local install. The previous polling window expired here.
    packageFixture.tarballDelayMs = global ? 45000 : 0;
    const f = await fixture(global ? "npm-global" : "npm-project", global);
    f.config.plugins = [
      "-opencode.config.skill",
      `${manifest.name}@${manifest.version}`,
    ];
    f.env.npm_config_registry = mock.base;
    await f.save();
    const skill = (await skillsReady(f)).find(
      (s) => s.name === "hypersolutions",
    );
    assert.ok(skill, JSON.stringify(await f.api("/api/plugin")));
    assert.ok(skill.path.startsWith(f.env.XDG_CACHE_HOME));
    passed(
      `native2 ${global ? "global (delayed download)" : "project"} package-name native npm install using real tarball from synthetic registry`,
    );
  }
  const f = await fixture("mcp");
  f.config.mcp = {
    servers: {
      powhttp: {
        type: "remote",
        url: mock.base + "/powhttp",
        oauth: false,
        codemode: false,
      },
      "har-analyzer": {
        type: "remote",
        url: mock.base + "/har",
        oauth: { scope: "mcp" },
        codemode: false,
      },
    },
  };
  f.config.providers = {
    openai: {
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: mock.base + "/v1", apiKey: "synthetic" },
      models: {
        fixture: {
          name: "fixture",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          limit: { context: 128000, output: 8192 },
        },
      },
    },
  };
  f.config.model = "openai/fixture";
  await f.save();
  await skillsReady(f);
  await pause(500);
  const list = await cliMcpReady(f);
  assert.match(list, /powhttp\s+connected/);
  assert.match(list, /har-analyzer\s+needs authentication/);
  passed(
    "native2 standalone MCP CLI discovers synthetic services and native OAuth integration",
  );
  const auth = start(binary, ["mcp", "auth", "har-analyzer"], {
    cwd: f.project,
    env: f.env,
  });
  let authorization;
  for (let n = 0; n < 600 && !authorization; n++) {
    authorization = auth.output.match(
      new RegExp(`${mock.base}/authorize[^\\s\\u001b]+`),
    )?.[0];
    if (auth.exitCode !== null) throw new Error(auth.output);
    if (!authorization) await pause(100);
  }
  assert.ok(authorization, auth.output);
  const redirect = await fetch(authorization, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  const callback = await fetch(redirect.headers.get("location"));
  assert.equal(callback.status, 200, await callback.text());
  if (auth.exitCode === null)
    await Promise.race([once(auth, "exit"), pause(30000)]);
  assert.equal(auth.exitCode, 0, auth.output);
  assert.ok(mock.observed.grants.includes("authorization_code"));
  const dbPath = path.join(
    f.env.XDG_DATA_HOME,
    "opencode",
    "native2-fixture.db",
  );
  const credentials = () => {
    const db = new DatabaseSync(dbPath);
    try {
      return db
        .prepare("select id,value from credential")
        .all()
        .map((row) => ({ ...row, value: JSON.parse(row.value) }))
        .filter((row) => row.value.refresh === "mock-refresh");
    } finally {
      db.close();
    }
  };
  assert.equal(credentials().length, 1);
  assert.equal((await stat(dbPath)).mode & 0o777, 0o600);
  passed(
    "native2 mock native CLI OAuth discovery, DCR, S256 PKCE, callback, token exchange, owner-only SQLite credential persistence",
  );
  await f.cli("service", "stop");
  server = await serve(f);
  assert.equal((await status(server, "har-analyzer")).status, "connected");
  passed(
    "native2 saved mock OAuth credential reconnects in a new native server process",
  );
  const skill = (await server.api("/api/skill")).data.find(
    (s) => s.name === "hypersolutions",
  );
  const skillDir = path.join(f.installed, "skills/hypersolutions");
  const calls = [
    { name: "skill", arguments: { id: skill.id } },
    {
      name: "read",
      arguments: { path: path.join(skillDir, "references/request-rules.md") },
    },
    {
      name: "shell",
      arguments: {
        command: `python3 '${path.join(skillDir, "scripts/sec_ch_ua.py")}' 149`,
      },
    },
    {
      name: "powhttp_find_requests",
      arguments: {
        query: { sessionId: "synthetic-session" },
        include: ["request_headers", "fingerprint"],
        limit: 1,
      },
    },
    {
      name: "powhttp_get_tls_connection",
      arguments: { connectionId: "synthetic-tls" },
    },
    {
      name: "powhttp_get_http2_streams",
      arguments: {
        connectionId: "synthetic-http2",
        streams: [{ id: 1, limit: 2 }],
      },
    },
    {
      name: "har-analyzer_analyze_har",
      arguments: { har, verbose_details: true },
    },
  ];
  async function sequence(sequence) {
    mock.setSequence(sequence);
    const created = await server.api("/api/session", "POST", {
      title: "Synthetic native2 integration",
      model: { providerID: "openai", id: "fixture" },
      location: { directory: f.project },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    });
    await server.api(`/api/session/${created.data.id}/prompt`, "POST", {
      text: "Execute the synthetic verification sequence.",
    });
    let messages;
    for (let n = 0; n < 600; n++) {
      messages = (await server.api(`/api/session/${created.data.id}/message`))
        .data;
      if (
        messages.some(
          (m) =>
            m.type === "assistant" &&
            m.content.some(
              (p) =>
                p.type === "text" &&
                p.text === "Synthetic integration sequence complete.",
            ),
        )
      )
        return messages;
      if (messages.some((m) => m.type === "assistant" && m.error))
        throw new Error(JSON.stringify(messages));
      await pause(100);
    }
    throw new Error(
      `Native2 sequence timeout: ${JSON.stringify(messages)}; requests ${JSON.stringify(mock.observed.models.map((m) => ({ model: m.model, tools: m.tools?.map((t) => t.function?.name) })))}`,
    );
  }
  const messages = await sequence(calls);
  const parts = messages
    .flatMap((m) => (m.type === "assistant" ? m.content : []))
    .filter((p) => p.type === "tool");
  for (const call of calls) {
    const part = parts.find((p) => p.name === call.name);
    assert.ok(part, `Missing ${call.name}: ${JSON.stringify(parts)}`);
    assert.equal(part.state.status, "completed", JSON.stringify(part));
  }
  assert.match(
    JSON.stringify(parts.find((p) => p.name === "skill").state.content),
    new RegExp(skillDir),
  );
  assert.match(
    JSON.stringify(parts.find((p) => p.name === "shell").state.content),
    /Chromium/,
  );
  assert.equal(mock.observed.calls.length, 4);
  passed(
    "native2 native skill/read/shell and all four synthetic MCP tools discovered and executed with direct tool names",
  );
  const errorMessages = await sequence([
    {
      name: "powhttp_get_http2_streams",
      arguments: {
        connectionId: "synthetic-tls",
        streams: [{ id: 1, limit: 2 }],
      },
    },
    {
      name: "har-analyzer_analyze_har",
      arguments: { har: "synthetic-invalid-har" },
    },
  ]);
  const errorPart = errorMessages
    .flatMap((m) => (m.type === "assistant" ? m.content : []))
    .find((p) => p.type === "tool" && p.name === "har-analyzer_analyze_har");
  assert.ok(errorPart);
  const wrongConnectionPart = errorMessages
    .flatMap((m) => (m.type === "assistant" ? m.content : []))
    .find((p) => p.type === "tool" && p.name === "powhttp_get_http2_streams");
  assert.equal(wrongConnectionPart?.state.status, "error");
  assert.equal(
    errorPart.state.status,
    "error",
    JSON.stringify(errorPart.state),
  );
  assert.match(JSON.stringify(errorPart.state.error), /valid.*false/);
  passed(
    "native2 rejects TLS ID for HTTP/2 and malformed HAR; tool errors propagate and assistant completes",
  );
  await server.close();
  server = undefined;
  const before = credentials()[0];
  mock.expireTokens();
  const db = new DatabaseSync(dbPath);
  db.prepare("update credential set value=? where id=?").run(
    JSON.stringify({ ...before.value, expires: 1 }),
    before.id,
  );
  db.close();
  server = await serve(f);
  assert.equal((await status(server, "har-analyzer")).status, "connected");
  assert.ok(mock.observed.grants.includes("refresh_token"));
  assert.notEqual(credentials()[0].value.access, before.value.access);
  passed(
    "native2 native mock OAuth refresh replaces persisted expired credential",
  );
  await server.close();
  server = undefined;
  await mock.close();
  mock = undefined;
  await skillsReady(f);
  await pause(500);
  const offline = await cliMcpReady(f);
  assert.match(offline, /powhttp\s+failed/);
  assert.match(offline, /har-analyzer\s+failed/);
  passed(
    "native2 standalone MCP offline errors report both unavailable services",
  );
  await writeFile(
    path.join(work, "results.json"),
    JSON.stringify(
      {
        version: "@opencode/cli@2.0.24",
        tarball,
        sha256,
        checks,
        mockOnly: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Evidence: ${path.relative(process.cwd(), evidence)}/results.json`,
  );
} finally {
  if (server) await server.close();
  if (mock) await mock.close();
  for (const child of children) await stop(child);
  for (const f of managedFixtures)
    await f.cli("service", "stop").catch(() => {});
}
