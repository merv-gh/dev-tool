#!/usr/bin/env node
// Real tool task evaluator. Public code runs inside Docker; private oracle stays in this parent.
const fs = require("fs"),
  os = require("os"),
  path = require("path"),
  crypto = require("crypto"),
  { spawn, execFileSync } = require("child_process");
const { validateEndpoint } = require("./eval-discovery-model");
const E = require("../lib/evaluation-evidence");
const hash = E.digest;
const assertion = f => f && (f.failureKind ? f.failureKind === 'assertion' : /AssertionError|ERR_ASSERTION|AssertionFailedError|ComparisonFailure/i.test([f.type, f.stack].filter(Boolean).join(' ')));
function observedTestFailures(r) {
  const failures = r.failures || [];
  if (r.failureKinds) {
    const { assertions, testErrors } = r.failureKinds;
    const valid = Number.isSafeInteger(assertions) && assertions >= 0 && Number.isSafeInteger(testErrors) && testErrors >= 0 && assertions + testErrors === (r.counts?.failed || 0) + (r.counts?.errors || 0);
    return { assertionFailure: valid && assertions > 0, onlyAssertionFailures: valid && assertions > 0 && testErrors === 0 && !r.counts?.skipped };
  }
  return {
    assertionFailure: failures.some(assertion),
    onlyAssertionFailures: failures.length > 0 && failures.every(assertion) && failures.length === (r.counts?.failed || 0) + (r.counts?.errors || 0) && !r.counts?.errors && !r.counts?.skipped,
  };
}
function safeEvent(event) {
  if (event.caller !== 'mutation-harness') return event;
  const input = event.input || {}, result = event.result;
  return { ...event,
    input: { ...input, ...(typeof input.content === 'string' ? { content: undefined, contentSha256: hash(input.content), contentBytes: Buffer.byteLength(input.content) } : {}) },
    ...(result !== undefined ? { result: { job: result?.job, state: result?.state, outcome: result?.outcome, counts: result?.counts, failureKinds: result?.failureKinds, resultSha256: hash(result), privateDetailsWithheld: true } } : {}),
    ...(event.error ? { error: { code: 'DT_EVAL_PRIVATE_OPERATION', message: 'Private mutation operation failed; details withheld' } } : {}),
  };
}
const privateGradeFailure = () => ({
  independent: true,
  passed: false,
  code: 'DT_EVAL_PRIVATE_GRADE_FAILED',
  error: 'Independent grading failed; private assertions and diagnostic details are withheld',
});
function actualTool(name, input) {
  return name === 'tool_execute' ? { name: input?.name, input: input?.arguments } : { name, input };
}
function modelInteraction(events, finalSha256, changed) {
  const tests = events.filter(e => e.caller === 'model' && e.name && actualTool(e.name, e.input).name === 'test_run');
  return {
    testCalls: tests.length,
    passingTestObserved: tests.some(e => e.result?.outcome === 'passed' && e.candidateSha256 === finalSha256),
    candidateChanged: changed.length > 0,
    scope: 'Explicit model calls, including tool_execute; verification-harness calls do not count as model-observed execution',
  };
}
function options(argv) {
  const out = {
    profile: "lean-find",
    image: "node:22-alpine",
    maxTurns: 12,
    maxCalls: 32,
    maxContextBytes: 131072,
    maxOutputTokens: 2048,
    timeoutMs: 30000,
    maxDurationMs: 600000,
    limit: 100,
    temperature: 0,
  };
  const strings = new Set([
    "endpoint",
    "model",
    "pack",
    "grader",
    "output",
    "profile",
    "image",
  ]);
  const numeric = {
    "max-turns": "maxTurns",
    "max-calls": "maxCalls",
    "max-context-bytes": "maxContextBytes",
    "max-output-tokens": "maxOutputTokens",
    "timeout-ms": "timeoutMs",
    "max-duration-ms": "maxDurationMs",
    limit: "limit",
    temperature: "temperature",
    seed: "seed",
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (["allow-remote", "scripted-endpoint"].includes(key)) {
      out[key] = true;
      continue;
    }
    if (argv[i + 1] === undefined) throw Error("missing argument " + key);
    if (strings.has(key)) out[key] = argv[++i];
    else if (numeric[key]) out[numeric[key]] = Number(argv[++i]);
    else throw Error("unknown argument " + key);
  }
  for (const [k, max] of Object.entries({
    maxTurns: 32,
    maxCalls: 128,
    maxContextBytes: 1048576,
    maxOutputTokens: 8192,
    timeoutMs: 60000,
    maxDurationMs: 3600000,
    limit: 100,
  }))
    if (!Number.isInteger(out[k]) || out[k] < 1 || out[k] > max)
      throw Error("invalid bounded " + k);
  if (
    !Number.isFinite(out.temperature) ||
    out.temperature < 0 ||
    out.temperature > 2
  )
    throw Error("invalid temperature");
  if (out.seed !== undefined && !Number.isSafeInteger(out.seed))
    throw Error("invalid seed");
  for (const k of ["endpoint", "model", "pack", "grader", "output"])
    if (!out[k]) throw Error("--" + k + " is required");
  return out;
}
const docker = (args, opts = {}) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1048576,
    ...opts,
  });
function validateTask(task) {
  if (
    !/^[a-zA-Z0-9][\w.-]{0,64}$/.test(task.id || "") ||
    !task.prompt ||
    !["fix", "tests", "expected-gap"].includes(task.kind) ||
    !task.files ||
    typeof task.files !== "object" ||
    Array.isArray(task.files) ||
    !Array.isArray(task.tests) ||
    !Array.isArray(task.editable)
  )
    throw Error("invalid public task");
  if (
    task.tests.length > 50 ||
    task.tests.some((t) => typeof t !== "string" || !t) ||
    (task.kind !== "expected-gap" && !task.tests.length)
  )
    throw Error("tasks require explicit bounded test selectors");
  for (const [p, text] of Object.entries(task.files))
    if (
      !p ||
      path.posix.normalize(p) !== p ||
      path.isAbsolute(p) ||
      p.includes("\\") ||
      p.split("/").some((x) => x === ".." || x === ".git") ||
      typeof text !== "string"
    )
      throw Error("invalid public task file");
  if (
    task.editable.some(
      (p) =>
        typeof p !== "string" ||
        !p ||
        path.isAbsolute(p) ||
        p.includes("\\") ||
        p.split("/").includes(".."),
    )
  )
    throw Error("invalid editable task path");
  if (
    task.kind === "tests" &&
    task.editable.some((p) => !/(^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(p))
  )
    throw Error("tests-only tasks may edit only declared test paths");
  if (Buffer.byteLength(JSON.stringify(task)) > 2097152)
    throw Error("public task exceeds 2 MiB");
}
function stageCode() {
  const root = path.resolve(__dirname, ".."),
    stage = fs.mkdtempSync(path.join(os.tmpdir(), "dt-eval-public-code-"));
  for (const rel of [
    "lib",
    "web",
    "contracts",
    "node_modules",
    "cli.js",
    "server.js",
    "package.json",
    "package-lock.json",
  ])
    fs.cpSync(path.join(root, rel), path.join(stage, rel), { recursive: true });
  fs.chmodSync(stage, 0o755);
  fs.mkdirSync(path.join(stage, "dev"));
  fs.copyFileSync(
    path.join(__dirname, "eval-task-worker.cjs"),
    path.join(stage, "dev/eval-task-worker.cjs"),
  );
  fs.mkdirSync(path.join(stage, 'evaluation-config'));
  fs.writeFileSync(path.join(stage, 'evaluation-config/config.json'), JSON.stringify({ envs: { evaluation: {} }, tools: { profile: 'lean-find' }, tests: { waitMs: 50, timeoutMs: 30000, compileCheck: false } }));
  return stage;
}
class Sandbox {
  constructor(stage, image) {
    this.stage = stage;
    this.image = image;
    this.id = "dt-eval-" + crypto.randomBytes(8).toString("hex");
    this.seq = 0;
    this.waiters = new Map();
    this.errors = "";
  }
  async start(task, revision) {
    docker(["volume", "create", this.id]);
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--read-only",
      "--mount",
      `type=volume,src=${this.id},dst=/case`,
      this.image,
      "node",
      "-e",
      "require('fs').chmodSync('/case',0o777)",
    ]);
    this.proc = spawn(
      "docker",
      [
        "run",
        "--name",
        this.id,
        "--rm",
        "-i",
        "--network",
        "none",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=64m",
        "--pids-limit",
        "128",
        "--memory",
        "512m",
        "--cpus",
        "2",
        "--user",
        "65534:65534",
        "-e",
        "DT_HOME=/opt/dt/evaluation-config",
        '-e', 'DT_SCRIPTS_DIR=/case/scripts',
        '-e', 'DT_VIEWS_DIR=/case/views',
        '-e', 'DT_REPOS_DIR=/case/repos',
        '-e', 'DT_PASSPORTS_DIR=/case/passports',
        "-e",
        "DT_WORK_DIR=/case/work",
        "-e",
        "DT_CACHE_DIR=/case/cache",
        "-e",
        "DT_BUILD_DIR=/case/build",
        "-e",
        "DT_LOG=quiet",
        "-e",
        "DT_RATE_PER_SEC=0",
        "--mount",
        `type=bind,src=${this.stage},dst=/opt/dt,readonly`,
        "--mount",
        `type=volume,src=${this.id},dst=/case`,
        this.image,
        "node",
        "/opt/dt/dev/eval-task-worker.cjs",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "";
    this.proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1048576) {
        this.fail(Error("sandbox protocol exceeds 1 MiB"));
        return;
      }
      let n;
      while ((n = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, n);
        buffer = buffer.slice(n + 1);
        let r;
        try {
          r = JSON.parse(line);
        } catch {
          this.fail(Error("invalid sandbox protocol"));
          continue;
        }
        const w = this.waiters.get(r.id);
        if (w) {
          this.waiters.delete(r.id);
          clearTimeout(w.timer);
          r.error
            ? w.reject(
                Object.assign(Error(r.error.message), { code: r.error.code }),
              )
            : w.resolve(r.result);
        }
      }
    });
    this.proc.stderr.on("data", (chunk) => {
      this.errors = (this.errors + chunk).slice(-16000);
    });
    this.proc.on("exit", (code) => this.fail(Error("sandbox exited " + code)));
    this.proc.on("error", (e) => this.fail(e));
    await this.rpc({ op: "seed", task, revision }, 30000);
  }
  fail(error) {
    for (const w of this.waiters.values()) {
      clearTimeout(w.timer);
      w.reject(error);
    }
    this.waiters.clear();
  }
  rpc(request, timeoutMs = 30000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(Error("sandbox operation deadline exceeded"));
        try {
          docker(["rm", "-f", this.id]);
        } catch {}
      }, timeoutMs);
      this.waiters.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ ...request, id }) + "\n");
    });
  }
  inspect() {
    const info = JSON.parse(docker(["inspect", this.id]))[0];
    return {
      imageId: info.Image,
      network: info.HostConfig.NetworkMode,
      readOnlyRootfs: info.HostConfig.ReadonlyRootfs,
      capDrop: info.HostConfig.CapDrop,
      user: info.Config.User,
      mounts: info.Mounts.map((m) => ({
        destination: m.Destination,
        type: m.Type,
        writable: m.RW,
      })),
    };
  }
  exportCandidate(workspace, destination) {
    fs.mkdirSync(destination, { recursive: true });
    docker(["cp", this.id + ":/case/work/" + workspace + "/.", destination]);
    return E.snapshot(destination);
  }
  close() {
    if (this.cleanup?.complete) return this.cleanup;
    this.fail(Error("sandbox closed"));
    const errors = [];
    try {
      docker(["rm", "-f", this.id]);
    } catch (e) { if (!/No such container/i.test(String(e.stderr || e.message))) errors.push({ resource: 'container', code: 'DT_EVAL_CLEANUP_FAILED' }); }
    try {
      docker(["volume", "rm", "-f", this.id]);
    } catch (e) { if (!/No such volume/i.test(String(e.stderr || e.message))) errors.push({ resource: 'volume', code: 'DT_EVAL_CLEANUP_FAILED' }); }
    this.proc?.kill();
    this.cleanup = { complete: errors.length === 0, errors };
    return this.cleanup;
  }
}
async function run(o) {
  const endpoint = validateEndpoint(o.endpoint, o["allow-remote"]),
    key = process.env.DT_EVAL_API_KEY,
    started = Date.now(),
    deadline = started + o.maxDurationMs;
  const packText = fs.readFileSync(path.resolve(o.pack), "utf8"),
    pack = JSON.parse(packText),
    graderPath = path.resolve(o.grader),
    graderBytes = fs.readFileSync(graderPath);
  if (pack.version !== 1 || !Array.isArray(pack.tasks) || !pack.tasks.length)
    throw Error("invalid task pack");
  for (const task of pack.tasks) validateTask(task);
  if (new Set(pack.tasks.map((t) => t.id)).size !== pack.tasks.length)
    throw Error("duplicate task id");
  const publicFrozenAt = new Date().toISOString(),
    oracleSha256 = hash(graderBytes),
    oracleFrozenAt = publicFrozenAt;
  const output = path.resolve(o.output);
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw Error(
      "evaluation output directory must be empty to preserve earlier evidence",
    );
  fs.mkdirSync(output, { recursive: true });
  for (const k of [
    "DT_CONFIG_DIR",
    "DT_CACHE_DIR",
    "DT_PASSPORTS_DIR",
    "DT_WORK_DIR",
    "DT_BUILD_DIR",
    "DT_TOOLS",
  ])
    delete process.env[k];
  process.env.DT_HOME = path.join(output, "retention");
  fs.mkdirSync(process.env.DT_HOME, { recursive: true });
  fs.writeFileSync(
    path.join(process.env.DT_HOME, "config.json"),
    JSON.stringify({ envs: { evaluation: {} } }),
  );
  const stage = stageCode(),
    toolCodeSha256 = hash(E.snapshot(stage, { excludeDependencies: true })),
    dependencyLockSha256 = hash(
      fs.readFileSync(path.join(stage, "package-lock.json")),
    ),
    samples = [],
    returnedModels = new Set(),
    usage = { prompt_tokens: 0, completion_tokens: 0, reportedCalls: 0 };
  async function request(body) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error("wall-clock budget exhausted");
    const res = await fetch(endpoint + "/chat/completions", {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: "Bearer " + key } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(o.timeoutMs, remaining)),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw Error("endpoint HTTP " + res.status);
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > 1048576) throw Error("endpoint response exceeds 1 MiB");
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks));
  }
  try {
    for (const task of pack.tasks.slice(0, o.limit)) {
      if (Date.now() >= deadline) break;
      const box = new Sandbox(stage, o.image),
        events = [],
        caseStart = Date.now(),
        caseDir = path.join(output, task.id);
      fs.mkdirSync(caseDir, { recursive: true });
      let modelCalls = 0,
        finish = "turn-budget",
        claim = "incomplete",
        turns = 0,
        summary = "",
        baseline,
        post,
        grade,
        mutations;
      const revision = hash(task.files),
        publicSha256 = hash(task),
        initialManifest = Object.fromEntries(
          Object.entries(task.files).map(([p, v]) => [p, hash(v)]),
        );
      const call = async (name, input, caller = "model") => {
        const t = Date.now();
        try {
          const result = await box.rpc(
            { op: "tool", name, arguments: input },
            Math.max(1, Math.min(60000, deadline - Date.now())),
          );
          const invoked = actualTool(name, input);
          const candidateSha256 = caller === 'model' && invoked.name === 'test_run' && result?.outcome === 'passed'
            ? hash(await box.rpc({ op: 'snapshot', workspace: task.id })) : undefined;
          events.push(safeEvent({ caller, name, input, result, candidateSha256, ms: Date.now() - t }));
          return result;
        } catch (e) {
          events.push(safeEvent({
            caller,
            name,
            input,
            error: { message: e.message, code: e.code },
            ms: Date.now() - t,
          }));
          throw e;
        }
      };
      const tests = async (caller) => {
        const before = await box.rpc({ op: "snapshot", workspace: task.id });
        let r = await call(
          "test_run",
          { workspace: task.id, tests: task.tests, mode: "build" },
          caller,
        );
        while (r.state === "running" && Date.now() < deadline)
          r = await call(
            "test_run",
            { workspace: task.id, job: r.job },
            caller,
          );
        return {
          through: "tool",
          tool: "test_run",
          outcome: r.outcome,
          ...observedTestFailures(r),
          counts: r.counts,
          target: r.execution,
          revision: {
            base: revision,
            beforeSha256: hash(before),
            afterSha256: hash(
              await box.rpc({ op: "snapshot", workspace: task.id }),
            ),
          },
        };
      };
      try {
        await box.start(task, revision);
        const schema = await box.rpc({ op: "schemas", profile: o.profile });
        const names = new Set(schema.map((x) => x.name)),
          tools = schema.map((x) => ({
            type: "function",
            function: {
              name: x.name,
              description: x.description,
              parameters: x.inputSchema,
            },
          }));
        if (task.kind !== "expected-gap")
          baseline = await tests("baseline-harness");
        const isolation = box.inspect();
        if (
          isolation.network !== "none" ||
          !isolation.readOnlyRootfs ||
          !isolation.capDrop.includes("ALL") ||
          isolation.mounts.some(
            (m) =>
              m.type === "bind" && (m.destination !== "/opt/dt" || m.writable),
          )
        )
          throw Error("sandbox isolation contract mismatch");
        const solverStartedAt = new Date().toISOString();
        const messages = [
          {
            role: "system",
            content:
              "Use dev-tool capabilities to solve the public task inside its disposable workspace. Discover exact schemas as needed. You have no external environment or credentials. Use supported tools to investigate, edit and test. Final response must be JSON with claimedStatus (complete, blocked or incomplete) and summary. Do not invent successful execution.",
          },
          {
            role: "user",
            content:
              task.prompt +
              "\nWorkspace: " +
              task.id +
              "\nEditable paths: " +
              JSON.stringify(task.editable) +
              "\nRequired tests: " +
              JSON.stringify(task.tests),
          },
        ];
        for (; turns < o.maxTurns; turns++) {
          if (Date.now() >= deadline) {
            finish = "wall-clock-budget";
            break;
          }
          const body = {
            model: o.model,
            temperature: o.temperature,
            max_tokens: o.maxOutputTokens,
            ...(o.seed !== undefined ? { seed: o.seed } : {}),
            tools,
            tool_choice: "auto",
            messages,
          };
          if (Buffer.byteLength(JSON.stringify(body)) > o.maxContextBytes) {
            finish = "context-budget";
            break;
          }
          let response;
          try {
            response = await request(body);
          } catch (e) {
            finish = e.name === "TimeoutError" ? "timeout" : "endpoint-error";
            break;
          }
          if (response.model) returnedModels.add(response.model);
          if (response.usage) {
            usage.reportedCalls++;
            for (const k of ["prompt_tokens", "completion_tokens"])
              if (
                Number.isSafeInteger(response.usage[k]) &&
                response.usage[k] >= 0
              )
                usage[k] += response.usage[k];
          }
          const message = response.choices?.[0]?.message;
          if (
            !message ||
            message.role !== "assistant" ||
            (message.tool_calls && !Array.isArray(message.tool_calls))
          ) {
            finish = "invalid-response";
            break;
          }
          messages.push(message);
          events.push({ caller: "model", message });
          const calls = message.tool_calls || [];
          if (!calls.length) {
            try {
              const final = JSON.parse(message.content);
              if (
                !["complete", "blocked", "incomplete"].includes(
                  final.claimedStatus,
                )
              )
                throw Error();
              claim = final.claimedStatus;
              summary = String(final.summary || "").slice(0, 4000);
              finish = "assistant-finished";
            } catch {
              finish = "invalid-final-claim";
            }
            break;
          }
          if (modelCalls + calls.length > o.maxCalls) {
            finish = "call-budget";
            break;
          }
          for (const c of calls) {
            modelCalls++;
            let result;
            try {
              if (
                !c.id ||
                c.type !== "function" ||
                !names.has(c.function?.name)
              )
                throw Error("tool unavailable in selected profile");
              const input = JSON.parse(c.function.arguments);
              result = await call(c.function.name, input);
            } catch (e) {
              result = { error: e.message, code: e.code || "DT_EVAL_ARGUMENT" };
            }
            messages.push({
              role: "tool",
              tool_call_id: c?.id || "invalid",
              content: JSON.stringify(result),
            });
          }
        }
        if (task.kind !== "expected-gap") post = await tests("post-harness");
        if (hash(fs.readFileSync(graderPath)) !== oracleSha256)
          throw Error("private grader changed after freeze");
        const grader = (...args) => Promise.resolve().then(() => {
          const evaluate = require(graderPath);
          if (typeof evaluate !== 'function') throw Error('private grader must export an async grading function');
          return evaluate(...args);
        });
        let asserts = 0;
        const observedMutations = [];
        const context = {
          task: structuredClone(task),
          assert(value, message) {
            asserts++;
            if (!value)
              throw Error(
                "hidden assertion failed" + (message ? ": " + message : ""),
              );
          },
          async invoke({ module, export: member, args }) {
            if (!Array.isArray(args)) throw Error("probe args must be array");
            const result = await box.rpc(
              { op: "probe", workspace: task.id, module, export: member, args },
              Math.min(30000, Math.max(1, deadline - Date.now())),
            );
            events.push({
              caller: "hidden-grader",
              operation: "input-probe",
              module,
              export: member,
              inputSha256: hash(args),
              resultSha256: hash(result),
            });
            return result;
          },
          async runTests() {
            return tests("hidden-grader");
          },
          async mutation({ path: rel, content }) {
            const previous = await box.rpc({
              op: "read",
              workspace: task.id,
              path: rel,
            });
            const beforeText = task.files[rel];
            if (typeof beforeText !== "string")
              throw Error("mutation path must name an original public source");
            await call(
              "workspace_write",
              { workspace: task.id, path: rel, content, check: false },
              "mutation-harness",
            );
            let result;
            try {
              result = await tests("mutation-harness");
            } finally {
              const candidateText = previous.text;
              await call(
                "workspace_write",
                {
                  workspace: task.id,
                  path: rel,
                  content: candidateText,
                  check: false,
                },
                "mutation-harness",
              );
            }
            observedMutations.push(result);
            return result;
          },
        };
        try {
          let gradeTimer;
          const judged = await Promise.race([
            Promise.resolve().then(() => grader(context)),
            new Promise((_, reject) => { gradeTimer = setTimeout(() => reject(Error('private grading deadline exceeded')), Math.max(1, deadline - Date.now())); }),
          ]).finally(() => clearTimeout(gradeTimer));
          grade = {
            // A private grader may return arbitrary diagnostics containing expected
            // values. Only its public verdict fields may enter retained artifacts.
            expectedUnsupported: judged?.expectedUnsupported === true,
            independent: true,
            passed: judged?.passed !== false,
            assertions: asserts,
          };
          mutations = observedMutations.length
            ? {
                executed: true,
                through: "tool",
                total: observedMutations.length,
                killed: observedMutations.filter(
                  (r) =>
                    r.outcome === "failed" &&
                    r.onlyAssertionFailures === true &&
                    (r.counts?.failed || 0) > 0,
                ).length,
                infrastructureFailures: observedMutations.filter(
                  (r) =>
                    r.outcome !== "passed" &&
                    !(
                      r.outcome === "failed" &&
                      r.onlyAssertionFailures === true &&
                      (r.counts?.failed || 0) > 0
                    ),
                ).length,
              }
            : undefined;
        } catch (e) {
          grade = { ...privateGradeFailure(), assertions: asserts };
        }
        const candidateDir = path.join(caseDir, "candidate");
        const after = box.exportCandidate(task.id, candidateDir),
          protection = E.protectedFiles(
            initialManifest,
            candidateDir,
            task.editable,
          );
        const patch = JSON.stringify(
          {
            format: "dt-exact-files/v1",
            before: initialManifest,
            after,
            changes: protection.changed.map((p) => ({
              path: p,
              before: task.files[p] ?? null,
              after: fs.existsSync(path.join(candidateDir, p))
                ? fs.readFileSync(path.join(candidateDir, p), "utf8")
                : null,
            })),
          },
          null,
          2,
        );
        const transcript = E.chain(events);
        const report = {
          version: 1,
          case: task.id,
          kind: task.kind,
          observedAt: new Date().toISOString(),
          claimedStatus: claim,
          summary,
          integrity: {
            publicSha256,
            oracleSha256,
            candidatePatchSha256: hash(patch),
            protectedUnchanged: protection.protectedUnchanged,
            publicFrozenAt,
            oracleFrozenAt,
            graderFrozenAt: oracleFrozenAt,
            solverStartedAt,
          },
          execution: {
            baseline: task.kind === "tests" ? post : baseline,
            post,
            isolation,
            cleanup: box.close(),
          },
          modelInteraction: modelInteraction(events, hash(after), protection.changed),
          grade,
          mutations,
          transcript: {
            artifact: "transcript.json",
            events: transcript.length,
            head: transcript.at(-1)?.hash,
          },
        };
        const retained = E.save(report, {
          "candidate.patch": patch,
          "transcript.json": transcript,
          "public-task.json": task,
        });
        fs.writeFileSync(
          path.join(caseDir, "result.json"),
          JSON.stringify(retained, null, 2),
        );
        samples.push({
          id: task.id,
          finish,
          turns: Math.min(turns + 1, o.maxTurns),
          modelCalls,
          latencyMs: Date.now() - caseStart,
          evidenceId: retained.id,
          assessment: retained.assessment,
          claim,
          grade: { passed: grade.passed, assertions: grade.assertions },
          baseline: baseline?.counts,
          post: post?.counts,
          initialTools: tools.length,
          initialToolBytes: Buffer.byteLength(JSON.stringify(tools)),
        });
      } catch (e) {
        events.push({
          caller: "parent",
          operation: "infrastructure-error",
          error: e.message,
        });
        const transcript = E.chain(events),
          patch = JSON.stringify({
            format: "dt-exact-files/v1",
            error: "candidate export or execution incomplete",
          });
        const failure = {
          version: 1,
          case: task.id,
          kind: task.kind,
          observedAt: new Date().toISOString(),
          claimedStatus: claim,
          integrity: {
            publicSha256,
            oracleSha256,
            candidatePatchSha256: hash(patch),
            protectedUnchanged: false,
            publicFrozenAt,
            oracleFrozenAt,
            graderFrozenAt: oracleFrozenAt,
          },
          execution: { baseline, post, cleanup: box.close() },
          modelInteraction: { testCalls: 0, passingTestObserved: false, candidateChanged: false },
          grade: {
            independent: true,
            passed: false,
            assertions: 0,
            error: e.message,
          },
          transcript: {
            artifact: "transcript.json",
            events: transcript.length,
            head: transcript.at(-1).hash,
          },
        };
        const retained = E.save(failure, {
          "candidate.patch": patch,
          "transcript.json": transcript,
          "public-task.json": task,
        });
        fs.writeFileSync(
          path.join(caseDir, "result.json"),
          JSON.stringify(retained, null, 2),
        );
        samples.push({
          id: task.id,
          finish: "infrastructure-error",
          error: e.message,
          claim,
          evidenceId: retained.id,
          assessment: retained.assessment,
        });
      } finally {
        box.close();
      }
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const result = {
    version: 1,
    kind: o["scripted-endpoint"]
      ? "scripted-task-contract-check"
      : "model-task-evaluation",
    observedAt: new Date().toISOString(),
    provenance: {
      endpoint,
      requestedModel: o.model,
      returnedModels: [...returnedModels],
      modelSizeVerified: false,
      packSha256: hash(packText),
      oracleSha256,
      toolCodeSha256,
      dependencyLockSha256,
      runtime: process.version,
      image: o.image,
      isolation:
        "Docker network none; no caps; readonly public tool code; writable synthetic named volume; private grader only in host parent",
    },
    generation: {
      temperature: o.temperature,
      seed: o.seed ?? null,
      maxOutputTokens: o.maxOutputTokens,
    },
    budget: {
      maxTurns: o.maxTurns,
      maxCalls: o.maxCalls,
      maxContextBytes: o.maxContextBytes,
      timeoutMs: o.timeoutMs,
      maxDurationMs: o.maxDurationMs,
      exhausted: Date.now() >= deadline,
    },
    usage,
    metrics: {
      cases: samples.length,
      complete: samples.filter((s) => s.assessment.modelComplete).length,
      supportedToolComplete: samples.filter((s) => s.assessment.toolComplete).length,
      falseSuccess: samples.filter((s) => s.assessment.falseSuccess).length,
      infrastructureErrors: samples.filter(
        (s) => s.finish === "infrastructure-error",
      ).length,
    },
    samples,
    limits:
      "Actual synthetic task execution. Private expected values/grader code never enter candidate container; hidden input values necessarily do. Passing evidence is limited to these cases/model/targets and is not production certification. Scripted endpoints are contract checks, never real-model evidence.",
  };
  fs.writeFileSync(
    path.join(output, "summary.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}
if (require.main === module)
  Promise.resolve()
    .then(() => run(options(process.argv.slice(2))))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { options, validateTask, run, Sandbox, stageCode, observedTestFailures, safeEvent };
