/** Public native OAuth initiation only. Never opens login UI, reads credentials, or submits HAR. */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
const root = process.cwd(),
  dir = path.resolve(".work", `live-auth-${Date.now()}`),
  project = path.join(dir, "project");
await mkdir(project, { recursive: true });
await mkdir(path.join(dir, "home"), { recursive: true });
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
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  BROWSER: "false",
  CI: "1",
  NO_COLOR: "1",
};
const install = spawn(
  "npm",
  [
    "install",
    "--prefix",
    project,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    path.resolve(process.argv[2] || "hypersolutions-opencode-0.1.0.tgz"),
  ],
  { stdio: "ignore" },
);
const [code] = await once(install, "exit");
if (code !== 0) throw new Error(`npm install failed ${code}`);
await writeFile(
  path.join(project, "opencode.json"),
  JSON.stringify({
    plugin: ["./node_modules/hypersolutions-opencode/dist/index.js"],
    mcp: { powhttp: { enabled: false } },
  }),
);
const child = spawn(
  path.resolve(
    process.env.OPENCODE_BIN || ".work/runtime/node_modules/.bin/opencode",
  ),
  ["mcp", "auth", "har-analyzer"],
  { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));
let authorization;
const deadline = Date.now() + 30000;
try {
  while (Date.now() < deadline && !authorization && child.exitCode === null) {
    authorization = output.match(
      /https:\/\/hypersolutions\.co\/oauth\/authorize[^\s\u001b]+/,
    )?.[0];
    if (!authorization) await new Promise((r) => setTimeout(r, 100));
  }
  const result = {
    checkedAt: new Date().toISOString(),
    opencode: "1.18.35",
    scope:
      "Native CLI public OAuth initiation only; stopped before login/account consent",
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
      "No authorization URL produced within 30 seconds. Raw logs kept only in isolated OpenCode log directory.";
  await writeFile(
    path.join(dir, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        evidence: path.relative(root, path.join(dir, "result.json")),
      },
      null,
      2,
    ),
  );
} finally {
  child.kill("SIGKILL");
}
