This is an unofficial port, any problems with the plugin please [raise an issue here](https://github.com/hjwbazbiff/hypersolutions-opencode-port/issues).

# Hyper Solutions — OpenCode Plugin

An unofficial OpenCode port of the Hyper Solutions [Codex](https://github.com/Hyper-Solutions/hypersolutions-codex) / [Claude Code](https://github.com/Hyper-Solutions/hypersolutions-claude-code) plugin.

Teaches OpenCode to **integrate and debug the Hyper Solutions anti-bot API**
(Akamai, Incapsula, DataDome, Kasada) across the Go, Python, and JavaScript/TypeScript
SDKs and raw REST API — and debug failing requests by inspecting captured traffic.

It bundles:

- A **skill** with the integration and debugging playbook, product references, and a
  helper for generating correct Chrome `sec-ch-ua` headers.
- **powhttp MCP** — inspect live request headers, TLS fingerprints, and HTTP/2 frames.
- **har-analyzer MCP** — analyze exported HAR files using Hyper Solutions’ maintained
  fingerprint rules and return structured findings.

Ask OpenCode things like:

- “Help me set up the Akamai sensor flow in Python with tls-client.”
- “My DataDome slider solve returns 403 — capture my script with powhttp and tell me what’s wrong.”
- “Analyze my captured requests and find why I’m getting blocked.”
- “Why is my `_abck` cookie never becoming valid?”

## Install

Requires **OpenCode 2.0.24+ within 2.x**, **Node.js 20.19+**, and **Python 3** for the
header helper. The package is not on npm; build it from this repository:

```bash
git clone https://github.com/hjwbazbiff/hypersolutions-opencode-port.git
cd hypersolutions-opencode-port
npm ci
npm pack

opencode_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
npm install --prefix "$opencode_config_dir" "$PWD/hypersolutions-opencode-0.2.0.tgz"
```

Add this entry to `plugins` in that directory’s `opencode.json` or `opencode.jsonc`:

```json
{
  "plugins": ["./node_modules/hypersolutions-opencode"]
}
```

Reload OpenCode, then sign in to the hosted HAR analyzer with your Hyper Solutions account:

```bash
opencode reload
opencode mcp auth har-analyzer
opencode mcp list
```

You can also sign in through `/mcps` in OpenCode. HAR analysis uses OAuth;
SDK/API calls use your Hyper Solutions API key.

Start a new session and ask one of the questions above. To load the skill explicitly,
ask “Load the hypersolutions skill.” See [setup](docs/setup.md) for project installs,
OpenCode 1, remote OAuth, and server overrides.

### Development

After editing, run `npm test`, rebuild with `npm pack`, reinstall the tarball, and
run `opencode reload`. See [maintenance](docs/maintenance.md) for upstream updates.

## Using the powhttp request debugger

The plugin connects to powhttp at `http://localhost:8383/mcp`.

1. Install and run [powhttp](https://powhttp.com). In **Settings → MCP Server**, click **Run MCP server**.
2. In **Settings → Root Certificate**, generate/export the certificate and trust it in your test client. Enable TLS interception (the padlock) and recording in your capture session.
3. Route your script through the **proxy address displayed in that session** (normally `http://127.0.0.1:8080`) and run the failing flow.
4. Ask OpenCode to debug it. It can inspect the captured headers, TLS fingerprint, cookies, and client hints.

Without powhttp, you can still analyze an exported HAR. See the
[powhttp reference](skills/hypersolutions/references/powhttp-mcp.md).

### Headless Linux

powhttp needs a desktop session. On a **Debian server**, use
[Xvfb](https://manpages.debian.org/bookworm/xvfb/Xvfb.1.en.html) and
[x11vnc](https://manpages.debian.org/bookworm/x11vnc/x11vnc.1.en.html)
to access it over SSH. Download the Linux `.deb` for your architecture from
[powhttp](https://powhttp.com), then run on the server:

```bash
sudo apt update
sudo apt install ./powhttp_*.deb xvfb xauth x11vnc openbox dbus-x11 tmux firefox-esr
x11vnc -storepasswd

tmux new -s powhttp
xvfb-run -a -s '-screen 0 1440x1000x24 -nolisten tcp' dbus-run-session sh -c '
  openbox &
  x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -usepw -forever &
  BROWSER=firefox-esr GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 powhttp
'
```

On your own computer, open an SSH tunnel:

```bash
ssh -N -L 5900:127.0.0.1:5900 user@your-server
```

Connect a VNC viewer to `127.0.0.1:5900` using the password you set. Sign in to
powhttp if prompted, then enable its MCP server, certificate, TLS interception,
and recording as above. Use the browser in the remote desktop for sign-in.

Detach tmux with **Ctrl+B, then D** to leave powhttp running after disconnecting;
restart it after a server reboot. Run OpenCode and your script on the same server:
the plugin’s default MCP address works unchanged. Keep port **8383** and the
capture-proxy port blocked from public access in your server firewall.

## Using the HAR analyzer

The hosted analyzer at `https://har-mcp.hypersolutions.co/mcp` runs Hyper Solutions’
current fingerprint checks against exported traffic. Ask OpenCode to analyze a
`.har` file: it reports findings by severity, suggests fixes, and identifies the
anti-bot product. Sign in once using `opencode mcp auth har-analyzer`; no API key is
needed for this service.

Remove sensitive cookies and tokens before sharing a HAR. HAR files contain no TLS
fingerprint, and header-order accuracy depends on the recorder: powhttp preserves
wire order; browser exports may not. See the
[HAR analyzer reference](skills/hypersolutions/references/har-analyzer-mcp.md).

## What’s inside

```text
src/                              Native OpenCode plugin adapters and MCP registration
skills/hypersolutions/
  SKILL.md                        Integration, product routing, and debugging
  scripts/sec_ch_ua.py             Exact Chrome sec-ch-ua / GREASE helper
  references/
    authentication.md             API keys, JWT signing, organization headers
    tls-and-headers.md            TLS, header order, proxies, Chrome versions
    akamai.md                     Sensor, SEC-CPT, SBSD, pixel
    incapsula.md                  reese84, dynamic challenges, utmvc
    datadome.md                   Interstitial, slider, tags
    kasada.md                     Payload, proof of work, Vercel BotID
    api-reference.md              Endpoints, SDK signatures, REST, compression
    powhttp-mcp.md                Live request-capture debugging
    har-analyzer-mcp.md           Automated HAR analysis
    request-rules.md              Request-fingerprinting principles
    debugging.md                  Symptom → cause → fix
```

## Maintaining this plugin

Keep API usage and general browser-fingerprinting guidance in the skill and
references. Exhaustive, evolving detection rules belong in the hosted HAR analyzer.
See [maintenance](docs/maintenance.md) and [upstream attribution](THIRD_PARTY_NOTICES.md).

## Links

- [Dashboard / API keys](https://hypersolutions.co/keys)
- [Hyper Solutions documentation](https://docs.hypersolutions.co)
- [Examples](https://github.com/Hyper-Solutions/hypersolutions-examples)
- SDKs: [Go](https://github.com/Hyper-Solutions/hyper-sdk-go) · [Python](https://github.com/Hyper-Solutions/hyper-sdk-py) · [JS/TS](https://github.com/Hyper-Solutions/hyper-sdk-js)
- [Discord support](https://discord.gg/akamai) (For plugin support, please [raise an issue on GitHub](https://github.com/hjwbazbiff/hypersolutions-opencode-port/issues).)
