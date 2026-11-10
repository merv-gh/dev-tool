# Screenshot gallery

Captured from the running demo with `demo/gallery.js`, `demo/screenshots.js` and `demo/chat-screenshots.js`. Synthetic samples demonstrate rendering; real Joern captures use retained end-to-end test results. Open WebUI uses a scripted model with real tool calls. This gallery does not imply every integration was executed. [Capture instructions](../../demo/README.md).

## Shared project knowledge

Captured with `dev/check-project-context-browser.js` against the disposable
`demo/ui-ux.js` environment. The shared project imports actual indexed fixture
paths; infrastructure is synthetic and no fresh Joern parse or database
integration is claimed. Publication, file editing/upload, conflict rejection,
restore and retained graph reopening were exercised through the real app.
[How to use project context](../project-context.md).

| | |
| --- | --- |
| ![Shared service understanding](admin-project-knowledge-desktop.png) **Project knowledge** · pinned entries, exits, flows and evidence | ![Editable flow assumptions](admin-project-knowledge-edit.png) **Publication editor** · explanations, assumptions and retained revisions |
| ![Mobile project understanding](admin-project-knowledge-mobile.png) **Mobile** · bounded selectors and scrollable diagrams | ![Inline project knowledge](project-context-inline.png) **Open WebUI** · read-only project view |
| ![Illustrative project view](sample-project-context.png) **Visual-index example** · explicitly assumed flow | |

## Tracing and test evidence

Captured with `dev/check-observability-browser.js` against `demo/ui-ux.js`.
The trace is from real local nested tool calls. The coverage explorer uses the
full executed repository report, including missing paths and test-file evidence.
Infrastructure remains synthetic; no live-service correctness is implied.
See [setup and interpretation](../observability.md).

| | |
| --- | --- |
| ![Trace waterfall](admin-observability-desktop.png) **Traces** · parentage, outcomes and lifecycle events | ![Lifecycle coverage](admin-test-coverage-desktop.png) **Coverage** · missing edges and test provenance |
| ![Mobile trace explorer](admin-observability-mobile.png) **Mobile traces** | ![Mobile lifecycle coverage](admin-test-coverage-mobile.png) **Mobile coverage** |
| ![Inline trace result](sample-observability.png) **Open WebUI traces** | ![Inline coverage result](sample-test-coverage.png) **Open WebUI coverage** |

## Field guide and self-context

Captured from `demo/ui-ux.js` with `dev/check-handbook-browser.js`. The guide
uses the live enabled registry; infrastructure and retained semantic examples
are synthetic. Local calculations, the amount-conversion assertion exercise,
self-context saving and the scoped Task memory handoff were actually executed.
The twenty native views are labeled presentation samples. These captures do not
claim a fresh Joern parse or an autonomous model evaluation.

| | |
| --- | --- |
| ![Field guide orientation](handbook-start-desktop.png) **Start by task** · searchable chapters, scopes and editable examples | ![Live installation briefing](handbook-self-context-desktop.png) **Self-context** · cache metadata and persistent operator knowledge |
| ![All enabled tool contracts](handbook-tool-reference-desktop.png) **Tool reference** · live schemas and editable forms | ![All native view examples](handbook-visual-index-desktop.png) **Visual index** · question, interaction and sample for every view |
| ![Boundary investigation checkpoint](handbook-boundary-case-desktop.png) **Connected cases** · choose the next discriminating evidence | ![Actual local boundary practice](handbook-boundary-practice-desktop.png) **Local practice** · failing and passing independent assertions |
| ![Pinned source search](handbook-exact-revision-desktop.png) **Exact source** · a returned revisionKey becomes the next repo argument | ![Scoped operator note](handbook-memory-handoff-desktop.png) **Memory handoff** · same story, selected folder and preserved note |
| ![Mobile field guide](handbook-start-390.png) **Mobile reading** | ![Mobile self-context](handbook-self-context-390.png) **Mobile briefing** |

[Portable handbook](../handbook/README.md) ·
[Independent novice review and repairs](../handbook/novice-review.md) ·
[Verification](../benchmarks/handbook-verification.json)

## Current investigation workspace

Captured during the [UI review](../ui-ux-review.md) with `demo/ui-ux.js` and
`dev/check-ux-browser.js`. Source indexing uses the bundled Java service;
environment values and the retained semantic projection are synthetic.
The twenty native sample images below were refreshed in this pass.

| | |
| --- | --- |
| ![Editable service boundary graph](ux-passport-graph.png) **Port graph** · typed corrections, additions, source and history | ![Task memory tool scratchpad](ux-context-scratchpad.png) **Task memory** · structured arguments, explicit execution and native preview |
| ![Joern symbol selectors](ux-joern-symbols.png) **Joern** · exact source scope and selected entry/exit symbols | ![API explorer route inventory](ux-api-explorer.png) **API explorer** · endpoint selection, editable requests and optional bearer references |
| ![Saved investigation evidence](ux-context-results.png) **Saved evidence** · retained runs before opening their preview | ![Dedicated services map](ux-services-map.png) **Services map** · its own investigation workspace |
| ![Mobile editable passport graph](ux-passport-graph-mobile.png) **Mobile port editing** · readable graph with adjacent form below | ![Mobile service architecture](ux-dossier-mobile.png) **Mobile architecture** · readable graph, entity list and evidence |

## Investigations & editing

| | |
| --- | --- |
| ![Context memory, nearby files & scratchpad](admin-context.png) **Context memory, nearby files & scratchpad** | ![Editable tool arguments & saved context results](admin-context-scratchpad.png) **Editable tool arguments & saved context results** |
| ![Owned executions, metadata, jobs & configuration](admin-runtime.png) **Owned executions, metadata, jobs & configuration** | ![Read and annotate persisted operational records](admin-runtime-metadata.png) **Read and annotate persisted operational records** |
| ![Active configuration, storage and scheduler limits](admin-runtime-config.png) **Active configuration, storage and scheduler limits** | ![Retained semantic versions & tool workbench](admin-semantic.png) **Retained semantic versions & tool workbench** |
| ![Passport metadata, port corrections & evidence](admin-ports-editor.png) **Passport metadata, port corrections & evidence** | ![Map inspection with editable arguments and native results](admin-map-inspection.png) **Map inspection with editable arguments and native results** |
| ![Editable API requests, capture & response explorer](api-client.png) **Editable API requests, capture & response explorer** | ![Native inline HTTP response](api-response.png) **Native inline HTTP response** |
| ![One-service investigation, versions, ports & semantic readiness](showcase.png) **One-service investigation, versions, ports & semantic readiness** | ![Real Joern · Java service and two internal libraries](semantic-reachability.png) **Real Joern · Java service and two internal libraries** |
| ![Real Joern · value flow across the saved CPG](semantic-dataflow.png) **Real Joern · value flow across the saved CPG** | ![Real Joern local slices with declared HTTP/DB mappings](semantic-composed.png) **Real Joern local slices with declared HTTP/DB mappings** |
| ![Manual ports, exact source identity and correction history](passport-adjustments.png) **Manual ports, exact source identity and correction history** | ![Service map with explicit static candidates and source evidence](microservices-map.png) **Service map with explicit static candidates and source evidence** |
| ![Actual code impact from the service showcase](code-impact.png) **Actual code impact from the service showcase** | ![Real Maven/JUnit run reproducing the rounding bug](workspace-test-run.png) **Real Maven/JUnit run reproducing the rounding bug** |
| ![Actual workspace patch and recorded test verdicts](workspace-patch.png) **Actual workspace patch and recorded test verdicts** |  |

## All native result views · sample fixtures

| | |
| --- | --- |
| ![api-exchange](sample-api-exchange.png) **api-exchange** | ![code](sample-code.png) **code** |
| ![code-cell](sample-code-cell.png) **code-cell** | ![collection-report](sample-collection-report.png) **collection-report** |
| ![diagram](sample-diagram.png) **diagram** | ![differential](sample-differential.png) **differential** |
| ![impact](sample-impact.png) **impact** | ![json](sample-json.png) **json** |
| ![knowledge-map](sample-knowledge-map.png) **knowledge-map** | ![list-diff](sample-list-diff.png) **list-diff** |
| ![passport-ports](sample-passport-ports.png) **passport-ports** | ![patch](sample-patch.png) **patch** |
| ![reproduction](sample-reproduction.png) **reproduction** | ![scenario-run](sample-scenario-run.png) **scenario-run** |
| ![semantic-analysis](sample-semantic-analysis.png) **semantic-analysis** | ![table](sample-table.png) **table** |
| ![tests](sample-tests.png) **tests** | ![text-diff](sample-text-diff.png) **text-diff** |
| ![xml](sample-xml.png) **xml** |  |

## Mobile

| | |
| --- | --- |
| ![patch](sample-patch-mobile.png) **patch** | ![tests](sample-tests-mobile.png) **tests** |
| ![Context memory, nearby files & scratchpad](admin-context-mobile.png) **Context memory, nearby files & scratchpad** | ![Owned executions, metadata, jobs & configuration](admin-runtime-mobile.png) **Owned executions, metadata, jobs & configuration** |
| ![Passport metadata, port corrections & evidence](admin-ports-editor-mobile.png) **Passport metadata, port corrections & evidence** | ![One-service investigation, versions, ports & semantic readiness](showcase-mobile.png) **One-service investigation, versions, ports & semantic readiness** |
| ![Real Joern · value flow across the saved CPG](semantic-dataflow-mobile.png) **Real Joern · value flow across the saved CPG** | ![Real Joern local slices with declared HTTP/DB mappings](semantic-composed-mobile.png) **Real Joern local slices with declared HTTP/DB mappings** |

## Live tools, admin, Open WebUI & dark mode

| | |
| --- | --- |
| ![admin api](admin-api.png) **admin api** | ![admin config](admin-config.png) **admin config** |
| ![admin explore function](admin-explore-function.png) **admin explore function** | ![admin explore table dark](admin-explore-table-dark.png) **admin explore table dark** |
| ![admin explore table](admin-explore-table.png) **admin explore table** | ![admin history](admin-history.png) **admin history** |
| ![admin index](admin-index.png) **admin index** | ![admin jobs](admin-jobs.png) **admin jobs** |
| ![admin passports](admin-passports.png) **admin passports** | ![admin script files](admin-script-files.png) **admin script files** |
| ![admin script js](admin-script-js.png) **admin script js** | ![admin scripts](admin-scripts.png) **admin scripts** |
| ![admin sites](admin-sites.png) **admin sites** | ![admin views](admin-views.png) **admin views** |
| ![api routes](api-routes.png) **api routes** | ![chat code](chat-code.png) **chat code** |
| ![chat file](chat-file.png) **chat file** | ![chat files](chat-files.png) **chat files** |
| ![chat logs](chat-logs.png) **chat logs** | ![chat overview](chat-overview.png) **chat overview** |
| ![chat ports expanded](chat-ports-expanded.png) **chat ports expanded** | ![chat ports](chat-ports.png) **chat ports** |
| ![chat reconcile](chat-reconcile.png) **chat reconcile** | ![chat refunds](chat-refunds.png) **chat refunds** |
| ![chat semantic](chat-semantic.png) **chat semantic** | ![chat usage](chat-usage.png) **chat usage** |
| ![dashboard dark](dashboard-dark.png) **dashboard dark** | ![dashboard](dashboard.png) **dashboard** |
| ![feature refunds dark](feature-refunds-dark.png) **feature refunds dark** | ![feature refunds](feature-refunds.png) **feature refunds** |
| ![files dark](files-dark.png) **files dark** | ![files xml](files-xml.png) **files xml** |
| ![files](files.png) **files** | ![health](health.png) **health** |
| ![kafka lag](kafka-lag.png) **kafka lag** | ![kafka last](kafka-last.png) **kafka last** |
| ![logs dark](logs-dark.png) **logs dark** | ![logs](logs.png) **logs** |
| ![passport dark](passport-dark.png) **passport dark** | ![passport](passport.png) **passport** |
| ![pg query](pg-query.png) **pg query** | ![pg usage](pg-usage.png) **pg usage** |
| ![pull request](pull-request.png) **pull request** | ![trace](trace.png) **trace** |
| ![view list diff dark](view-list-diff-dark.png) **view list diff dark** | ![view list diff](view-list-diff.png) **view list diff** |
| ![view text diff](view-text-diff.png) **view text diff** | ![view xml](view-xml.png) **view xml** |
| ![who uses](who-uses.png) **who uses** |  |


## Architecture observatory · synthetic 600-service estate

Captured with `dev/check-architecture-browser.js`. Dev/UAT instances and resource values are synthetic. Browser checks include sandboxed inline embeds, all exports, admin publication, reader access and conflict draft retention.

| | |
| --- | --- |
| ![admin architecture](admin-architecture.png) **admin architecture** | ![architecture containers](architecture-containers.png) **architecture containers** |
| ![architecture context](architecture-context.png) **architecture context** | ![architecture dataflow](architecture-dataflow.png) **architecture dataflow** |
| ![architecture deployment](architecture-deployment.png) **architecture deployment** | ![architecture estate](architecture-estate.png) **architecture estate** |
| ![architecture mobile](architecture-mobile.png) **architecture mobile** | ![architecture resources](architecture-resources.png) **architecture resources** |
| ![sample architecture](sample-architecture.png) **sample architecture** | |

## Service architecture dossier

Actual static analysis of the bundled Java fixture; environment and requirement values are synthetic. The separate [Joern validation report](../benchmarks/service-architecture-e2e.json) records real retained-CPG query results.

| | |
| --- | --- |
| ![admin service architecture](admin-service-architecture.png) **admin service architecture** | ![service architecture c4](service-architecture-c4.png) **service architecture c4** |
| ![service architecture flow](service-architecture-flow.png) **service architecture flow** | ![service architecture mobile](service-architecture-mobile.png) **service architecture mobile** |
| ![service architecture requirements](service-architecture-requirements.png) **service architecture requirements** | ![service architecture runtime](service-architecture-runtime.png) **service architecture runtime** |

## Coverage of workspace changes

![Missed changed production path](sample-workspace-coverage.png)

Captured from the real local Lombok/JUnit/JaCoCo regression with
[the retained-result demo](../../demo/change-coverage/README.md). The report
identifies a missed changed line; adding the missing path assertion closes the
gap, and another edit invalidates the old report. Source-read and coverage-run
actions prepare editable Workbench drafts. This is coverage of the selected JVM
change, separate from dev-tool’s own coverage report.
