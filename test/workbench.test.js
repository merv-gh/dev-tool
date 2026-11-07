const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "dt-workbench-"));
for (const key of [
  "DT_CONFIG_DIR",
  "DT_CACHE_DIR",
  "DT_SECURITY_PROFILE",
  "DT_TOOL_PROFILE",
  "DT_TOOLS",
  "LLM_BASE_URL",
  "LLM_MODEL",
])
  delete process.env[key];
Object.assign(process.env, {
  DT_HOME: home,
  DT_NO_DOCTOR: "1",
  DT_RATE_PER_SEC: "0",
  DT_LOG: "quiet",
  DT_STATE_BACKEND: "legacy",
});
const tokens = {
  alice: "alice-workbench-token-0123",
  bob: "bob-workbench-token-01234",
  limited: "limited-workbench-token-01",
  admin: "admin-workbench-token-012",
};
const config = {
  envs: {
    dev: { postgres: { orders: "postgres://unused.invalid/orders" } },
    uat: {},
  },
  scripts: { starters: false },
  files: { notes: { type: "local", path: "notes", write: true } },
  tools: { plugins: ["workbench-fixture.js"] },
  server: {
    accessTokens: Object.entries(tokens).map(([id, token]) => ({
      id,
      token,
      role: id === "admin" ? "admin" : "user",
      ...(id === "limited"
        ? { tools: ["pg_query", "context_find"], envs: ["dev"] }
        : {}),
    })),
  },
};
const saveConfig = () => {
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(config));
  require("../lib/config").reload();
};
fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(config));
fs.writeFileSync(
  path.join(home, "workbench-fixture.js"),
  `let calls=0; module.exports=[
 {name:'fixture_wb',description:'Workbench structured fixture',strictInput:true,input:{service:{type:'string'},env:{type:'string'},token:{type:'string'},fail:{type:'boolean'},large:{type:'boolean'},rows:{type:'array',items:{type:'object',properties:{name:{type:'string'}},additionalProperties:false}},map:{type:'object',additionalProperties:{type:'string'}}},required:['service'],run:a=>{calls++;if(a.fail)throw Error('fixture rejected');return {calls,service:a.service,received:a,payload:a.large?'x'.repeat(120000):'bounded'};}},
 {name:'fixture_wb_calls',description:'Count invocations',input:{},run:()=>({calls})},
 {name:'fixture_wb_wait',description:'Cancellable job',input:{},run:async()=>{const E=require(${JSON.stringify(path.join(__dirname, "../lib/execution"))});await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,10000);E.signal().addEventListener('abort',()=>{clearTimeout(timer);reject(E.abortError());},{once:true});});return {done:true};}}
];`,
);
const A = require("../lib/access"),
  W = require("../lib/workbench"),
  T = require("../lib/tools");
const scope = (principalId = "alice", storyId = "case-one", extra = {}) =>
  A.normalize({
    principalId,
    storyId,
    role: "user",
    multiUser: true,
    ...extra,
  });
const owned = (fn) => A.run(scope(), fn);
let server,
  provider,
  base,
  reply,
  modelRequests = [],
  savedRun;
test.before(async () => {
  const writer = require("../lib/catalog-store").writer("dev", "wb-fixture");
  writer.finishEdges();
  for (let i = 0; i < 85; i++)
    writer.line(`pg orders sales.orders_${i} ~1: id int`);
  writer.line("pgfn orders sales.total(integer) -> integer [function sql]");
  writer.line(
    "svc order-service DEMO/order-service@abc123: tables sales.orders_1; endpoints 1",
  );
  writer.line("kafka order.created 1: id");
  writer.commit();
  provider = http.createServer((req, res) => {
    let body = "";
    req
      .on("data", (d) => (body += d))
      .on("end", () => {
        modelRequests.push(JSON.parse(body));
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    typeof reply === "string" ? reply : JSON.stringify(reply),
                },
              },
            ],
          }),
        );
      });
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  server = require("../server").start({ port: 0 });
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => provider.close(r));
  await require("../lib/isolate").stop();
  await require("../lib/state-store").close();
  fs.rmSync(home, { recursive: true, force: true });
});
async function request(
  route,
  body,
  { user = "alice", story = "case-one" } = {},
) {
  const response = await fetch(base + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(user ? { authorization: "Bearer " + tokens[user] } : {}),
      "x-dt-story": story,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, value: await response.json() };
}
async function settled(id) {
  for (let i = 0; i < 100; i++) {
    const run = owned(() => W.state(id));
    if (run.state !== "running") return run;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw Error("Job did not settle");
}

test("bootstrap exposes enabled intent actions without relaxing grants or environments", async () => {
  const data = await owned(() => W.bootstrap({ env: "dev" }));
  assert.equal(data.protocol, "dt.workbench/v1");
  assert.ok(data.catalog.generation);
  const names = new Set(data.tools.map((t) => t.name));
  for (const g of data.groups)
    for (const intent of g.intents)
      for (const name of intent.tools) assert.ok(names.has(name));
  const limited = await A.run(
    scope("limited", "case-one", {
      tools: ["pg_query", "context_find"],
      envs: ["dev"],
    }),
    () => W.bootstrap({ env: "dev" }),
  );
  assert.deepEqual(limited.envs, ["dev"]);
  assert.deepEqual(limited.tools.map((t) => t.name).sort(), [
    "context_find",
    "pg_query",
  ]);
  assert.equal(limited.model.allowed, false);
  assert.equal(
    (await request("/api/admin/workbench", undefined, { user: null })).status,
    403,
  );
  assert.equal(
    (
      await request("/api/admin/workbench?env=uat", undefined, {
        user: "limited",
      })
    ).status,
    403,
  );
});
test("indexed choices page by generation, preserve exact identities, and reject undeclared fields", async () => {
  const args = { tool: "pg_table", field: "name", env: "dev", query: "" };
  const first = await owned(() => W.choices(args));
  assert.equal(first.choices.length, 40);
  assert.ok(first.nextCursor);
  assert.equal(first.choices[0].prefix, "Table");
  assert.match(first.choices[0].value, /^orders:sales.orders_/);
  const second = await owned(() =>
    W.choices({ ...args, cursor: first.nextCursor }),
  );
  assert.equal(second.generation, first.generation);
  assert.equal(second.choices.length, 40);
  assert.notEqual(second.choices[0].value, first.choices[0].value);
  const service = await owned(() =>
    W.choices({ tool: "passport", field: "service", env: "dev" }),
  );
  assert.equal(service.choices[0].value, "order-service");
  const fn = await owned(() =>
    W.choices({ tool: "pg_function", field: "name", env: "dev" }),
  );
  assert.equal(fn.choices[0].value, "orders:sales.total");
  await assert.rejects(
    owned(() => W.choices({ ...args, field: "made_up" })),
    /not declared/,
  );
  const forbidden = await request(
    "/api/admin/workbench/choices",
    { tool: "pg_query", field: "sql", env: "dev" },
    { user: "limited" },
  );
  assert.equal(forbidden.status, 200);
  assert.deepEqual(forbidden.value.choices, []);
  assert.match(forbidden.value.gaps[0], /unavailable/);
  const empty = await owned(() => W.choices({ ...args, env: "uat" }));
  assert.equal(empty.generation, null);
  assert.ok(empty.gaps.length);
});
test("task and store selectors contain owned metadata, not configured locations", async () => {
  await owned(() =>
    T.call("context_open", { id: "mine", title: "Owned investigation" }),
  );
  await A.run(scope("bob"), () =>
    T.call("context_open", { id: "foreign", title: "Foreign investigation" }),
  );
  await owned(() =>
    T.call("context_write", {
      id: "mine",
      path: "evidence/source.json",
      content: "{}",
    }),
  );
  const tasks = await owned(() =>
    W.choices({ tool: "context_read", field: "id" }),
  );
  assert.deepEqual(
    tasks.choices.map((c) => c.value),
    ["mine"],
  );
  const files = await owned(() =>
    W.choices({
      tool: "context_read",
      field: "path",
      arguments: { id: "mine" },
    }),
  );
  assert.equal(files.choices[0].value, "evidence/source.json");
  const stores = await owned(() =>
    W.choices({ tool: "files_list", field: "store" }),
  );
  assert.ok(stores.choices.some((c) => c.value === "notes"));
  assert.ok(stores.choices.some((c) => c.value === "context:mine"));
  assert.doesNotMatch(
    JSON.stringify(stores),
    /foreign|unused.invalid|postgres:\/\//,
  );
  const listing = await owned(() =>
    W.choices({
      tool: "files_read",
      field: "path",
      arguments: { store: "context:mine", dir: "evidence" },
    }),
  );
  assert.ok(listing.choices.some((c) => /source.json$/.test(c.value)));
  await assert.rejects(
    owned(() =>
      W.choices({
        tool: "context_read",
        field: "path",
        arguments: { id: "foreign" },
      }),
    ),
    /context|story|found/i,
  );
});
test("selectors cover registered tools, enums, repositories and exact source files without live fetching", async () => {
  const root = path.join(home, "source");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "Main.java"), "class Main {}");
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested/Child.java"), "class Child {}");
  owned(() => {
    const dir = A.scopedDirectory(path.join(home, "cache/work"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "picker-workspace.json"),
      JSON.stringify({
        id: "picker-workspace",
        owner: A.owner(),
        path: root,
        project: "DEMO",
        repo: "orders",
      }),
    );
  });
  owned(() =>
    require("../lib/codeindex").build(root, "DEMO/orders", {
      sha: "a".repeat(40),
      project: "DEMO",
      repo: "orders",
      ref: "main",
    }),
  );
  const select = (tool, field, arguments_ = {}) =>
    owned(() => W.choices({ tool, field, env: "dev", arguments: arguments_ }));
  const repo = await select("code_read", "repo");
  assert.ok(repo.choices.some((c) => c.value === "DEMO/orders"));
  const files = await select("code_read", "path", { repo: "DEMO/orders" });
  assert.ok(files.choices.some((c) => c.value === "Main.java"));
  const workspaceFiles = await select("workspace_read", "path", {
    workspace: "picker-workspace",
  });
  assert.ok(workspaceFiles.choices.some((c) => c.browse === "nested/"));
  const nested = await owned(() =>
    W.choices({
      tool: "workspace_read",
      field: "path",
      arguments: { workspace: "picker-workspace" },
      directory: "nested/",
    }),
  );
  assert.ok(nested.choices.some((c) => c.value === "nested/Child.java"));
  assert.ok(nested.choices.some((c) => c.browse === ""));
  assert.throws(
    () =>
      owned(() =>
        require("../lib/workspace").write(
          "picker-workspace",
          "",
          "overwrite root",
        ),
      ),
    /outside/,
  );
  assert.throws(
    () =>
      owned(() =>
        require("../lib/workspace").read("picker-workspace", "../outside"),
      ),
    /outside/,
  );
  const revision = await select("passport", "ref", { repo: "DEMO/orders" });
  assert.ok(revision.choices.some((c) => c.value === "a".repeat(40)));
  assert.ok(
    (await select("pg_query", "db")).choices.some((c) => c.value === "orders"),
  );
  assert.ok(
    (await select("show", "view")).choices.some((c) => c.value === "table"),
  );
  assert.ok(
    (await select("context_run", "tool")).choices.some(
      (c) => c.value === "pg_query",
    ),
  );
  assert.ok(
    (await select("pg_query", "env")).choices.some((c) => c.value === "uat"),
  );
  assert.ok(
    (await select("passport", "env")).choices.some((c) => c.value === "dev"),
  );
  assert.deepEqual((await select("semantic_query", "analysis")).choices, []);
  await assert.rejects(
    owned(() =>
      W.choices({ tool: "code_read", field: "repo", cursor: "invalid" }),
    ),
    /Invalid choice page/,
  );
  await assert.rejects(
    owned(() => W.choices({ tool: "passport", field: "constructor" })),
    /not declared/,
  );
});
test("runs validate before effects, honor optional env semantics, retain full evidence and private capture", async () => {
  await assert.rejects(
    owned(() => W.start({ tool: "fixture_wb", arguments: {}, env: "dev" })),
    /service/,
  );
  await assert.rejects(
    owned(() => W.start({ tool: "fixture_wb", arguments: [], env: "dev" })),
    /object/,
  );
  await assert.rejects(
    owned(() =>
      W.start({
        tool: "fixture_wb",
        arguments: { service: "s", rows: [{ unexpected: true }] },
        env: "dev",
      }),
    ),
    /unknown/,
  );
  assert.equal((await owned(() => T.call("fixture_wb_calls", {}))).calls, 0);
  const started = await owned(() =>
    W.start({
      tool: "fixture_wb",
      arguments: {
        service: "order-service",
        token: "do-not-show",
        large: true,
      },
      env: "dev",
      context: "mine",
    }),
  );
  savedRun = await settled(started.job);
  assert.equal(savedRun.state, "done");
  assert.equal(savedRun.result.ok, true);
  assert.equal(
    savedRun.result.arguments.env,
    undefined,
    "optional environment must not turn cached inspection into a deployed refresh",
  );
  assert.equal(savedRun.result.arguments.token, "[redacted]");
  assert.ok(savedRun.result.previewTruncated);
  assert.ok(savedRun.result.recordView);
  assert.ok(savedRun.result.saved);
  const full = owned(() =>
    require("../lib/results").load(savedRun.result.recordView.split("/").pop()),
  );
  assert.equal(full.data.result.payload.length, 120000);
  assert.doesNotMatch(JSON.stringify(full), /do-not-show/);
  assert.equal(
    (
      await request("/api/admin/workbench/run/" + started.job, undefined, {
        user: "bob",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/api/admin/workbench/run/" + started.job, undefined, {
        story: "another-task",
      })
    ).status,
    404,
  );
  assert.throws(
    () =>
      A.run(scope("alice", "case-one", { tools: ["find"] }), () =>
        W.state(started.job),
      ),
    /available/,
  );
  const failure = await owned(() =>
    W.start({
      tool: "fixture_wb",
      arguments: { service: "s", fail: true },
      env: "dev",
    }),
  );
  const failed = await settled(failure.job);
  assert.equal(failed.result.ok, false);
  assert.match(failed.result.error.message, /fixture rejected/);
  assert.ok(owned(() => W.state(started.job)).result.recordView);
});
test("saving failure is separate from tool success, and owned cancellation stops work", async () => {
  const R = require("../lib/results"),
    save = R.saveView;
  R.saveView = () => {
    throw Error("simulated full disk");
  };
  try {
    const run = await owned(() =>
      W.start({ tool: "fixture_wb", arguments: { service: "s" }, env: "dev" }),
    );
    const done = await settled(run.job);
    assert.equal(done.result.ok, true);
    assert.match(done.result.saveError, /full disk/);
  } finally {
    R.saveView = save;
  }
  const run = await owned(() =>
    W.start({ tool: "fixture_wb_wait", arguments: {}, env: "dev" }),
  );
  assert.notEqual(
    (
      await request(
        "/api/admin/job/" + run.job + "/cancel",
        {},
        { user: "bob" },
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/admin/job/" + run.job + "/cancel", {})).status,
    200,
  );
  const stopped = await settled(run.job);
  assert.equal(stopped.state, "cancelled");
  assert.notEqual(
    (
      await request("/api/admin/workbench/run", {
        tool: "catalog_sync",
        arguments: { what: "index" },
        env: "dev",
      })
    ).status,
    202,
  );
});
test("retained inline results reopen as owned evidence without replay or fabricated invocation success", async () => {
  const link = owned(() =>
      require("../lib/results").saveView(
        "table",
        [{ service: "order-service", table: "sales.orders_1" }],
        { title: "Saved investigation", env: "dev" },
      ),
    ),
    id = link.split("/").pop();
  const retained = await request("/api/admin/workbench/evidence/" + id);
  assert.equal(retained.status, 200);
  assert.equal(retained.value.state, "saved");
  assert.equal(retained.value.result.ok, undefined);
  assert.equal(retained.value.result.result[0].table, "sales.orders_1");
  assert.equal(
    (
      await request("/api/admin/workbench/evidence/" + id, undefined, {
        user: "bob",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/api/admin/workbench/evidence/" + id, undefined, {
        story: "another-task",
      })
    ).status,
    404,
  );
});
test("passport previews retain the effective owned snapshot for opaque-origin embeds", async () => {
  const p = {
    service: "sample",
    env: "dev",
    repo: { project: "DEMO", repo: "sample", sha: "a".repeat(40) },
    summary: {},
    effective: { tables: [{ table: "sales.corrected", source: "manual" }] },
  };
  const shown = owned(() => require("../lib/passport/present")(p, true));
  const url = new URL(shown.view),
    id = url.searchParams.get("snapshot");
  assert.ok(id);
  const r = await fetch(base + "/api/result/" + id, {
    headers: { origin: "null" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const snapshot = await r.json();
  assert.equal(snapshot.data.effective.tables[0].table, "sales.corrected");
  assert.equal(snapshot.owner.principalId, "alice");
  assert.equal(
    (await request("/api/result/" + id, undefined, { user: "bob" })).status,
    404,
  );
});
test("model help is optional, scoped, bounded, validated and never executes a suggested call", async () => {
  assert.equal(
    (
      await owned(() =>
        W.assist({ mode: "suggest", goal: "Find orders", env: "dev" }),
      )
    ).configured,
    false,
  );
  config.llm = {
    baseUrl: "http://127.0.0.1:" + provider.address().port,
    model: "fixture-model",
  };
  saveConfig();
  const before = (await owned(() => T.call("fixture_wb_calls", {}))).calls;
  reply = {
    summary: "Inspect the cached identity",
    observations: ["A service was selected"],
    uncertainties: ["Runtime behavior was not tested"],
    next: [
      {
        tool: "fixture_wb",
        arguments: {},
        reason: "Prepare an exact service",
        missing: ["service"],
      },
    ],
  };
  const help = await owned(() =>
    W.assist({
      mode: "suggest",
      goal: "fixture_wb",
      env: "dev",
      tool: "fixture_wb",
      arguments: { token: "hide-this" },
    }),
  );
  assert.equal(help.executionPerformed, false);
  assert.ok(help.next[0].validation.length);
  assert.equal(
    (await owned(() => T.call("fixture_wb_calls", {}))).calls,
    before,
  );
  assert.doesNotMatch(JSON.stringify(modelRequests.at(-1)), /hide-this/);
  reply.next = [
    {
      tool: "fixture_wb",
      arguments: { service: "order-service" },
      reason: "Review this argument",
      missing: [],
    },
  ];
  const valid = await owned(() =>
    W.assist({
      mode: "interpret",
      goal: "fixture_wb",
      env: "dev",
      tool: "fixture_wb",
      job: savedRun.id,
    }),
  );
  assert.deepEqual(valid.next[0].validation, []);
  assert.equal(valid.evidenceJob, savedRun.id);
  await assert.rejects(
    A.run(scope("bob"), () =>
      W.assist({ mode: "interpret", env: "dev", job: savedRun.id }),
    ),
    /unavailable/,
  );
  reply = "bad json";
  await assert.rejects(
    owned(() => W.assist({ mode: "suggest", goal: "orders", env: "dev" })),
    /invalid JSON/,
  );
  reply = {
    summary: "No",
    observations: [],
    uncertainties: [],
    next: [{ tool: "not_enabled", arguments: {}, reason: "No", missing: [] }],
  };
  await assert.rejects(
    owned(() => W.assist({ mode: "suggest", goal: "orders", env: "dev" })),
    /unavailable/,
  );
  assert.equal(
    (
      await request(
        "/api/admin/workbench/assist",
        { mode: "suggest", env: "dev" },
        { user: "limited" },
      )
    ).status,
    403,
  );
});
