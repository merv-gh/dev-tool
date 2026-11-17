# Named views, API actions and UI events

Pages use the existing `ui_page` definition and `/pages` editor. A saved definition, named `/show` link or retained observation never starts a source read or API action. The authenticated live page exposes **Refresh** and explicit API buttons. Its monitoring interval starts paused. Inline `/show` snapshots retain their network-disabled sandbox; their API buttons direct readers to the live page.

## Human-readable links

Create a named definition with `named_view`:

```json
{
  "action": "save",
  "name": "Order service overview",
  "expected_revision": null,
  "target": {"type": "page", "id": "orders", "scope": "shared"}
}
```

This returns `/show/order-service-overview`, an alias revision and a revision-pinned URL. The target pins the exact saved page revision. Definition aliases are shared by default and administrators publish them. Use `scope:"private"` for a principal/chat draft; shared aliases cannot expose private definitions. The Pages editor also offers **Create a named /show link** for a saved definition.

`expected_revision:null` reserves a new slug. To replace it, first call `{"action":"get","slug":"order-service-overview"}` and pass the returned `revision` as `expected_revision`. Concurrent or stale writes return `STATE_CONFLICT`; drafts are not silently overwritten. Old alias revisions, original result IDs and revision URLs keep resolving. Aliases retain their result targets against normal result pruning. Named definitions still require authentication.

A retained result uses `target:{"type":"result","id":"<result-id>"}` and defaults to private. Publishing its data requires all of `scope:"shared"`, administrator access and `share:true`. The resulting URL includes an unpredictable `key` capability; knowing the human name alone grants no data access. Keys authorize only that alias revision's `/show` snapshot, never API calls, private result APIs, other results, or event subscriptions. Updating an alias creates a fresh key. Earlier keys work with their earlier revision-pinned URLs. Capability sharing is rejected on private aliases because their names exist only in the owner's principal/chat directory.

`named_view get/list` exposes capability URLs and original result IDs only to the owner principal/chat. Other viewers receive the name and revision without those credentials. Copy a capability URL only when the retained data is intended for its recipient. Private URLs restore the authenticated viewer's chat without changing their principal or grants; explicit chat headers and tokens bound to one chat continue to apply.

## Explicit API buttons

Add `actions` to the existing version-1 definition. Each action declares `api_request_replay` arguments. The request executes on the backend through the normal registry, URL boundaries, configured authentication profiles, rate limits, telemetry and cancellation; browser cookies are never forwarded. Do not put credentials in definitions. Use a configured `auth_profile` when needed. Parameter references retain their JSON types.

```json
{
  "version": 1,
  "title": "Order checks",
  "inputs": {"order_id": {"type": "number", "label": "Order ID", "default": 42}},
  "sources": [{"id": "orders", "rows": [{"id": 42, "name": "Order 42", "status": "open"}]}],
  "datasets": [],
  "actions": [{
    "id": "check",
    "label": "Check order",
    "description": "Send the selected order ID to the configured order-check endpoint.",
    "arguments": {
      "request": {
        "method": "POST",
        "url": "https://orders.example.test/api/check",
        "headers": {"content-type": "application/json"},
        "body": {"kind": "json", "value": {"id": {"$param": "order_id"}}}
      }
    },
    "emits": ["orders.checked"]
  }],
  "widgets": [{
    "id": "group", "type": "panel", "title": "Current orders", "span": 2, "collapsed": false,
    "children": [{
      "id": "list", "type": "collection", "title": "Orders", "data": "orders", "itemTitle": "name",
      "columns": [{"field": "id", "label": "ID"}, {"field": "status", "label": "Status", "format": "status"}],
      "on": [{"event": "orders.checked", "effect": "notice", "message": "An order was checked. Refresh to collect a new observation."}]
    }, {"id": "check_button", "type": "action", "title": "Check selected order", "action": "check"}]
  }]
}
```

The endpoint above is illustrative; configure a real endpoint in `scripts.http.allow`. `arguments` also accepts existing `prepared` contracts or an `exchange` ID, optional `params`, `auth_profile` and `timeoutMs`, as supported by `api_request_replay`. Captured exchanges remain principal/chat scoped. An optional action `confirm` string adds an explicit confirmation before the button sends.

The equivalent explicit backend call is `ui_page {action:"action",id:"orders",actionId:"check",params:{order_id:42}}`. It returns a job ID. Poll with `ui_page {action:"action",job:"..."}` or use `waitMs` up to 30000. `job_cancel` uses the existing execution cancellation. In-flight identical actions deduplicate within one principal/chat; completed actions never retry automatically. A cancelled or interrupted mutation may already have reached its remote server; inspect its outcome before sending again. HTTP error responses remain inspectable results. Custom `emits` fire only for 2xx responses.

## Collections and panels

`collection` renders bounded, filterable, paginated records, with `itemTitle` selecting each record heading, optional table-style `columns`, and retained record evidence. It uses the same dataset completeness/error states as tables. `panel` groups `children`; `collapsed:true` starts its native accessible disclosure closed. Panels may nest four levels, with at most 60 widgets in total and globally unique widget IDs. Existing text/table/metric/comparison widgets continue to work inside panels.

`on:[{event,effect:"notice",message}]` is supported on every widget. It displays plain text when a matching event arrives and preserves the saved observation. Events cannot execute an action, fetch a source or change inputs. This keeps reconnects and duplicate signals safe to observe.

## Scoped event bus

Backend code publishes in its current authenticated access context:

```js
const events = require('./lib/ui-events');
const channel = require('./lib/ui-pages').eventChannel(pageRecord);
events.publish(channel, 'orders.checked', {orderId: 42});
const replay = events.replay(channel, previousCursor);
const stop = events.subscribe(channel, event => console.error(event.type));
stop();
```

Page channels are `page:<shared|private>:<id>:<revision>`. Subscribing validates access to that definition; a shared definition still has separate event streams for every principal/chat. A caller cannot select another owner. Generic channels are available to backend features and the `ui_event` tool in the same scope. `ui_event {action:"publish",channel,type,data}` publishes a signal; `action:"read"` reads missed signals after `after`. `ui.*` types are reserved for backend lifecycle signals: `ui.page.started/completed/failed/cancelled` and `ui.action.started/completed/failed/cancelled`.

The protected `/api/ui-events?channel=...&after=...` endpoint streams SSE. The browser `DTEvents.connect` uses same-origin fetch so chat and authentication headers stay out of URLs. `DTEvents.create()` also provides local `on`, `emit` and `clear`; the page renderer accepts `{bus,onAction}` and removes its subscriptions on `destroy()`. Notifications are best effort: a full or unavailable bus does not turn an already-completed API request into a failure. The job and retained result remain the authoritative outcome.

Each stream retains at most 100 events or 256 KiB, each payload at most 16 KiB. Cursors are opaque random-epoch sequence values. An expired, foreign or future cursor returns `reset:true` with no invented history; the live page asks for an explicit refresh. Replay starts at the requested cursor and never advances past events that have not been delivered. Buffers and subscribers are bounded, idle channels expire after 15 minutes, heartbeat comments keep streams alive, slow clients disconnect at 256 KiB queued output, and browser reconnects back off to 30 seconds. Events are ephemeral: a server restart produces a reset, while saved definitions and results remain on disk.

Focused verification: `node --test test/named-views-events.test.js test/ui-page-model.test.js test/page-primitives.test.js test/ui-pages.test.js`.
