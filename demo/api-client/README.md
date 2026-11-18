# API client showcase

Run from the repository root:

```sh
node demo/api-client.js
```

Open the printed client URL. The fixture creates a disposable configuration,
three synthetic services, two environments, nested request collections and two
real local HTTP replicas. No production services or model are called. Stop with
Ctrl-C to remove the disposable data.

1. In **Services**, expand **shop-orders** and select `GET /orders/{orderId}`.
   Fill `orderId`, add a query parameter or header and press **Send GET**.
2. Inspect pretty JSON, raw text, response headers and the sanitized sent request
   in the right panel. Expand JSON objects; copy or download the retained result.
3. Change **Service target** to the other replica, or override **Base URL**.
   Switch to `uat` to see that environment's cached Consul address.
4. Expand **Save to collection**, enter `demo/order-lookup`, and save. Switch the
   left panel to **Collections** and reopen it without sending.
5. Open **History** to revisit prior results. Try `/missing` for an inspectable
   HTTP 404, `/slow` for cancellation, and `/html` for safe text rendering.
6. Expand **shop-inventory** and use **Load more** to reach all 105 routes.
7. Open Admin's **API explorer** to use the same client with Admin's task and
   environment scope. The route evidence table remains in a disclosure below it.

The layout replaces the previous flat endpoint list and response below the form:
services now fold into groups, infrequent import/binding/save controls collapse,
and the response stays beside the request on desktop. Mobile stacks the panels.
The shared dt typography, controls and light/dark tokens remain in use.

Automated browser verification:

```sh
node dev/check-api-client-browser.js
node --test test/api-catalog.test.js test/api-client.test.js test/api-auth.test.js
```

The Chromium check exercises actual local HTTP sends, authentication profiles,
replica/base URL overrides, JSON bodies, collections, history, cancellation,
route pagination, keyboard tabs and the Admin embed. It writes these screenshots:

- [Desktop](../../docs/screenshots/api-client-desktop.png)
- [Mobile](../../docs/screenshots/api-client-mobile.png)
- [Dark theme](../../docs/screenshots/api-client-dark.png)

Collection hooks and multi-step workflows remain in Scripts & collections.
The client's **Send** runs only the reviewed HTTP request, once.
