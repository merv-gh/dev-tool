# Browser traffic and reusable API requests

The API client connects Playwright UI inspection, observed network exchanges, cached service endpoints and existing scripts/collections. Every step is a separate tool. Importing or inspecting traffic does not replay requests. Sending a request is an explicit `api_request_replay` call or the API client's **Send METHOD** button.

Open WebUI receives a sandboxed response explorer by default. It includes status, timing, safe request/response headers, collapsible JSON, handler candidates, provenance, omissions and downloads. The separate `client` URL opens the editable API client; link it directly in chat. Sandboxed views have no network capability, and a popup from an embedded sandbox may inherit its restrictions. The view therefore offers **Copy API client URL**, while the top-level client uses the normal trusted `/api/tool/*` endpoints. The client keeps runtime parameter values in page memory, never local storage.

## Workflow

1. `api_browser_open` opens an isolated browser session, detects the available capture adapter before navigation, then visits `site`/`link` with `params`, or a `url`. The configured Playwright MCP endpoint is `browser.mcp` / `DT_BROWSER_MCP`. Cookies stay in the browser; this session is distinct from an agent's own browser.
2. `api_browser_action` takes a snapshot, clicks/types/presses a key, or waits, using the endpoint's Playwright MCP arguments. Use `describe:true` to inspect a selected action's schema without acting. Older `ref` arguments map to `target` when the discovered schema requires it. Inspect the snapshot's element references before acting. Actions in the application can have real effects, just as normal browser actions do.
3. `api_browser_capture` drains completed exchanges, records route observations and returns exchange ids, the default explorer and the editable client's URL. Continue interacting in the same session, or call `api_browser_close` to discard it. Idle sessions close after 15 minutes; at most 20 may be active.
4. `api_exchange_get` inspects one stored exchange. `api_exchange_list` searches by URL, method, response status or service. Alternatively `api_exchange_import` accepts a HAR, structured exchange/list, or `browser_network_requests` text from another browser context.
5. `api_request_prepare` turns one exchange into an editable v1 request with explicit parameter locations. It sends nothing. Review the route candidates, URL, method, body, required credential placeholders and capture gaps.
6. `api_request_replay` sends the intended request once, using parameters supplied for this run. It records a separate sanitized exchange and displays its response. HTTP error statuses remain inspectable results.
7. `api_request_save` stores the request as a normal script in `collection/name`. Set `tool:true` for a frequently used individual operation, or expose its collection using `script_collection`. Collection vars and before/after/finally hooks, datasets, assertions, suite history and CI reports continue through the existing script/collection engine.

```json
{"site":"shop","link":"order","params":{"orderId":42}}
```

```json
{"session":"<browser session id>","action":"click","args":{"element":"Order details","ref":"e12"}}
```

```json
{"exchange":"<exchange id>","bindings":{"orderId":{"in":"path","index":3},"expand":{"in":"query","key":"expand"},"quantity":{"in":"body","path":"items.0.quantity"}},"description":"Retrieve an order with related items"}
```

Path indices include the initial empty segment: `/api/orders/42` has `42` at index 3. URL parameters are encoded independently; `a/b` becomes `a%2Fb`, and an ampersand in a query value cannot become a new query parameter. JSON body bindings retain supplied numeric/boolean types. No binding infers a captured value as a stored default.

```json
{"id":"orders/get-order","exchange":"<exchange id>","bindings":{"orderId":{"in":"path","index":3}},"assertions":[{"name":"found","path":"status","op":"equal","value":200}],"capture":{"orderId":"json.id"}}
```

For a prepared request, supply the object returned by `api_request_prepare` as `prepared`. It contains `schema: "dt.api-request"`, `version: 1`, `request`, `params`, `script`, and `mutation`. Request bodies use `{kind:"json",value:{...}}`, `{kind:"form",value:"id=42"}`, `{kind:"text",value:"reviewed payload",reviewed:true}` or `{kind:"none"}`.

## Capture fidelity and credentials

Current Playwright MCP provides `browser_network_request`: dt prefers this native adapter to list request indices, inspect headers and read a selected bounded body. Each detail batch has a 30 second budget; already captured indices are skipped, pending responses can be retried, and count/byte budget gaps tell the agent to capture again. Compressed bodies are omitted. No unsafe code capability is needed. Older MCP endpoints with `browser_run_code` support a fixed capture adapter attached to the page. It records requests as they finish, drains asynchronous response reads, preserves observation sequence, and reads textual/JSON response bodies only when the reported Content-Length is known and at most 256 KiB. Binary, multipart, unknown-length and oversized bodies are explicit unavailable/unsupported values. Content-Length bounds wire bytes; decompression can expand a response before Playwright returns it, so the stored-body limit is checked again. The rolling browser buffer is at most 100 exchanges and a conservative 3 MiB; overflow and pending responses are reported. WebSockets, streaming subscription messages, downloads and service-worker internal activity are not claimed as complete HTTP exchanges.

A browser lacking both native `browser_network_request` and legacy `browser_run_code` still works through `browser_network_requests`, with **metadata-only** gaps. Network text establishes method/URL/status, not missing bodies, headers or behavioral expectations. Use a bounded HAR import when a response body is needed. Imports are limited to 100 exchanges and 4 MiB. Persisted exchange retention is the newest 500 records, independently of reusable scripts.

Cookies, Set-Cookie, host/transport headers and inline URL credentials are omitted. Sensitive request fields in headers, query, JSON and form bodies become required named placeholders with no captured default. Sensitive response fields are redacted and never become request parameters. Arbitrary text has no reliable field structure, so imported unstructured text is omitted by default; the client can explicitly supply a reviewed text body. Review its content before saving, and use placeholders for credentials. Source notes must describe provenance, not contain secrets. Known field-name redaction does not establish that arbitrary domain identifiers are anonymous.

The tool declarations provide `logArgs` policies so the shared registry records only safe scalar ids/actions, never raw HAR data, typed UI values or runtime credentials. This must be preserved by alternate tool dispatchers. The browser capture adapter may receive credentials transiently from the browser to sanitize an exchange; they are never written to the exchange store or transferred from browser cookies to HTTP replay.

## Replay and route evidence

Replay uses the same HTTP executor as saved script HTTP steps. Configure exact origins and path prefixes under `scripts.http.allow`:

```json
{"scripts":{"http":{"allow":["https://orders.dev.example/api","https://gateway.dev.example/api/orders"]}}}
```

URL origins and path boundaries are compared after parsing; a prefix for `/api` cannot permit `/api-evil`, a lookalike host or inline userinfo. Redirects fail, requests are rate limited, responses are streamed to a bounded buffer, and each call has a timeout. No automatic mutation retries are added. Browser cookies are unavailable to this executor; supply explicit named API credentials when needed. Ordinary script collection retry/poll rules remain GET/HEAD-only unless an existing tool explicitly declares idempotence.

Route attribution uses cached passport endpoints and preserves every candidate with the greatest matching path specificity. A shared gateway path can therefore remain **ambiguous** across services. This is evidence of a matching path and method, rather than a proof that the gateway routed to one candidate. File/line and handler provenance are retained when saving, even if a later passport refresh changes the current match.

## Composition and replacement

The stable boundaries are [exchange v1](../schemas/api-exchange.v1.schema.json), [request v1](../schemas/api-request.v1.schema.json), and normal script JSON. `lib/api-client.js` keeps normalization, local persistence, preparation, replay, browser adaptation and presentation as separate exported functions. `lib/tools-api-client.js` is a thin tool facade; `routes.resolve` supplies cached attribution, and `scripts.httpRequest` is the shared HTTP executor. The explorer consumes plain exchange JSON and cannot issue live calls.

A faster-language capture service, a new network inspector, remote evidence store or a different graph/RAG backend can emit these JSON contracts without changing the saved-request format or collection runner. Preserve version numbers, unknown/ambiguous/gap semantics, safe log policies and credential boundaries. Future incompatible semantics require a new version, rather than reinterpreting old evidence.

Verification: `node --test test/api-client.test.js test/scripts.test.js test/collections.test.js`. Tests use actual local HTTP, a fake streamable Playwright MCP server, and executed fixed capture instrumentation against a fake Playwright page. They cover capture ordering/overflow/body omissions, method/status/headers/timing, handler ambiguity, credential removal, URL parameter encoding, replay allowlists/redirects/truncation, script collection hooks and source provenance. The opt-in real-browser regression is `DT_TEST_BROWSER_MCP=http://127.0.0.1:<port>/mcp node --test test/api-client.live.test.js`. It creates a disposable local page and API and requires Docker Desktop's `host.docker.internal` (or `DT_TEST_BROWSER_HOST`). Customer browser authentication remains environment-specific.
