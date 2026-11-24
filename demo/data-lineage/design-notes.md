# Data lineage design handoff

## Intent and preservation

This is an ordinary **Operate-mode extension** of dev-tool's retained tool results. A conversation should answer who reads or writes an exact data object, or show a bounded path through services and libraries, while keeping the evidence and its limits visible. The user direction is a minimal production-scale conversation UI: compact lists, flat vertical paths, explicit continuation, and no deep indentation or decorative graph.

The incumbent authority is [impact](../../web/views/impact.html), [shared view styling](../../web/views/_views.css), and [shared page styling](../../web/ui.css). The implementation preserves their system fonts, neutral surfaces, blue links and focus, thin separators, native controls, disclosure behavior, and monospaced source identities. It extends the existing evidence vocabulary rather than introducing a new visual identity. The root `PRODUCT.md` and `DESIGN.md` were already absent; this scoped handoff does not create or repair global design context.

The retained surface is [data-lineage.html](../../web/views/data-lineage.html), with [inline summaries](../../web/inline.js#L97), [native result-frame policy](../../web/tool-client.js#L3), and [built-in response CSP](../../lib/views.js#L16). [Usage and limits](../../docs/data-lineage.md) are the functional reference; [the demo guide](README.md) explains reproduction.

## Composition and interaction

The reading order is title and focused-link action, environment/state/freshness, static-evidence qualification, prepared actions, then evidence or a path. This puts the answer and its status ahead of implementation detail. Coverage, index timings, source revisions, and path assumptions use native disclosures.

| Surface | Composition and behavior |
| --- | --- |
| Conversation summary | Successful results begin collapsed. The summary names state and count: access records, **name candidates** in mentions mode, or static access paths. Failed, interrupted, cancelled, ambiguous, and failed-refresh results open for attention. The shared disclosure preserves the user's open/closed choice on subsequent summary updates. |
| Readers/writers | Search and evidence selection precede direct records. Each record shows method/routine, access and proof labels, source identity, target, evidence location, service attribution, explanation, and prepared actions. Thin rules separate rows. |
| Object accessors | Getter/setter/row-mapping records have a separate, initially collapsed disclosure. A matching search opens it. Its copy explicitly separates object mutation/observation from persistence. |
| Name discovery | A small substring preview is initially collapsed. Full mentions mode has its own candidate count and continuation; it does not claim reader/writer facts. |
| Paths | A path selector and proof label precede numbered vertical steps. Selecting a step reveals its exact identity, source action, and copy action in place. The next-edge relation/proof remains readable between steps. Depth consumes height. |
| Ambiguity or absence | Exact-object choices expose canonical identities and prepared selection actions. Missing evidence retains coverage and discovery actions; the page does not substitute a guessed database, overload, repository revision, or broker. |

Sources: [structure](../../web/views/data-lineage.html#L6), [record rendering](../../web/views/data-lineage.html#L44), [path rendering](../../web/views/data-lineage.html#L51), and [inline disclosure](../../web/inline.js#L143).

## Bounds, collapse, and responsive rules

- Render at most **25 direct records, 25 object records, or 25 path steps** per local page. Direct and object lists have separate previous/next controls. The selected path has its own step paging; changing paths resets its selection and step offset.
- Local search and evidence filters operate on the retained server page. Counts say “on this page” and show the server total. A server `nextCursor` prepares “Load next evidence page” with the original request and generation. Local paging must not imply the entire source inventory has been searched in the browser.
- The substring preview renders at most **20 retained matches**; the separate full-name query is the continuation route. Object accessors, substring candidates, path assumptions, and coverage remain disclosed rather than expanding every finding into the conversation.
- “Copy focused link” retains search, evidence filter, direct-page offset, selected path, and selected node. A linked selected node restores its path-step page. It does not promise to retain every disclosure state or object-page offset.
- At widths below **600px**, filters stack and fill the available width. Long headings, row titles, identifiers, locations, and step buttons wrap. The phone layout stays a single vertical sequence without horizontal path nesting.

Sources: [25-item page size](../../web/views/data-lineage.html#L24), [focused-link state](../../web/views/data-lineage.html#L31), [paging and filtering](../../web/views/data-lineage.html#L46), [substring bound](../../web/views/data-lineage.html#L54), and [responsive/wrapping rules](../../web/views/data-lineage.html#L3). Server bounds, output limits, and single-host scope are documented in [performance and bounds](../../docs/data-lineage.md#performance-and-bounds).

## Evidence vocabulary

Keep provenance and certainty in the rows and path edges, not only in a footer.

| Evidence class | Required distinction |
| --- | --- |
| SQL | Recognized SQL read, predicate, or write evidence retains its statement/routine and source location. A routine invocation remains separate from its body effects. |
| ORM and derived properties | Label inference as a candidate. Entity/repository/property associations do not establish runtime persistence, custom-provider behavior, or query execution. |
| Object access | Keep getters, setters, fields, and row mappings separate from persisted database access. A setter is not a database write. |
| Reviewed links | Retain their declared explanation and proof label; do not promote them into observed source evidence. |
| Substring candidates | Discovery with unknown access. Name similarity never becomes a reader/writer fact or an access-record count. |
| Static paths | Show call/access topology, proof, assumptions, and budget cuts. Runtime execution, feasible control flow, payload equivalence, delivery, and field-value survival across mapping/message boundaries remain unproven. |

Repository revision and file/line remain visible separately from application service attribution and call-site evidence. Database identity, environment, and broker/ES cluster identity must survive path presentation. The same topic name on another broker is a different boundary. Source/catalog coverage is explicit; empty results mean no detected access in this projection. See [evidence and column mapping](../../docs/data-lineage.md#evidence-and-column-mapping) and [cross-service trace rules](../../docs/data-lineage.md#api-to-column-kafka-and-es).

## Background work, errors, and freshness

The result is a retained snapshot, not an auto-polling live graph. State, environment, generation, indexed time, and snapshot time remain near the title. A running job offers **Observe index job** and a prepared cancellation action; observation and refresh occur through Workbench. Job logs/timings are available under index details.

Stale results keep the last complete evidence while a background refresh runs. A failed refresh exposes its error and retained stale status; it does not discard prior rows or repeatedly retry itself. Recovery requires an explicit refresh/retry. Failure, interruption, cancellation, ambiguity, or a result error opens coverage details. Bounded traversal exposes its cut reasons. Freshness refers to upstream cache/index fingerprints, not deployment state.

Sources: [status/actions/errors](../../web/views/data-lineage.html#L34), [coverage and job detail](../../web/views/data-lineage.html#L55), [inline attention states](../../web/inline.js#L97), and [freshness/reproducibility](../../docs/data-lineage.md#freshness-scope-and-reproducibility).

## Source and action handoff

Result links prepare editable Workbench arguments in a new tab; they do not run tools on click. Retained-source reads carry revision key, file range, and `expected_source_digest` to `code_read`. Changed source is rejected rather than silently substituted. Database links explicitly inspect the **current cached definition** rather than claiming a historical routine body. Missing digests are stated as unavailable.

Native result hosts allow popup escape only for credential-free, same-origin retained `/show/<id>` URLs. [The shared frame helper](../../web/tool-client.js#L3) resets the policy for other content and never adds `allow-same-origin`. The snapshot remains unable to fetch or access the parent origin. [Response CSP](../../lib/views.js#L16) permits the built-in lineage handoff while custom views/overrides retain their restrictive sandbox. Srcdoc/admin previews remain restricted. Workbench initializes its explorer before preparing linked arguments ([initialization order](../../web/admin-workbench.js#L348)); its result frame uses the [shared helper](../../web/admin-workbench.js#L1026).

External hosts such as Open WebUI may impose stricter outer sandbox rules. If popup escape is unavailable there, open the retained result URL in a normal browser tab. This limitation is part of the [functional handoff documentation](../../docs/data-lineage.md#freshness-scope-and-reproducibility).

## Incumbent source and token anchors

These are existing authorities, not a new token system.

| Anchor | Preserved role |
| --- | --- |
| [Shared page tokens](../../web/ui.css#L2) | `--bg`, `--fg`, `--muted`, `--line`, `--panel`, `--soft`, `--accent`, and semantic status colors; existing OS dark-theme values remain inherited. |
| [Base typography and framing](../../web/ui.css#L17) | System sans body, monospace code/source identity, existing page and embedded padding. |
| [Shared controls/focus](../../web/ui.css#L53) | Native controls, accent focus outline, hover/disabled states, mobile control sizing, and reduced-motion handling. |
| [Shared view details](../../web/views/_views.css#L30) | Compact headings and native disclosure targets. |
| [Incumbent impact rows](../../web/views/impact.html#L3) | Compact operational density, thin dividers, muted evidence metadata, and source identities. |
| [Lineage local composition](../../web/views/data-lineage.html#L3) | 16px section gap, 12px row padding, 6px row gap, 18px title/16px phone title, and 12px source metadata. No decorative elevation or graph canvas is added. |

## Evidence and review limits

[The final finish review](review.md) says **ship within the reviewed scope**. Its initial review covered the lineage renderer, inline integration, response policy, and functional documentation against the incumbent sources above. The confirmation pass covered only three reported defects and necessary host integration: native prepared-action sandbox inheritance, long-identifier overflow, and candidate-summary terminology. All three are resolved; the review requests no further fixes, captures, redesign, or rebuild.

[Verification](evidence/verification.json) is dated **2026-11-24T01:11:49.238Z** and records **13 passing checks, 17 captures, and `errors: []`**. It exercises real HTTP tools, source indexing, SQLite, background workers, and the production renderer on disposable synthetic multi-repository source/catalog fixtures. The retained evidence covers readers/writers, inherited library paths, Kafka/ES identity, candidates, ambiguity, absence, pending builds, failed stale refresh and explicit recovery, mobile layout, long labels, collapsed summary wording, and native Workbench handoff. All recorded document widths match their 1440px or 390px viewport widths.

The reviewer inspected the original 11 captures and all six added confirmation captures. The integration pass opened all 17 valid captures. This documentation handoff additionally inspected [desktop readers](evidence/readers-desktop.png) and [phone cross-service path](evidence/kafka-es-mobile.png), with source inspection of the final implementation. Long-label captures are explicitly synthetic renderer stress examples, not indexed findings.

The Workbench verifier opens a real native result, follows retained source, verifies normal-origin storage and editable digest arguments, clicks Run, and receives a successful guarded `code_read` result. Its custom-override check verifies an opaque popup and storage `SecurityError`, then removes the override. The [verifier](verify.cjs#L38) assertions establish execution and isolation; [the handoff capture](evidence/workbench-inline-handoff.png) shows the native host.

No live Java service, Joern, production database, or Kafka runtime was executed by this demonstration. Dark-theme rendering, assistive-technology output, and zoom were not established by this evidence. Production-scale usability is supported by bounded rendering and separate documented scale tests, not a claim of exhaustive live deployment validation. The Impeccable context launcher had already failed verification and was not retried; no automated detector result is claimed. This handoff changes this document only and preserves the incumbent identity and completed implementation.
