# Shared project understanding

[Verification record](benchmarks/project-context-verification.json) ·
[Desktop, mobile and inline examples](screenshots/README.md#shared-project-knowledge)

Open **Admin → Context → Project knowledge**, or use `project_context_find`,
`project_context_get` and `project_context_save`. This is a shared, versioned
index of what the project does and where its important evidence lives. Private
task progress stays in the existing `context_*` folders.

Everyone with app access can read publications. Admins publish, including through
the model. A non-admin can prepare a proposed update in task memory for an admin
to review and promote. Publication deliberately makes its contents readable
across users and chats; only promote shareable, redacted evidence.

## Start with the understanding that already exists

```sh
node cli.js tool project_context_find '{"query":"SHOP/orders"}'
node cli.js tool project_context_get '{"id":"orders-platform"}'
node cli.js tool project_context_get '{}'
```

The last call returns the document template, policy and limits. A publication
contains a title, searchable summary, explanation, repositories/tags, optional
exact architecture-document references, and service contracts. A service contract
keeps its source revision, public entry points, exits and flows, with separate
assumptions and gaps. A flow joins explicit boundary ids; the index never invents
connections from names.

Flow `basis` is an author-declared classification: `assumption`, `static`,
`joern` or `observation`. Non-assumed flows require evidence references; `joern`
requires a Joern citation. This validation checks the publication's structure,
not whether the cited claim is true. Review its retained evidence before relying
on it. Static reachability does not prove value flow or runtime execution, and
independent exit arrows do not imply ordering, transaction atomicity or delivery.

Published project knowledge is included in `knowledge_search` and
`knowledge_graph`. The graph preserves its declared status and assumptions;
it does not upgrade model understanding into indexed or runtime proof. Exact
historical quotations remain verifiable with `knowledge_verify`,
`source="project-context"`, `document="project-context:<id>"` and the publication
revision. Search scans publication metadata and artifact summaries; it does not
load screenshot bytes or every saved tool result into the model's prompt.

## Publish findings and files together

For creation, use `expected_revision: null`. For an update, read first and provide
the last publication revision. `document` replaces the complete document; omit it
to preserve current understanding while changing files. A publication reason is
required. Metadata and files become visible through one head update.

```json
{
  "id": "orders-platform",
  "expected_revision": null,
  "reason": "Record the initial source review and remaining transaction questions",
  "document": {
    "title": "Orders platform",
    "summary": "Order creation boundaries and outstanding consistency questions",
    "repositories": ["SHOP/orders"],
    "services": []
  },
  "files": [
    {
      "path": "findings/consistency.md",
      "content": "Transaction and publication ordering still need independent integration evidence.",
      "summary": "Unresolved consistency questions and what to verify next"
    }
  ]
}
```

Save query/script/diagram sources as text. For PNG/JPEG/WebP screenshots and other
binary files use `encoding: "base64"`. Admin previews supported raster images and
escaped text; stored code, SQL, HTML, SVG and scripts are never executed. Running
a query, script or tool still needs its normal explicit tool call and permissions.
The UI accepts uploads up to 2 MiB. Larger retained dossiers are imported directly
from an existing result rather than copied through chat.

To promote reviewed task evidence, supply a file change with
`from_context: {"id":"<context>","path":"findings.md","expected_revision":"<file revision>"}`.
The source must be readable in the current principal/story, and the exact file
revision must still match. This copies evidence; it does not move or publish the
entire private task. Configured secrets and common credential-bearing text are
rejected. Review screenshots and other opaque binary artifacts for sensitive
content before publication.

## Keep a service's full entry-to-exit understanding

Run `architecture_service` and observe its existing job until it finishes. It
collects pinned passport/code paths, bounded Joern findings, documentation claims
and environment observations. Then pass its owned result URL or id as `dossier`
to `project_context_save`, alongside an existing head revision or an initial
project document. Importing reads the retained result; it does not start Joern,
fetch code or contact the environment again.

The publication retains:

- `services/<service>/dossier.json`, including the complete collected paths,
  source identities, requirements, semantic results, observations and gaps;
- up to twenty branch-specific PlantUML flow sources;
- a compact editable service index, with at most 200 entries, 500 exits and 200
  flows per service. Truncation is recorded; the full dossier remains available.

A Joern result stays specific to its reported path. Candidate library revisions
remain assumptions rather than silently becoming exact static proof. The import
does not declare full coverage of every execution or a runtime trace.

Select **Prepare retained service graph** in Admin to reopen the full graph from
that publication, or call `project_context_get` with its exact revision,
`path="services/<service>/dossier.json"` and `diagram=true`. Optional `flow` selects
a retained flow. This uses the existing interactive service architecture viewer
and exports; no live analysis runs. `project_context_get` also returns the compact
project map as an Open WebUI inline view.

## Work outside-in when testing

Model guidance now starts with the expected business behavior and the public
HTTP request, message listener or scheduled entry. It consults project knowledge,
compares source SHAs and keeps the service and internal-library chain real.

`test_context` defaults to public callers of a requested class or method. When
several entries can reach it, the response offers candidates so the model chooses
the behavior being investigated. A single known caller yields a flow context.
Explicit `flow=false` or `strategy="unit"` retains isolated class testing. When no
public caller is established, the tool reports the class scope and does not
invent an integration entry.

Every generated flow context includes `integrationPlan`: expected observations,
entry/exit boundaries, fixture/cleanup guidance, related project publications and
whether their service SHA matches the workspace base. A bounded local Git check
keeps dirty or unverified worktrees from being labeled as a source match. The existing flow skeleton keeps
real beans on the chain and doubles external boundaries. Its scope is explicit:
mocked repository/client/producer calls establish no SQL, HTTP serialization or
broker delivery proof.

For those claims, use owned scratch PostgreSQL (`test_run` with the reviewed
`env`/`db` or fixture runtime), local wire stubs or isolated broker fixtures as
appropriate. Assert independently expected responses, table changes and emitted
payloads. Include duplicate, invalid-input and downstream-failure behavior; check
rollback/absence of unintended effects. Release owned resources and report
cleanup failures. A saved plan or static path is not an executed passing test.

## History, conflicts and durability

Data lives under `DT_HOME/project-contexts/<id>/`, outside disposable caches and
Git. The directory is ignored by the repository. The existing Compose config-home
mount retains it across `git pull` and `run.sh up -d`; back it up with other durable
operator data.

Each immutable manifest pins content-addressed files. Unchanged file bytes are
stored once, and head-only discovery avoids rereading large artifacts. A
cross-process publication lock plus expected-head comparison rejects competing
writers. A failed write leaves the previous head intact. Old revisions remain
readable after newer publications and cache refreshes.

`files: [{"path":"old/query.sql","archive":true}]` moves a current file under
`archived/`; historical inventories still refer to its original path and bytes.
`restore_revision` copies an earlier document and inventory into a new publication;
`expected_revision` must still identify the current head. Restore never rewrites
history. Admin retains a draft when publication conflicts.

Budgets are explicit: 200 project contexts, 500 files and 64 MiB per inventory,
16 MiB per file, 256 MiB of retained blobs, 10,000 blobs and 1,000 publication
manifests per project. Manifest JSON is capped at 2 MiB. Reaching a limit rejects
new publication and preserves existing history; there is no automatic destructive
rotation. These are local installation limits, not a claim of unlimited storage.
