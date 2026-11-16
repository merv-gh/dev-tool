# Declarative page examples

These definitions are available in **Admin → Pages → Start from an example** and
through `ui_page` with `action=templates`. Copy/edit the JSON or ask a model to
read a template and save it under a new ID.

- [Service versions](service-versions.json): two environments, selected services,
  replica counts, reported versions and retained differences. One wide table
  keeps the environment beside each service/version.
- [Routine parity](procedure-parity.json): exact database choices per environment,
  schema filters, overload identities, missing procedures and definition hashes.
- [Environment watch](environment-monitor.json): service health, Elasticsearch
  status and Kafka lag; optional monitoring is paused by default.

The [operator guide](../../docs/ui-pages.md) describes every primitive, source,
data operation, sharing rule and scan limit.

```sh
node dev/check-ui-pages-browser.js work/pages/screenshots
node --test test/ui-pages.test.js test/ui-page-model.test.js test/page-primitives.test.js
```

The browser check starts and closes its own fixture app. It exercises sign-in,
example creation/save, dependent target choices, explicit refresh, procedure
comparison, JSON export, retained links, inline interaction, monitoring and the
Admin entry. Local HTTP/Consul-compatible endpoints execute; database, ES and
Kafka responses are synthetic scoped read adapters. No model or production
infrastructure is contacted.

The before/after review lives in development evidence: the initial version kept
all target inputs, repeated JSON and instructions above results; the finished
version pairs mobile targets, collapses reference notes and uses a single wide
version table. This brings observed differences closer to the user's intent.

Retained examples: [versions](../../docs/screenshots/pages-versions.png),
[procedures](../../docs/screenshots/pages-procedures.png),
[mobile dark](../../docs/screenshots/pages-mobile-dark.png),
[monitoring](../../docs/screenshots/pages-monitor.png) and
[inline snapshot](../../docs/screenshots/sample-ui-page.png).
