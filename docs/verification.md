# Testing

Use Node.js 24 and Python 3 for development. Local adapter/build checks also support
Node.js 20.19; the OpenCode 2 integration harness requires Node.js 22.13 or newer.

## Local checks

```bash
npm ci
npm run check
npm test
```

These check native adapter configuration, user overrides, skill content and paths,
public TypeScript declarations, and the Python helper. The content audit checks
bundled files against their recorded upstream hashes and translations.

For a comparison against upstream Git source, follow the
[provenance instructions](../provenance/README.md).

## Native integration tests

The suites install a packed plugin into isolated configurations and exercise native
skill loading, MCP tools, error handling, and OAuth using synthetic services.
They require network access to install dependencies but no production credentials.

```bash
npm pack
npm install --prefix .work/opencode-v2 @opencode/cli@2.0.24
OPENCODE_V2_BIN="$PWD/.work/opencode-v2/node_modules/.bin/opencode" npm run test:integration:v2 -- ./hypersolutions-opencode-0.2.0.tgz

npm install --prefix .work/runtime opencode-ai@1.18.35
npm run test:integration -- ./hypersolutions-opencode-0.2.0.tgz
```

The harnesses require those exact runtime versions. Results are written beneath
ignored `.work/` directories. Synthetic tests do not establish live account access,
external service availability, or success against protected targets.

## Optional live checks

Use a separate test configuration and captures you are authorized to inspect.
Follow the [setup guide](setup.md) to connect powhttp and sign in to the HAR analyzer.
Confirm tool discovery, analyze a small sanitized capture, and inspect the resulting
request, TLS, and HTTP/2 data. Check live OAuth reconnect and refresh separately.
Keep credentials, captures, session identifiers, and local results out of Git.
