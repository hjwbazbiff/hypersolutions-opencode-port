/** Read-only, public discovery only: never reads captures or stored credentials. */
const result = {
  checkedAt: new Date().toISOString(),
  scope: "Public HTTP discovery only; no MCP tools called and no HAR uploaded",
  checks: [],
};
for (const url of [
  "http://localhost:8383/mcp",
  "https://har-mcp.hypersolutions.co/mcp",
  "https://har-mcp.hypersolutions.co/.well-known/oauth-protected-resource",
  "https://hypersolutions.co/.well-known/oauth-authorization-server",
]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    const check = {
      url,
      status: response.status,
      wwwAuthenticate: response.headers.get("www-authenticate"),
    };
    if (url.includes("/.well-known/")) {
      try {
        check.metadata = JSON.parse(body);
      } catch {
        check.metadata = "Non-JSON response";
      }
    }
    result.checks.push(check);
  } catch (error) {
    result.checks.push({ url, error: error.message, code: error.cause?.code });
  }
}
console.log(JSON.stringify(result, null, 2));
