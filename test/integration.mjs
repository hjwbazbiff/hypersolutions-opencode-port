import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { startMockServices, har } from "./fixtures/mock-services.mjs";

const root = process.cwd();
const binary = path.resolve(
  process.env.OPENCODE_BIN || ".work/runtime/node_modules/.bin/opencode",
);
const tarball = path.resolve(
  process.argv[2] || "hypersolutions-opencode-0.2.0.tgz",
);
const tarballBytes = await readFile(tarball);
const tarballHash = createHash("sha256").update(tarballBytes).digest("hex");
const work = path.resolve(".work", `integration run-${Date.now()}`);
await mkdir(work, { recursive: true });
const children = new Set();
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: work,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`Timeout ${command} ${args.join(" ")}\n${stdout}\n${stderr}`),
      );
    }, 90000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      if (code !== 0)
        reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}
const notes = [];
function passed(message) {
  notes.push(message);
  console.log(`PASS ${message}`);
}
async function fixture(name, global = false) {
  const dir = path.join(work, name);
  const project = path.join(dir, "project");
  const configDir = path.join(dir, "config", "opencode");
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
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    CI: "1",
    NO_COLOR: "1",
  };
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
  const configPath = global
    ? path.join(configDir, "opencode.json")
    : path.join(project, "opencode.json");
  const config = {
    plugin: [
      "./" +
        path
          .relative(
            path.dirname(configPath),
            path.join(installed, "dist/index.js"),
          )
          .split(path.sep)
          .join("/"),
    ],
    mcp: { powhttp: { enabled: false }, "har-analyzer": { enabled: false } },
    permission: "allow",
  };
  const save = () => writeFile(configPath, JSON.stringify(config, null, 2));
  await save();
  const cli = (...args) => run(binary, args, { cwd: project, env });
  return { dir, project, env, installed, config, save, cli };
}
async function serve(f) {
  const child = spawn(
    binary,
    ["serve", "--hostname", "127.0.0.1", "--port", "0"],
    { cwd: f.project, env: f.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.add(child);
  let output = "";
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server did not start: ${output}`)),
      30000,
    );
    const capture = (d) => {
      output += d;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new Error(output));
    });
  });
  return {
    async api(route, method = "GET", body) {
      const r = await fetch(base + route, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      const text = await r.text();
      assert.ok(r.ok, `${method} ${route}: ${r.status} ${text}`);
      return JSON.parse(text);
    },
    async close() {
      child.kill();
      await once(child, "exit");
      children.delete(child);
    },
  };
}
let mock, server, packedManifest;
try {
  assert.equal((await run(binary, ["--version"])).stdout.trim(), "1.18.35");
  for (const global of [false, true]) {
    const f = await fixture(global ? "global" : "project", global);
    packedManifest = JSON.parse(
      await readFile(path.join(f.installed, "package.json"), "utf8"),
    );
    const skills = JSON.parse((await f.cli("debug", "skill")).stdout);
    const skill = skills.find((s) => s.name === "hypersolutions");
    assert.ok(skill);
    assert.ok(skill.location.startsWith(f.installed));
    assert.match(
      await readFile(
        path.join(
          path.dirname(skill.location),
          "references",
          "request-rules.md",
        ),
        "utf8",
      ),
      /sec-ch-ua/,
    );
    const helper = await run("python3", [
      path.join(path.dirname(skill.location), "scripts", "sec_ch_ua.py"),
      "--selftest",
    ]);
    assert.match(helper.stdout, /ok/);
    const audit = await run(
      process.execPath,
      [path.join(f.installed, "scripts", "sync-upstream.mjs"), "--check"],
      { cwd: f.installed },
    );
    assert.match(audit.stdout, /13|verified|audit/i);
    passed(
      `${global ? "global" : "project"} tarball installation: native skill discovery, bundled reference access, Python self-test`,
    );
    const resolved = JSON.parse((await f.cli("debug", "config")).stdout);
    assert.deepEqual(resolved.mcp.powhttp, { enabled: false });
    assert.deepEqual(resolved.mcp["har-analyzer"], { enabled: false });
    delete f.config.mcp;
    await f.save();
    const defaults = JSON.parse((await f.cli("debug", "config")).stdout);
    assert.equal(defaults.mcp.powhttp.url, "http://localhost:8383/mcp");
    assert.equal(
      defaults.mcp["har-analyzer"].url,
      "https://har-mcp.hypersolutions.co/mcp",
    );
    const again = JSON.parse((await f.cli("debug", "config")).stdout);
    assert.deepEqual(again.skills.paths, defaults.skills.paths);
    assert.equal(
      again.skills.paths.filter((p) => p === path.join(f.installed, "skills"))
        .length,
      1,
    );
    const authInventory = await f.cli("mcp", "auth", "list");
    assert.match(authInventory.stdout, /har-analyzer/);
    assert.doesNotMatch(authInventory.stdout, /powhttp/);
    passed(
      `${global ? "global" : "project"} native standalone initialization exposes default MCP config and remains idempotent; disabled overrides preserved`,
    );
  }
  mock = await startMockServices({
    manifest: packedManifest,
    tarball: tarballBytes,
  });
  for (const global of [false, true]) {
    const registry = await fixture(
      global ? "registry-global" : "registry-project",
      global,
    );
    registry.config.plugin = [`${packedManifest.name}@${packedManifest.version}`];
    registry.env.npm_config_registry = mock.base;
    await registry.save();
    const discovered = JSON.parse(
      (await registry.cli("debug", "skill")).stdout,
    ).find((s) => s.name === "hypersolutions");
    assert.ok(discovered);
    assert.ok(discovered.location.startsWith(registry.env.XDG_CACHE_HOME));
    passed(
      `${global ? "global" : "project"} package-name native npm automatic install from loopback registry serving the packed tarball`,
    );
  }
  const f = await fixture("native-mcp");
  f.config.mcp = {
    powhttp: { type: "remote", url: mock.base + "/powhttp", oauth: false },
    "har-analyzer": {
      type: "remote",
      url: mock.base + "/har",
      oauth: { scope: "mcp" },
    },
    unrelated: { type: "local", command: ["false"], enabled: false },
  };
  f.config.provider = {
    fixture: {
      npm: "@ai-sdk/openai-compatible",
      name: "Synthetic test provider",
      options: { baseURL: mock.base + "/v1", apiKey: "synthetic" },
      models: {
        fixture: { name: "fixture", limit: { context: 128000, output: 8192 } },
      },
    },
  };
  f.config.model = "fixture/fixture";
  f.config.small_model = "fixture/fixture";
  await f.save();
  const list = await f.cli("mcp", "list");
  assert.match(list.stdout, /powhttp/);
  assert.match(list.stdout, /har-analyzer/);
  assert.match(list.stdout, /connected/);
  assert.match(list.stdout, /needs authentication/);
  passed(
    "standalone native mcp list discovers plugin configuration, connects mock powhttp, and reports mock HAR authentication required",
  );
  // Exercise the actual browser/callback CLI flow without launching a real browser.
  const auth = spawn(binary, ["mcp", "auth", "har-analyzer"], {
    cwd: f.project,
    env: { ...f.env, BROWSER: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(auth);
  let authOutput = "";
  auth.stdout.on("data", (d) => (authOutput += d));
  auth.stderr.on("data", (d) => (authOutput += d));
  const deadline = Date.now() + 30000;
  let authorizationUrl;
  while (Date.now() < deadline && !authorizationUrl) {
    authorizationUrl = authOutput.match(
      new RegExp(`${mock.base}/authorize[^\\s\\u001b]+`),
    )?.[0];
    if (!authorizationUrl) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(authorizationUrl, authOutput);
  const redirect = await fetch(authorizationUrl, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  const callback = await fetch(redirect.headers.get("location"));
  assert.equal(callback.status, 200);
  await Promise.race([
    once(auth, "exit"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Auth CLI timeout")), 20000).unref(),
    ),
  ]);
  children.delete(auth);
  assert.match(authOutput, /successful|authenticated/i);
  const authPath = path.join(f.env.XDG_DATA_HOME, "opencode", "mcp-auth.json");
  let credentials = JSON.parse(await readFile(authPath, "utf8"))[
    "har-analyzer"
  ];
  assert.equal(credentials.tokens.refreshToken, "mock-refresh");
  assert.equal(credentials.serverUrl, mock.base + "/har");
  assert.equal((await stat(authPath)).mode & 0o777, 0o600);
  passed(
    "mock native CLI OAuth: metadata discovery, registration, S256 PKCE, loopback callback, token exchange, 0600 credential persistence",
  );
  server = await serve(f);
  assert.equal((await server.api("/mcp"))["har-analyzer"].status, "connected");
  passed(
    "mock OAuth saved credentials reconnect in a new native OpenCode process",
  );
  const skillDir = path.join(f.installed, "skills", "hypersolutions");
  const calls = [
    { name: "skill", arguments: { name: "hypersolutions" } },
    {
      name: "read",
      arguments: {
        filePath: path.join(skillDir, "references", "request-rules.md"),
      },
    },
    {
      name: "bash",
      arguments: {
        command: `python3 '${path.join(skillDir, "scripts", "sec_ch_ua.py")}' 149`,
        description: "Execute packaged helper on synthetic version",
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
  mock.setSequence(calls);
  const session = await server.api("/session", "POST", {});
  await server.api(`/session/${session.id}/message`, "POST", {
    model: { providerID: "fixture", modelID: "fixture" },
    parts: [{ type: "text", text: "Run the synthetic verification sequence." }],
  });
  const messages = await server.api(`/session/${session.id}/message`);
  const parts = messages
    .flatMap((m) => m.parts)
    .filter((p) => p.type === "tool");
  for (const call of calls) {
    const part = parts.find((p) => p.tool === call.name);
    assert.ok(
      part,
      `Missing executed tool ${call.name}; executed ${parts.map((p) => p.tool).join(", ")}`,
    );
    assert.equal(part.state.status, "completed", JSON.stringify(part));
  }
  assert.match(
    parts.find((p) => p.tool === "skill").state.output,
    new RegExp(skillDir),
  );
  assert.match(parts.find((p) => p.tool === "bash").state.output, /Chromium/);
  assert.equal(mock.observed.calls.length, 4);
  assert.ok(mock.observed.lists.includes("powhttp"));
  assert.ok(mock.observed.lists.includes("har"));
  for (const part of parts.filter(
    (p) => p.tool.startsWith("powhttp_") || p.tool.startsWith("har-analyzer_"),
  ))
    assert.match(part.state.output, /"valid":true/);
  passed(
    "native skill loading, native reference read, native helper execution, native discovery and execution of all four synthetic MCP tools with OpenCode names",
  );
  mock.setSequence([
    {
      name: "har-analyzer_analyze_har",
      arguments: { har: "synthetic-invalid-har" },
    },
  ]);
  const errorSession = await server.api("/session", "POST", {});
  await server.api(`/session/${errorSession.id}/message`, "POST", {
    model: { providerID: "fixture", modelID: "fixture" },
    parts: [
      { type: "text", text: "Exercise the synthetic MCP error response." },
    ],
  });
  const errorMessages = await server.api(`/session/${errorSession.id}/message`);
  const errorPart = errorMessages
    .flatMap((m) => m.parts)
    .find((p) => p.type === "tool" && p.tool === "har-analyzer_analyze_har");
  assert.ok(errorPart);
  assert.match(
    errorPart.state.output || errorPart.state.error,
    /\"valid\":false/,
  );
  assert.ok(
    errorMessages.some((m) =>
      m.parts.some(
        (p) =>
          p.type === "text" &&
          p.text === "Synthetic integration sequence complete.",
      ),
    ),
  );
  passed(
    "mock MCP isError tool response reaches native agent and subsequent assistant response completes",
  );
  await server.close();
  server = undefined;
  mock.expireTokens();
  const persisted = JSON.parse(await readFile(authPath, "utf8"));
  persisted["har-analyzer"].tokens.expiresAt = 1;
  await writeFile(authPath, JSON.stringify(persisted), { mode: 0o600 });
  server = await serve(f);
  assert.equal((await server.api("/mcp"))["har-analyzer"].status, "connected");
  assert.ok(mock.observed.grants.includes("refresh_token"));
  credentials = JSON.parse(await readFile(authPath, "utf8"))["har-analyzer"];
  assert.notEqual(
    credentials.tokens.accessToken,
    persisted["har-analyzer"].tokens.accessToken,
  );
  passed(
    "mock native OAuth refresh after expired/rejected access token, refreshed credentials persisted",
  );
  await server.close();
  server = undefined;
  await mock.close();
  mock = undefined;
  const offline = await f.cli("mcp", "list");
  assert.match(offline.stdout, /failed/);
  assert.match(offline.stdout, /powhttp/);
  assert.match(offline.stdout, /har-analyzer/);
  passed(
    "native MCP offline handling reports both unreachable services without crashing",
  );
  await writeFile(
    path.join(work, "results.json"),
    JSON.stringify(
      {
        version: "1.18.35",
        tarball,
        sha256: tarballHash,
        checks: notes,
        mockOnly: true,
      },
      null,
      2,
    ),
  );
  console.log(`Evidence: ${path.relative(root, work)}/results.json`);
} finally {
  if (server) await server.close();
  if (mock) await mock.close();
  for (const child of children) child.kill("SIGKILL");
}
