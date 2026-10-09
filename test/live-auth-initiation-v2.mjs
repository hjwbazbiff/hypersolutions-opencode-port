/** Public native2 OAuth initiation only; no account login, credential reuse, or HAR upload. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import path from "node:path";
import net from "node:net";
const binary = process.env.OPENCODE_V2_BIN || "opencode";
const tarball = path.resolve(
  process.argv[2] || "hypersolutions-opencode-0.2.0.tgz",
);
const dir = path.resolve(".work", `native2-live-auth-${Date.now()}`),
  project = path.join(dir, "project"),
  configDir = path.join(dir, "config/opencode");
await Promise.all([
  mkdir(project, { recursive: true }),
  mkdir(configDir, { recursive: true }),
  mkdir(path.join(dir, "home"), { recursive: true }),
]);
const env = {
  PATH: process.env.PATH,
  HOME: path.join(dir, "home"),
  OPENCODE_TEST_HOME: path.join(dir, "home"),
  XDG_CONFIG_HOME: path.join(dir, "config"),
  XDG_DATA_HOME: path.join(dir, "data"),
  XDG_CACHE_HOME: path.join(dir, "cache"),
  XDG_STATE_HOME: path.join(dir, "state"),
  OPENCODE_DB: "native2-live-auth.db",
  CI: "1",
  NO_COLOR: "1",
  BROWSER: "false",
};
function start(command, args) {
  const child = spawn(command, args, {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", (d) => (child.output += d));
  child.stderr.on("data", (d) => (child.output += d));
  return child;
}
async function run(command, args) {
  const child = start(command, args);
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} failed ${code}: ${child.output}`);
  return child.output;
}
const portServer = net.createServer();
await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
await writeFile(
  path.join(configDir, "service.json"),
  JSON.stringify({ hostname: "127.0.0.1", port }),
);
await run("npm", [
  "install",
  "--prefix",
  configDir,
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  tarball,
]);
await writeFile(
  path.join(configDir, "opencode.json"),
  JSON.stringify({
    plugins: [
      "-opencode.config.skill",
      "./node_modules/hypersolutions-opencode",
    ],
    mcp: {
      servers: {
        powhttp: {
          type: "remote",
          url: "http://localhost:8383/mcp",
          disabled: true,
        },
      },
    },
  }),
);
let child;
try {
  const version = (await run(binary, ["--version"])).trim();
  if (version !== "opencode v2.0.24")
    throw new Error(`Unexpected version ${version}`);
  let ready = false;
  for (let n = 0; n < 40 && !ready; n++) {
    ready = (await run(binary, ["mcp", "list"])).includes("har-analyzer");
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("Native2 plugin did not activate");
  child = start(binary, ["mcp", "auth", "har-analyzer"]);
  let authorization;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !authorization && child.exitCode === null) {
    authorization = child.output.match(
      /https:\/\/hypersolutions\.co\/oauth\/authorize[^\s\u001b]+/,
    )?.[0];
    if (!authorization) await new Promise((r) => setTimeout(r, 100));
  }
  const result = {
    checkedAt: new Date().toISOString(),
    opencode: version,
    sha256: createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex"),
    scope:
      "Native2 CLI public OAuth initiation only; stopped before account login or consent",
    initiated: !!authorization,
  };
  if (authorization) {
    const url = new URL(authorization);
    Object.assign(result, {
      authorizationEndpoint: url.origin + url.pathname,
      queryKeys: [...url.searchParams.keys()].sort(),
      redirectUri: url.searchParams.get("redirect_uri"),
      codeChallengeMethod: url.searchParams.get("code_challenge_method"),
      requestedScope: url.searchParams.get("scope"),
    });
  } else
    result.error =
      "No authorization URL within 30 seconds; raw diagnostic log remains inside isolated fixture.";
  await writeFile(
    path.join(dir, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        evidence: path.relative(process.cwd(), path.join(dir, "result.json")),
      },
      null,
      2,
    ),
  );
  if (!result.initiated) process.exitCode = 1;
} finally {
  if (child?.exitCode === null) child.kill("SIGKILL");
  await run(binary, ["service", "stop"]);
}
