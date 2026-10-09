# OpenCode setup and troubleshooting

This is the unofficial OpenCode port of [Hyper Solutions’ Codex plugin](https://github.com/Hyper-Solutions/hypersolutions-codex). See the [README](../README.md) for requirements and checkout instructions.

## OpenCode 2: global installation

Keep your existing OpenCode 2 installation. Build the package in this checkout:

```bash
npm ci
npm test
npm pack
```

Install the resulting tarball into OpenCode's global config directory:

```bash
opencode_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
npm install --prefix "$opencode_config_dir" /absolute/path/hypersolutions-opencode-0.2.0.tgz
```

In `$opencode_config_dir/opencode.json` (or your existing `opencode.jsonc`), add this
plugin entry while preserving all existing settings and other plugin entries:

```json
{
  "plugins": ["./node_modules/hypersolutions-opencode"]
}
```

Use the **package directory**, not `dist/index.js`: the released OpenCode 2.0.24 local
plugin loader discovers the packaged `server.js` entry. Restart OpenCode or run
`opencode reload` after changing configuration. Verify and authenticate:

```bash
opencode --version
opencode plugin list
opencode mcp list
opencode mcp auth har-analyzer
opencode api GET /api/skill
```

The plugin list should include `hypersolutions`; the skill list should include ID
`hypersolutions`. In OpenCode's interactive UI you can also use `/mcps` to sign in.
These CLI commands use OpenCode's native persistent service and the current
project's configuration. V2.0.24 activates plugins asynchronously: if an immediate
first check is empty, wait briefly and run it again. Avoid `api --standalone` for
this check because its temporary server can exit before plugins activate.

### OpenCode 2: project installation

From the target project:

```bash
npm install --prefix .opencode /absolute/path/hypersolutions-opencode-0.2.0.tgz
```

Merge into the project-root `opencode.json` or `opencode.jsonc`:

```json
{
  "plugins": ["./.opencode/node_modules/hypersolutions-opencode"]
}
```

Run MCP commands from that project. Relative paths are resolved from the config file
containing them, so a config inside `.opencode/` uses `./node_modules/...` instead.

On Windows, use the OpenCode global configuration directory selected by XDG settings
(normally `%USERPROFILE%\.config\opencode`) as npm's `--prefix`. Use forward slashes
in JSON paths or an absolute `file:///C:/.../hypersolutions-opencode` directory URL.
Native runtime testing is on Linux; macOS/Windows runtime support is not yet verified.

### Retained OpenCode 1 installation

For OpenCode 1.18.35, install the same tarball but use the singular `plugin` setting:

```json
{
  "plugin": ["./node_modules/hypersolutions-opencode/dist/index.js"]
}
```

That example is global; a project-root config uses
`./.opencode/node_modules/hypersolutions-opencode/dist/index.js`. V1 verifies skills
with `opencode debug skill`; it also provides `opencode mcp auth list` and
`opencode mcp debug har-analyzer`. Those are **not OpenCode 2 commands**.
V1 uses the separate `server()` hook, while V2 uses `setup(ctx)`.

### Registry installation, once published

The package is **not published to npm**, and `private: true` blocks accidental publication. Install from the local tarball. A future registry release requires an explicit release decision and removal of that guard.
After publication, add `hypersolutions-opencode@0.2.0` to `plugins` (V2) or `plugin`
(V1). OpenCode installs the package itself. On V2, the equivalent global command is
`opencode plugin add hypersolutions-opencode@0.2.0`. An `npm install -g` alone does
not register an OpenCode plugin.

## Update an installed build

From your clone, run `git pull --ff-only`, `npm ci`, `npm test`, and `npm pack`.
Install the new tarball into the same global or project prefix used above, then run
`opencode reload` and start a fresh session. Preserve your existing configuration.
The registry installation instructions apply only after a future npm publication.

## Authentication and reconnect

`opencode mcp auth har-analyzer` starts native discovery, client registration, PKCE
and browser authorization. Complete the Hyper Solutions account sign-in. No API key
is needed for this MCP. In the V2 UI, use `/mcps` to authenticate; the model should
ask the user to complete the sign-in rather than run an interactive login itself.

OpenCode 2 uses an ephemeral loopback callback port with `/callback` by default.
For a remote/headless CLI, use a browser that reaches the CLI machine, or configure
native OAuth `callback_port` and forward that port. OpenCode 2 owns credential
persistence in its native SQLite store (`opencode.db` under its data directory),
reconnect and token refresh. The integration identity includes server name and URL.
The adapter never reads or writes the credential store. Inspect connection status
with `opencode mcp list` or `opencode api GET /api/mcp`.

If access was revoked or refresh fails:

```bash
opencode mcp logout har-analyzer
opencode mcp auth har-analyzer
```

V1 differs: default callback `http://127.0.0.1:19876/mcp/oauth/callback`, credentials
in its data directory's `mcp-auth.json`. Do not transfer credential files between
major versions; use the host's native sign-in flow.

powhttp is a loopback service and its default registration disables OAuth. API keys,
optional JWT signatures and organization credentials are a separate SDK/REST
workflow, fully covered in
[authentication.md](../skills/hypersolutions/references/authentication.md).

## Usage

OpenCode discovers the registered `hypersolutions` skill from the installed package
and makes it available to its native `skill` tool. V2 uses `{ "id": "hypersolutions" }`;
V1 uses `{ "name": "hypersolutions" }`. The model loads it when appropriate; you
can explicitly ask it to “load the hypersolutions skill.” Skill permissions still
apply. References and scripts resolve relative to the skill base directory reported
by that tool, even when npm installs the package in OpenCode's cache.

Example prompts:

- “Help me set up the Akamai sensor flow in Python with tls-client.”
- “My DataDome slider solve returns 403 — capture my script with powhttp and tell me what's wrong.”
- “Analyze my captured requests and find why I'm getting blocked.”
- “Why is my `_abck` cookie never becoming valid?”

### Live powhttp debugging

1. Install and run [powhttp](https://powhttp.com), then click **Run MCP server**.
   Its default endpoint is `http://localhost:8383/mcp`.
2. Create a dedicated capture session. Generate the powhttp root certificate, trust
   it only in the intended test client, enable TLS interception (the padlock) and
   recording. Route the script through the **proxy address displayed by that
   session**; do not assume a fixed port. Chain an upstream proxy if needed.
   Verify that actual HTTPS request entries appear before analyzing the flow.
3. Ask OpenCode to inspect the relevant requests. Use `tls.connectionId` for the TLS
   tool and `http2.connectionId` for the HTTP/2 tool; these IDs can differ. The tools are
   `powhttp_find_requests`, `powhttp_get_tls_connection`, and
   `powhttp_get_http2_streams`. They expose wire header order, TLS/HTTP2 details,
   cookies, and client hints. Narrow queries to the relevant capture and host.

If the MCP is unavailable, start it and restart/reconnect OpenCode. An exported HAR
can still be analyzed by the hosted service or manually using the bundled principles.
See the full [powhttp workflow](../skills/hypersolutions/references/powhttp-mcp.md).

### Hosted HAR analysis

Authenticate, then ask OpenCode to analyze your `.har` file. The native tool name is
`har-analyzer_analyze_har` (the hyphen is intentional). It takes the entire HAR JSON
as a **string** in `har`, with optional `verbose_details: true`, and returns detected
products and structured findings with severity, category, and suggested fixes.
It uses `https://har-mcp.hypersolutions.co/mcp` and the current server-side rules.
For large HARs, select the relevant entries locally, preserve the HAR envelope and
request ordering, and decode base64 bodies before comparing their content.

HARs may contain cookies and tokens: sanitize sensitive data before sharing and use
only the capture you intend to analyze. Header-order findings are reliable only when
the recorder preserves wire order, such as powhttp; Charles/DevTools normalize it.
A HAR never includes the TLS fingerprint. Escalate unresolved cases to a live
powhttp capture. If hosted analysis is unavailable, apply
[request-rules.md](../skills/hypersolutions/references/request-rules.md) manually, followed
by the relevant product reference and symptom-to-fix guide. See the full
[HAR workflow](../skills/hypersolutions/references/har-analyzer-mcp.md).

## Configuration and overrides

The V2 setup registers synchronous native MCP/skill transforms. It supplies each
server only when no definition already exists, preserving the entire user object.
Both endpoints default to `codemode: false`, exposing the documented direct tool
names. The native defaults correspond to:

```json
{
  "mcp": {
    "servers": {
      "powhttp": {
        "type": "remote", "url": "http://localhost:8383/mcp",
        "oauth": false, "codemode": false
      },
      "har-analyzer": {
        "type": "remote", "url": "https://har-mcp.hypersolutions.co/mcp",
        "codemode": false
      }
    }
  }
}
```

To disable a server on V2, provide its full definition with `disabled: true`:

```json
{
  "mcp": {
    "servers": {
      "har-analyzer": {
        "type": "remote",
        "url": "https://har-mcp.hypersolutions.co/mcp",
        "disabled": true
      }
    }
  }
}
```

V2 discards the old short `{ "enabled": false }` entry before plugins see it; use
that full native form. Custom URLs, headers, timeouts, local transports, OAuth
settings and protocol/Code Mode choices remain intact. An override is a complete
server definition, not a partial merge. Remove it to restore plugin defaults.
For custom timeouts, set them in that full server definition: V2's global
`mcp.timeout` defaults are applied by its configuration loader to config-defined
servers, so they do not automatically apply to servers added by plugin transforms.

If you override a server with `codemode: true` (or omit it in a V2 user definition),
OpenCode exposes it through native Code Mode: `tools.powhttp.find_requests(...)` or
`tools["har-analyzer"].analyze_har(...)` via `execute`. The same server tools and
schemas remain available; the bundled references describe both presentations.

V2 preserves a preexisting skill with the same ID. Native permissions still control
whether the skill/tools can be used. For example, deny this skill using:

```json
{
  "permissions": [
    { "action": "skill", "resource": "hypersolutions", "effect": "deny" }
  ]
}
```

The V1 adapter appends the installed skill directory once to `skills.paths`, supplies
only missing `mcp` entries, and preserves V1's short `{ "enabled": false }` form.
V1 skill permissions use `permission.skill.hypersolutions`. Both adapters leave
unrelated settings, servers and permissions untouched, and neither rewrites config.

To uninstall, log out if you want native credentials removed, remove the plugin
configuration entry, uninstall the npm package from its installation prefix, and
reload/restart OpenCode. V2 disposes the plugin's native transforms on unload.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| No skill or servers | Check the package-directory path, OpenCode version, `opencode plugin list`, and `opencode debug config`; restart after configuration changes. For project installs, run commands from that project. |
| Skill listed but not loaded | Explicitly request the native skill and inspect skill permissions. A user's same-named skill may take precedence; remove duplicates if unintended. |
| powhttp connection failed | Start its MCP server, check the configured URL/port, and restart/reconnect. Offline powhttp does not remove the skill or manual HAR fallback. |
| HAR needs authentication / 401 | Run `opencode mcp auth har-analyzer`; inspect `opencode mcp list` and the native `/mcps` UI. |
| Browser cannot complete auth | Check the callback URL printed by your host, loopback forwarding, service/account access and browser reachability. Renew authorization with logout/auth if needed. |
| Tools remain disabled | Remove a disabled user override or provide a full enabled native server definition. The plugin deliberately preserves overrides. |
| Helper not found | Use the skill tool's installed base directory and a quoted absolute path; invoke Python 3. |
| Hyper API returns `access denied` | Check the key and access to the requested product. Successful usage/IP calls do not establish Incapsula or other product access. |
| HAR has no findings but requests fail | Check capture scope, recorder header ordering, and TLS using powhttp. |
