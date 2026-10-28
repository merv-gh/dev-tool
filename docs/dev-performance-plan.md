# Development performance plan

The baseline on this worktree (Node 24.22.0) is 158 tests, 146 passing and 12 explicitly gated live checks, in 18.77 seconds. Keep `npm test` as the complete regression check. The loop should become cheaper by doing less repeated work, with observable cache invalidation and selection decisions.

| Observed cost or gap | Plan | Validation |
| --- | --- | --- |
| Every `codeindex.load` parses the full manifest before checking the memo; selecting indexes parses every manifest again | Cache parsed manifests using file identity, size, mtime and ctime; reuse them when listing and searching | Replacement, same-size edits, removal, and warm-load benchmark |
| An unchanged code tree rebuilds every trigram and parses the complete symbol graph | Store a source-stat manifest and an input fingerprint; reuse only when the whole tree, metadata and extraction input match; retain a forced rebuild | Creation, deletion, metadata, extraction, and timestamp-preserving edit cases; cold/warm benchmark |
| `catalog.find` rereads, splits, and lowercases the full catalog on every call | Cache prepared lines with the same stat-based invalidation, preserving direct-before-related ranking | Ranking and replacement regression checks; repeated-find benchmark |
| Postgres usage lookups parse the complete usage graph before consulting their memo | Reuse the parsed graph while its file identity is unchanged | External replacement and removal checks |
| Fast Maven setup discovers POMs by traversing target, dependencies and Git internals | Prune generated/dependency folders before traversal and only visit real files | A generated tree containing misleading POMs and symlinks |
| Changing build/JDK configuration can silently reuse incompatible fast-run state | Include build inputs in the prepared-state fingerprint and require cached classpath/launcher files | Config and missing-file cache invalidation cases |
| There is no explicit local/affected test loop | Add local/live/changed/file-targeted commands, emit selection reasons, keep process isolation; conservatively select all tests for unrecognized runtime assets/config changes | Transitive dependencies, deleted paths, shell child entrypoints, unknown assets, and invalid CLI input |
| Related multi-database/Kafka fixtures and investigation experiments are missing | Reproduction and experiments work proceeds in the same branch under the coordinating agent; fixtures should be bounded, reusable, and carry provenance | Integration tests and reproducible resource outputs |

Do not speed up live indexing by removing per-system rate limits or read-only query guards. Parallel database/system sync should be bounded by the existing policy, and needs separate live evidence before changing defaults. Do not treat affected/local tests as full verification: the final full suite and bundled-output freshness check remain required.

## Implemented workflows

```sh
npm run test:files -- test/performance.test.js,test/dev-workflow.test.js
npm run test:files -- lib/fastrun.js --list
npm run test:changed -- --list
npm run test:changed -- --base origin/main
npm run test:local -- --name 'catalog' --concurrency 4
npm run test:live
npm run bench:dev
npm run build
npm test
```

`test:local` omits the explicitly gated `*.live.test.js` suites and the bundle freshness check; it still runs isolated test processes. `test:files` accepts test paths or source paths and expands source paths through their static CommonJS dependencies, including literal child-process helper paths. `test:changed` includes staged, unstaged, deleted and untracked paths relative to HEAD (or `--base`). `--list` prints JSON with the selected tests and reasons. Build/configuration changes, runtime assets, fixtures and uncovered source paths conservatively select the entire requested group. Documentation-only changes select no tests. These commands support the development loop; static dependency selection is not proof of full integration coverage, so final verification remains `npm run build && npm test`.

Index builds record source identity, size, mtime and ctime and fingerprint metadata/extraction inputs. Unchanged trees reuse outputs without rewriting them; additions, deletions, timestamp-preserving replacements and metadata changes rebuild. Trees with symlinks rebuild because the manifest cannot validate external inputs. `{ force: true }` bypasses reuse. Existing indexes upgrade on the next build. Parsed code manifests, prepared catalog lines and PG usage graphs are cached only while the underlying file identity remains unchanged. Cached Maven state now depends on POM paths and contents, Maven/JDK options, settings, wrapper descriptors and launcher version, and requires classpath and launcher outputs to remain present. It retains an inventory of source/resource inputs, including new attempted inputs from failed compilations. Deleting an input runs a clean Maven preparation to remove orphaned classes, generated/inner classes and copied resources; ordinary edits retain the incremental javac path. Build-input changes also require clean preparation so Maven cannot silently skip recompilation. POM discovery prunes generated and dependency trees. Changed-source graph lookup uses sets/maps rather than repeated linear class searches.

## Measurements

`npm run bench:dev` creates a deterministic local tree with 1,200 source/config files, 10,000 catalog lines and 10,000 usage edges, then removes its temporary environment. The original HEAD and this implementation ran the identical benchmark under Node 24.22.0. Timings are observations from this machine, not fixed pass/fail thresholds.

| Operation | Original HEAD | Implemented | Approximate improvement |
| --- | ---: | ---: | ---: |
| Cold index build | 357.71 ms | 319.04 ms | 1.1× |
| Five unchanged rebuilds | 1541.32 ms | 117.67 ms | 13× |
| 1,000 manifest loads | 766.46 ms | 13.52 ms | 57× |
| 100 indexed grep calls | 150.71 ms | 40.33 ms | 3.7× |
| 100 full-catalog searches | 773.78 ms | 180.23 ms | 4.3× |
| 1,000 PG usage-index loads | 7862.98 ms | 8.56 ms | 919× |

The initial targeted regression check passed 27 tests in 1.61 seconds. Selection/invalidation regressions also passed. The local suite passed 153 tests in 13.53 seconds; the later deletion-lifecycle check and nine targeted fast-run/cache tests passed in 2.94 seconds. The two explicit workflow/cache test files run in about 1.6 seconds versus the original complete suite's 18.77 seconds; these cover different scopes, so this is workflow feedback time rather than a whole-suite speedup claim.

## Final verification (2026-10-28)

- Rebuilt bundle and full default suite: **251 tests, 236 passed, 15 opt-in live checks skipped, zero failures**, 14.27 seconds. `npm run build:check` confirms the bundle is current.
- Real PostgreSQL 16 plus the new fixture/JVM pipeline: **43/43 Node integration checks passed, zero skipped**, 11.40 seconds. This combines `reproduction.test.js`, `scenario-complex.test.js`, `pg.live.test.js` and `reproduction.live.test.js`. The last test executes **4/4 real JUnit business cases** against two replay databases and saved event envelopes; source state, resource hashes and database cleanup are checked.
- Existing JVM integrations (`fastrun.live`, `flows.live`, `testdata.live`, `workspace.live`) passed **4/4 suites, zero skipped**, 196.90 seconds with Maven 3.9.11 and Temurin 21.0.11. The preserved per-run records contain 84 JUnit executions across these workflows, including a bounded repeat of the fast loop: 81 passed and three intentional red-before-fix assertions. All final green stages pass; there are no JUnit errors or skips. The compile-error stage intentionally verifies a compiler failure and is not counted as a JUnit execution.
- The traced fast-loop repeat measured initial prepare/red **9.533 s**, unchanged rerun **0.919 s**, fix/run **3.828 s**, Spring MVC slice **6.785 s**, and final full Maven build **12.322 s** (four cases). These are measurements of a small fixture service on this machine, not service-independent guarantees.
- Live tests exposed a catalog refresh failure for Kafka caches that have samples/schema but no flattened `fields`. Catalog construction now derives those paths, with a regression test. Independent review also caught self-referencing reverse-FK traversal and resolved schema binding errors; both have passing regression tests.

To repeat the resource-to-application checks, use a scratch PostgreSQL account with create/drop privileges and installed Maven/JDK, then run:

```sh
DT_TEST_PG_URL='<scratch postgres URL>' DT_TEST_MAVEN='<mvn path>' \
  DT_JAVA_HOME='<JDK 21 home>' node --test \
  test/reproduction.live.test.js test/reproduction.test.js \
  test/scenario-complex.test.js test/pg.live.test.js
```

Default suite skips remain explicit: live prerequisites are opt-in. The tests above do not establish real broker replay, a distributed snapshot, Gradle/remote-runner behavior for the new fixture path, or exhaustive runtime dependency discovery. Those are separate acceptance items in [the completeness review](developer-tool-completeness-review.md).

## Remaining measured-work candidates

- Fast Maven runs still start one test JVM per call. A persistent JVM would need isolated classloaders and teardown of Spring contexts, threads and Testcontainers; benchmark real services before attempting this.
- A changed file still rebuilds the complete code graph and postings. Persisting per-file parser output and trigram sets can help large mutable workspaces, but class/member linking must be recomputed when public types or extraction evidence change. The implemented unchanged-tree reuse is safe and useful before introducing that more complex cache.
- Postgres catalog sync already batches each database's metadata and limits live concurrency. Measure per-query timings on representative environments before adding more parallel connections. Reproduction should reuse schemas and issue bounded indexed-key queries instead of repeated catalog syncs or unbounded table scans.
