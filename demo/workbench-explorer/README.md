# Interactive object workbench demo

Run from the repository root:

```sh
node demo/workbench-explorer/run.js
```

The command prints the standalone Workbench URL (default port 44430) and a
390px document-frame preview (44431). Pass a port as the first argument to use another pair of ports.
The second port also serves `/inline` (the actual OpenAPI result in a chat-style
sandbox) and `/inline-mobile` (390px native full-view preview). Both servers bind loopback. Fixture information is written to ignored
`work/workbench-explorer/demo.json`. Ctrl-C removes the temporary home.

This is a disposable environment with:

- Two tickets, nested notes/queries, saved actions and linked workspaces.
- Three service passports, with a shared `orders` name-prefix group.
- A real local Git repository: `main` returns 25, `feature/fee` returns 30,
  while the unchanged Node regression expects 25.
- In-process HTTP and Consul fixture responses, a saved script and an
  attributed API exchange. The demo bearer value is fixture-only.

Try Services → orders-api, select ORDERS-142 as the evidence context, then
Run tests → Add tests item → Browse → test/refund.test.js → Run. Choose another
branch → Refresh remote branches → feature/fee → Prepare branch workspace →
Run. Attach the new workspace to the evidence context. Run the same regression
to see the actual failing assertion. Tasks → ORDERS-142 rediscover both contexts
and explicitly linked workspaces. Browse source/notes, edit, and Save file.
Prepare Consul status or the saved script/API exchange, review arguments and Run.
Save an action and reopen it under Scripts & saved actions.

The handbook screenshots come from this running fixture through browser UI
controls. The mobile capture is a 390px iframe document preview, not a physical
mobile browser. Neither Consul nor HTTP screenshots describe real deployment
health. See [the walkthrough](../../docs/workbench-explorer.md) and automated
regressions in `test/workbench-explorer*.test.js`.
