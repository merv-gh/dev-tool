# Vendored semantic scripts

Origin: [merv-gh/file-projections](https://github.com/merv-gh/file-projections), inspected at `fbce4a5da60a0431c233d18b524bdbd99246574c` (`v0.18.0`). Its MIT license is preserved in `LICENSE`.

The semantic adapters were contributed back in [`4e448e6`](https://github.com/merv-gh/file-projections/commit/4e448e6), following the farm runtime guards in `3df7196`, on `codex/joern-farm-runtime-guards`. They are vendored here so that branch is not a deployment dependency.

`joern/enrich-project.sc` and `joern/query.sc` extend the project's standalone CPG traversal/script approach with streamed semantic records and bounded named queries. They are shipped with dt and do not require file-projections, Go, a remote farm, or any package download at runtime. Joern itself remains a separately licensed analysis dependency in the optional worker image.

Tested engine: Joern `4.0.564`, image `ghcr.io/joernio/joern@sha256:54c7f728f813c1cefd4303e7c69c5d35003f0fc9fde1459872230e5bc4e4b7b4`. Engine/image/script fingerprints belong to each retained analysis. Upgrade by testing both Java and JS/TS and building a new generation; never overwrite older CPGs.

The projection protocol is `dt.semantic.projection/v1`: metadata, symbols, calls, guards, boundary candidates and a mandatory final coverage summary. Numeric CPG IDs are local to an analysis generation. The deep-query protocol accepts JSON arguments for named operations, not arbitrary Scala.
