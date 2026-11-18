# Browser access and CORS

All browser origins are allowed by default in both local and team profiles.
This includes another Open WebUI host/port and the opaque `null` origin of a
sandboxed iframe. Existing configurations with `allowedOrigins:[]` also accept
all origins. The example configuration makes this explicit:

```json
{"server":{"allowedOrigins":["*"]}}
```

The HTTP server applies one policy before authentication and routing, covering
`/oapi/*`, `/api/tool/*`, MCP, model streaming, SSE, pages, downloads and errors.
`OPTIONS` returns an empty 204 response without requiring a token. The response
allows the requested method and headers, including Authorization, JSON content,
task/user scope, MCP session fields, W3C tracing and future client headers.
Preflight approvals are cached for ten minutes.

Requests with an Origin receive that exact origin plus
`Access-Control-Allow-Credentials:true`. This supports credentialed fetches;
`Access-Control-Allow-Origin:*` cannot be used with credentials mode `include`.
Responses vary by Origin. Location, Content-Disposition, context pressure,
MCP session, map metadata and Retry-After headers are exposed to browser code.
These rules follow the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

CORS does not select a user or grant a tool. Actual requests still need the
configured credentials and pass the ordinary tool/environment/principal/story
checks. Authentication and validation errors carry readable CORS headers, so
browser clients can show the actual error.

## Optional restriction

An explicit nonempty list without `*` restricts browser origins in either profile:

```json
{"server":{"allowedOrigins":["https://chat.example.internal","https://tools.example.internal"]}}
```

The configured public URL's origin is also accepted. Entries are exact origins,
including scheme and port, with no path or trailing slash. Add `"null"` explicitly
if a restricted installation needs sandboxed opaque origins. Use `"*"` or an
empty list to restore unrestricted browser origins.

This setting controls browser access to dt. Backend HTTP requests trust all
HTTP(S) destinations and require no per-service URL configuration.

## Reproduce and verify

```sh
node --test test/cors.test.js test/server.test.js test/team-security.test.js
node dev/check-cors-browser.js
```

The browser check launches normal Chromium against two disposable local HTTP
origins. It executes the actual exchange import/list tools, verifies Open WebUI
embed headers and MCP sessions, reads/cancels SSE, inspects real error bodies,
and calls the tool from a sandboxed opaque-origin iframe. No browser security
flags are disabled and no production service is contacted.

The server also acknowledges legacy private-network preflight requests. Modern
Chrome's Local Network Access permission is a separate browser setting; the
[Chrome guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)
describes that permission. CORS headers do not override browser permissions,
mixed-content rules or an upstream proxy that rejects OPTIONS before dt.
