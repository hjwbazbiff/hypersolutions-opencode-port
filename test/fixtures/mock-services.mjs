/** Synthetic, loopback-only services. These are not Hyper Solutions implementations. */
import http from "node:http";
import { createHash } from "node:crypto";

export const har = JSON.stringify({
  log: {
    version: "1.2",
    creator: { name: "port-integration-synthetic", version: "1" },
    entries: [],
  },
});
export async function startMockServices(packageFixture) {
  const observed = {
    calls: [],
    lists: [],
    registrations: [],
    grants: [],
    models: [],
    authorization: undefined,
  };
  let sequence = [],
    generation = 0;
  const accepted = new Set();
  const codes = new Map();
  let base;
  const tools = {
    powhttp: [
      {
        name: "find_requests",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "object" },
            include: { type: "array", items: { type: "string" } },
            limit: { type: "number" },
          },
          required: ["query", "include"],
        },
      },
      {
        name: "get_tls_connection",
        inputSchema: {
          type: "object",
          properties: { connectionId: { type: "string" } },
          required: ["connectionId"],
        },
      },
      {
        name: "get_http2_streams",
        inputSchema: {
          type: "object",
          properties: {
            connectionId: { type: "string" },
            streams: { type: "array", items: { type: "object" } },
          },
          required: ["connectionId", "streams"],
        },
      },
    ],
    har: [
      {
        name: "analyze_har",
        inputSchema: {
          type: "object",
          properties: {
            har: { type: "string" },
            verbose_details: { type: "boolean" },
          },
          required: ["har"],
        },
      },
    ],
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      if (packageFixture && url.pathname === "/hypersolutions-opencode") {
        const pkg = packageFixture.manifest;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: pkg.name,
            "dist-tags": { latest: pkg.version },
            versions: {
              [pkg.version]: {
                ...pkg,
                dist: { tarball: base + "/package.tgz" },
              },
            },
          }),
        );
        return;
      }
      if (packageFixture && url.pathname === "/package.tgz") {
        if (packageFixture.tarballDelayMs)
          await new Promise((resolve) =>
            setTimeout(resolve, packageFixture.tarballDelayMs),
          );
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(packageFixture.tarball);
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const json = (status, data, headers = {}) => {
        res.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        });
        res.end(JSON.stringify(data));
      };
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return json(200, {
          resource: `${base}/har`,
          authorization_servers: [base],
          scopes_supported: ["mcp"],
        });
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["mcp"],
        });
      if (url.pathname === "/register") {
        const body = JSON.parse(raw);
        observed.registrations.push(body);
        return json(201, { ...body, client_id: "mock-opencode-client" });
      }
      if (url.pathname === "/authorize") {
        observed.authorization = Object.fromEntries(url.searchParams);
        const code = `mock-code-${codes.size}`;
        codes.set(code, url.searchParams.get("code_challenge"));
        const redirect = new URL(url.searchParams.get("redirect_uri"));
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { location: redirect.href });
        return res.end();
      }
      if (url.pathname === "/token") {
        const params = new URLSearchParams(raw);
        const grant = params.get("grant_type");
        observed.grants.push(grant);
        if (grant === "authorization_code") {
          const expected = codes.get(params.get("code"));
          const got = createHash("sha256")
            .update(params.get("code_verifier") || "")
            .digest("base64url");
          if (!expected || expected !== got)
            return json(400, { error: "invalid_grant" });
        } else if (
          grant !== "refresh_token" ||
          params.get("refresh_token") !== "mock-refresh"
        )
          return json(400, { error: "invalid_grant" });
        const token = `mock-access-${++generation}`;
        accepted.add(token);
        return json(200, {
          access_token: token,
          token_type: "Bearer",
          refresh_token: "mock-refresh",
          expires_in: 3600,
          scope: "mcp",
        });
      }
      if (url.pathname === "/v1/chat/completions") {
        const body = JSON.parse(raw);
        observed.models.push(body);
        const step = body.tools?.length ? sequence.shift() : undefined;
        const delta = step
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call_${observed.models.length}`,
                  type: "function",
                  function: {
                    name: step.name,
                    arguments: JSON.stringify(step.arguments),
                  },
                },
              ],
            }
          : {
              role: "assistant",
              content: "Synthetic integration sequence complete.",
            };
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (delta, finish_reason = null) =>
          res.write(
            `data: ${JSON.stringify({ id: "mock-response", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        chunk(delta);
        chunk({}, step ? "tool_calls" : "stop");
        res.end("data: [DONE]\n\n");
        return;
      }
      if (["/powhttp", "/har"].includes(url.pathname)) {
        const kind = url.pathname.slice(1);
        if (
          kind === "har" &&
          !accepted.has(
            (req.headers.authorization || "").replace(/^Bearer /, ""),
          )
        )
          return json(
            401,
            { error: "unauthorized" },
            {
              "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
            },
          );
        if (req.method === "GET" || req.method === "DELETE") {
          res.writeHead(405);
          return res.end();
        }
        const message = JSON.parse(raw);
        if (!("id" in message)) {
          res.writeHead(202);
          return res.end();
        }
        let result;
        if (message.method === "initialize")
          result = {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: `synthetic-${kind}`, version: "1" },
          };
        else if (message.method === "tools/list") {
          observed.lists.push(kind);
          result = {
            tools: tools[kind].map((t) => ({
              ...t,
              description: `Synthetic fixture ${t.name}`,
            })),
          };
        } else if (message.method === "tools/call") {
          observed.calls.push({ kind, ...message.params });
          const { name, arguments: args } = message.params;
          const valid =
            name === "find_requests"
              ? args.query?.sessionId === "synthetic-session"
              : name === "get_tls_connection"
                ? args.connectionId === "synthetic-tls"
                : name === "get_http2_streams"
                  ? args.connectionId === "synthetic-http2" && args.streams?.[0]?.id === 1
                  : name === "analyze_har"
                    ? args.har === har
                    : false;
          result = {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  synthetic: true,
                  tool: name,
                  valid,
                  entries:
                    name === "find_requests"
                      ? [
                          {
                            url: "https://example.invalid/fixture",
                            tls: { connectionId: "synthetic-tls" },
                            http2: { connectionId: "synthetic-http2", streamId: 1 },
                          },
                        ]
                      : [],
                }),
              },
            ],
            isError: !valid,
          };
        } else
          return json(200, {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" },
          });
        return json(200, { jsonrpc: "2.0", id: message.id, result });
      }
      if (
        packageFixture &&
        req.method === "GET" &&
        !url.pathname.startsWith("/v1/")
      ) {
        const response = await fetch(`https://registry.npmjs.org${req.url}`);
        res.writeHead(response.status, {
          "content-type":
            response.headers.get("content-type") || "application/octet-stream",
        });
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      json(404, { error: "fixture route not found", path: url.pathname });
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    observed,
    setSequence(value) {
      sequence = [...value];
    },
    expireTokens() {
      accepted.clear();
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
