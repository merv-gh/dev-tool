# PostgreSQL snapshot → baked image → image tar

This Node utility is ready to run when you choose. It has **not** dumped a database, built a Docker image, or published an image during development. Tests use a fake command runner. There is no push command in the utility.

Preview without credentials, Docker, filesystem changes or network access:

```sh
node recipes/postgres-snapshot/snapshot.js \
  --image local/orders-snapshot:trial --out work/snapshots/orders-trial --plan
```

Run later using a connection URL already in your environment (avoid placing credentials in command arguments):

```sh
# DATABASE_URL is supplied by your environment/secret manager.
node recipes/postgres-snapshot/snapshot.js \
  --url-env DATABASE_URL --base-image postgres:16-bookworm \
  --image local/orders-snapshot:trial --out work/snapshots/orders-trial
```

Inside this repository, configured databases are also supported:

```sh
DT_HOME=/path/to/dt-config node recipes/postgres-snapshot/snapshot.js \
  --env dev --db orders --base-image postgres:16-bookworm \
  --image local/orders-snapshot:trial --out work/snapshots/orders-trial
```

Use the appropriate PostgreSQL base version for the source; `pg_dump` rejects newer source servers than its supported version. Pin an image digest for reproducible builds. `--network host` can reach a localhost database on a Linux Docker host; otherwise use a database address reachable from the selected Docker network. Custom host certificate paths are not automatically mounted.

The output directory must be new. It contains:

- `database.dump`: consistent custom-format dump, without ownership/ACL restoration.
- `Dockerfile`, `snapshot-entrypoint.sh`, `.dockerignore`: build files, with no source connection credentials.
- `image.tar`: the built image, exported using `docker image save`.
- `manifest.json`: stages, dump/archive sizes and SHA-256 hashes; a failed stage stops the pipeline and is recorded.

`--prepare-only` stops after dumping and writing build files; it does not build/export. `--schema-only` excludes table data. The normal path restores into a seed cluster **during the image build**, then copies only that seed into the final image. On a fresh container volume the entrypoint copies the seed, sets `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, and starts PostgreSQL. It preserves populated volumes and refuses an interrupted snapshot initialization. Initialization scripts from a project are not replayed automatically on the baked cluster.

The dump/image contains the selected database's contents. Use an appropriate test dataset; removing owner/ACL commands does not anonymize application data. Output directories are private and contain a `.gitignore` that excludes their artifacts from Git. Source passwords are supplied only to the transient dump container, not Docker build arguments or image layers.

Load the resulting tar on another host with `docker image load --input image.tar`. A Testcontainers Java setup can select its tag with `DockerImageName.parse(tag).asCompatibleSubstituteFor("postgres")`, and use the usual database/user/password settings. Keep the image and runtime PostgreSQL major/architecture compatible.

Baking a database does not guarantee faster tests: copying a large seed can cost more than migrations. Benchmark stock versus snapshot using identical test classes, assertions, JVM settings and datasets; force fresh test execution; record both correctness and warm/cold startup timings. No performance improvement or Nexus publication is claimed here.

The three utility files can be copied into a repository created with `workspace_create` and invoked using `workspace_program`, or run directly with Node. Save the invocation as a script inside `code(global_context=...)` to reuse it without resending source. Runner configuration must explicitly pass the URL variable; it does not inherit dt secrets automatically.

Sources: [PostgreSQL pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html), [official PostgreSQL image initialization](https://hub.docker.com/_/postgres), [official entrypoint source](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh), [Testcontainers PostgreSQL module](https://java.testcontainers.org/modules/databases/postgres/).
