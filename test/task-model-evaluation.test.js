const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  os = require("os"),
  path = require("path"),
  http = require("http"),
  { spawn } = require("child_process");
const { options, validateTask, observedTestFailures, safeEvent } = require("../dev/eval-tasks-model");
test('private mutation source and failure snippets are represented by hashes in the safe transcript', () => {
  const secret = 'PRIVATE-MUTANT-EXPECTATION';
  const e = safeEvent({ caller: 'mutation-harness', name: 'workspace_write', input: { path: 'src/value.cjs', content: secret }, result: { outcome: 'failed', tail: secret, parts: [{ snippet: secret }], counts: { failed: 1 } } });
  assert.equal(JSON.stringify(e).includes(secret), false);
  assert.match(e.input.contentSha256, /^[a-f0-9]{64}$/); assert.match(e.result.resultSha256, /^[a-f0-9]{64}$/);
  assert.equal(e.result.counts.failed, 1);
});
test('mutant rejection requires complete assertion-only failures, not a crash or truncated/mixed diagnostics', () => {
  const a = { failureKind: 'assertion' }, crash = { failureKind: 'test-error', message: 'unrelated service unavailable' };
  assert.equal(observedTestFailures({ failures: [a], counts: { failed: 1 } }).onlyAssertionFailures, true);
  for (const r of [
    { failures: [crash], counts: { failed: 1 } },
    { failures: [a, crash], counts: { failed: 2 } },
    { failures: [a], counts: { failed: 11 } },
    { failures: [a], counts: { failed: 1, errors: 1 } },
    { failures: [a], counts: { failed: 1, skipped: 1 } },
    { failures: [{ failureKind: 'test-error', expected: 1, actual: 2 }], counts: { failed: 1 } },
    { failures: [{ type: 'TypeError', stack: 'TypeError: message mentions AssertionError and ERR_ASSERTION' }], counts: { failed: 1 } },
    { failures: [a], counts: { failed: 2 }, failureKinds: { assertions: 1, testErrors: 1 } },
  ]) assert.equal(observedTestFailures(r).onlyAssertionFailures, false);
  assert.equal(observedTestFailures({ failures: [a], counts: { failed: 11 }, failureKinds: { assertions: 11, testErrors: 0 } }).onlyAssertionFailures, true);
});
test("task evaluation requires an explicit immutable public pack/private grader/endpoint and bounded generation", () => {
  assert.throws(() => options([]), /endpoint/);
  const base = [
    "--endpoint",
    "http://localhost:1",
    "--model",
    "test",
    "--pack",
    "public.json",
    "--grader",
    "private.cjs",
    "--output",
    "results",
  ];
  assert.equal(options(base).profile, "lean-find");
  assert.throws(() => options([...base, "--max-calls", "129"]), /bounded/);
  assert.throws(
    () => options([...base, "--temperature", "NaN"]),
    /temperature/,
  );
  assert.throws(
    () =>
      validateTask({
        id: "bad",
        kind: "fix",
        prompt: "fix",
        tests: ["test/check.test.cjs"],
        editable: [],
        files: { "../escape": "x" },
      }),
    /file/,
  );
});
test(
  "scripted endpoint executes real isolated tools; hidden oracle catches false success without entering sandbox",
    { skip: !['1', 'true'].includes(process.env.DT_TEST_TASK_EVAL_DOCKER || process.env.DT_TEST_TASK_EVAL), timeout: 180000 },
  async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dt-task-eval-test-")),
      pack = path.join(home, "public.json"),
      grader = path.join(home, "PRIVATE-ORACLE.cjs"),
      out = path.join(home, "results");
    const source = `exports.total=n=>n+1`,
      tests = `const t=require('node:test'),a=require('node:assert/strict');t('double',()=>a.equal(require('../src/value.cjs').total(4),8));`;
    fs.writeFileSync(
      pack,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "fixed",
            kind: "fix",
            prompt:
              "Fix total(n): it must return n doubled, including negatives and zero. Add regression coverage if needed.",
            editable: ["src/value.cjs", "test/generated/"],
            tests: ["test/value.test.cjs", "test/empty.test.cjs"],
            files: {
              "src/value.cjs": source,
              "src/privacy.cjs": `exports.inspect=()=>{let configReadonly=false;try{require('fs').appendFileSync('/opt/dt/evaluation-config/config.json','tampered');}catch(e){configReadonly=['EROFS','EACCES'].includes(e.code);}return {key:process.env.DT_EVAL_API_KEY||null,oracle:require('fs').existsSync('/opt/dt/dev/PRIVATE-ORACLE.cjs'),corpus:require('fs').existsSync('/opt/dt/dev/challenge-oracle-v1.json'),socket:require('fs').existsSync('/var/run/docker.sock'),configReadonly}}`,
              "test/value.test.cjs": tests,
              "test/empty.test.cjs": "module.exports = 1",
            },
          },
          {
            id: "false-success",
            kind: "fix",
            prompt:
              "Fix total(n): it must return n doubled, including negatives and zero.",
            editable: ["src/value.cjs"],
            tests: ["test/value.test.cjs", "test/empty.test.cjs"],
            files: {
              "src/value.cjs": source,
              "src/privacy.cjs": `exports.inspect=()=>({key:process.env.DT_EVAL_API_KEY||null,oracle:require('fs').existsSync('/opt/dt/dev/PRIVATE-ORACLE.cjs'),corpus:require('fs').existsSync('/opt/dt/dev/challenge-oracle-v1.json'),socket:require('fs').existsSync('/var/run/docker.sock')})`,
              "test/value.test.cjs": tests,
              "test/empty.test.cjs": "module.exports = 1",
            },
          },
          ...['harness-only', 'private-error'].map(id => ({
            id, kind: 'fix', prompt: 'Fix total(n): it must return n doubled, including negatives and zero.',
            editable: ['src/value.cjs'], tests: ['test/value.test.cjs'],
            files: { 'src/value.cjs': source, 'test/value.test.cjs': tests },
          })),
          {
            id: 'mutant-error', kind: 'tests', prompt: 'Add test coverage that rejects incorrect multiplication behavior with actual assertions.',
            editable: ['test/generated/'], tests: ['test/value.test.cjs'],
            files: { 'src/value.cjs': 'exports.total=n=>n*2', 'test/value.test.cjs': tests },
          },
        ],
      }),
    );
    fs.writeFileSync(
      grader,
      `module.exports=async c=>{if(c.task.id==='private-error')throw Error('DO-NOT-RETAIN-PRIVATE-EXPECTED-01234');if(c.task.id==='mutant-error'){const r=await c.mutation({path:'src/value.cjs',content:'exports.total=()=>{throw Error("DO-NOT-RETAIN-PRIVATE-EXPECTED-01234")};'});c.assert(r.outcome==='failed','mutant crashed');return {passed:true};}for(const n of [-7,0,2,99]){const got=await c.invoke({module:'src/value.cjs',export:'total',args:[n]});c.assert(got.status==='returned'&&got.value===n*2,'private doubled contract');}if(c.task.files['src/privacy.cjs']){const privacy=await c.invoke({module:'src/privacy.cjs',export:'inspect',args:[]});const fields=Object.fromEntries(privacy.value.entries);c.assert(fields.key===null&&!fields.oracle&&!fields.corpus&&!fields.socket&&fields.configReadonly===true,'isolated oracle and credentials');}return {passed:true,diagnostic:'DO-NOT-RETAIN-PRIVATE-EXPECTED-01234'};};`,
    );
    let sawOracle = false,
      requests = 0;
    const server = http.createServer(async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      requests++;
      if (
        text.includes("private doubled contract") ||
        text.includes("PRIVATE-ORACLE")
      )
        sawOracle = true;
      const task = body.messages[1].content,
        workspace = task.match(/Workspace: ([\w-]+)/)[1],
        isFalse = workspace === 'false-success';
      const modelMessages = body.messages.filter((x) => x.role === "assistant");
      let message;
      if (!modelMessages.length)
        message = {
          role: "assistant",
          tool_calls: [
            {
              id: "inspect",
              type: "function",
              function: {
                name: "tool_execute",
                arguments: JSON.stringify({
                  name: "workspace_read",
                  arguments: {
                    workspace,
                    path: "src/value.cjs",
                  },
                }),
              },
            },
            ...['probe', 'read', 'snapshot'].map(name => ({ id: 'forbidden-' + name, type: 'function', function: { name: 'tool_execute', arguments: JSON.stringify({ name, arguments: { workspace, op: 'probe', module: 'src/privacy.cjs', export: 'inspect', args: [] } }) } })),
            null,
          ],
        };
      else if (modelMessages.length === 1)
        message = {
          role: "assistant",
          tool_calls: [
            {
              id: "write",
              type: "function",
              function: {
                name: "tool_execute",
                arguments: JSON.stringify({
                  name: "workspace_write",
                  arguments: {
                    workspace,
                    path: workspace === 'mutant-error' ? 'test/generated/added.test.cjs' : "src/value.cjs",
                    content: workspace === 'mutant-error' ? 'module.exports=1' : isFalse
                      ? `exports.total=n=>8`
                      : `exports.total=n=>n*2`,
                    check: false,
                  },
                }),
              },
            },
          ],
        };
      else if (workspace !== 'harness-only' && (modelMessages.length === 2 || JSON.parse(body.messages.at(-1).content).state === 'running')) {
        const previous = JSON.parse(body.messages.at(-1).content);
        message = { role: 'assistant', tool_calls: [{ id: 'run-' + modelMessages.length, type: 'function', function: { name: 'tool_execute', arguments: JSON.stringify({ name: 'test_run', arguments: previous.state === 'running' ? { workspace, job: previous.job } : { workspace, tests: ['test/value.test.cjs'], mode: 'build' } }) } }] };
      } else
        message = {
          role: "assistant",
          content: JSON.stringify({
            claimedStatus: "complete",
            summary: "Fixed and verified.",
          }),
        };
      if (modelMessages.length > 2 && body.messages.at(-1).role === 'tool' && JSON.parse(body.messages.at(-1).content).state === 'running')
        await new Promise(resolve => setTimeout(resolve, 300));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          model: "scripted-protocol-fixture",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          choices: [{ message }],
        }),
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const args = [
        path.resolve(__dirname, "../dev/eval-tasks-model.js"),
        "--endpoint",
        `http://127.0.0.1:${server.address().port}`,
        "--model",
        "scripted-protocol-fixture",
        "--scripted-endpoint",
        "--pack",
        pack,
        "--grader",
        grader,
        "--output",
        out,
        "--max-turns",
        "24",
        "--max-duration-ms",
        "150000",
      ];
      const result = await new Promise((resolve, reject) => {
        const p = spawn(process.execPath, args, {
          env: { ...process.env, DT_EVAL_API_KEY: "host-only-key" },
        });
        let output = "",
          error = "";
        p.stdout.on("data", (c) => (output += c));
        p.stderr.on("data", (c) => (error += c));
        p.on("error", reject);
        p.on("close", (code) =>
          code ? reject(Error(error)) : resolve(JSON.parse(output)),
        );
      });
      assert.equal(result.kind, "scripted-task-contract-check");
      assert.equal(result.metrics.cases, 5);
      assert.equal(result.metrics.selectedCases, 5); assert.equal(result.metrics.unattemptedCases, 0); assert.equal(result.metrics.supportedSelectedCases, 5);
      assert.equal(result.metrics.complete, 1, JSON.stringify(result.samples));
      assert.equal(result.metrics.supportedToolComplete, 2);
      assert.equal(result.metrics.falseSuccess, 4);
      assert.equal(result.metrics.infrastructureErrors, 0);
      assert.equal(sawOracle, false);
      assert.ok(requests >= 18);
      const record = JSON.parse(
        fs.readFileSync(path.join(out, "fixed/result.json")),
      );
      assert.equal(record.assessment.toolComplete, true);
      assert.equal(record.assessment.modelComplete, true);
      assert.equal(record.execution.baseline.counts.failed, 1);
      assert.equal(record.execution.baseline.assertionFailure, true);
      assert.equal(record.execution.isolation.network, "none");
      assert.equal(record.execution.isolation.readOnlyRootfs, true);
      assert.equal(record.execution.post.counts.passed, 1);
      assert.equal(record.grade.assertions, 5);
      assert.equal(record.integrity.protectedUnchanged, true);
      const transcript = JSON.parse(fs.readFileSync(path.join(out, 'retention/cache/evaluations', record.id, 'transcript.json')));
      for (const name of ['probe', 'read', 'snapshot']) assert.ok(transcript.some(e => e.caller === 'model' && e.input?.name === name && e.error), name + ' RPC not executable as a tool');
      const manifest = fs.readFileSync(path.join(out, "summary.json"), "utf8");
      assert.ok(!manifest.includes("host-only-key"));
      for (const id of ['fixed', 'private-error', 'harness-only', 'mutant-error']) {
        const r = JSON.parse(fs.readFileSync(path.join(out, id, 'result.json')));
        assert.ok(!JSON.stringify(r).includes('DO-NOT-RETAIN-PRIVATE-EXPECTED-01234'));
        assert.equal(r.execution.cleanup.complete, true);
      }
      const harness = JSON.parse(fs.readFileSync(path.join(out, 'harness-only/result.json')));
      assert.equal(harness.assessment.toolComplete, true); assert.equal(harness.assessment.modelComplete, false);
      const mutant = JSON.parse(fs.readFileSync(path.join(out, 'mutant-error/result.json')));
      assert.equal(mutant.mutations.killed, 0); assert.equal(mutant.mutations.infrastructureFailures, 1);
      const checkRetained = directory => { for (const f of fs.readdirSync(directory, { withFileTypes: true })) { const name = path.join(directory, f.name); if (f.isDirectory()) checkRetained(name); else if (f.isFile()) assert.ok(!fs.readFileSync(name, 'utf8').includes('DO-NOT-RETAIN-PRIVATE-EXPECTED-01234'), 'private grader value retained in ' + path.relative(out, name)); } };
      checkRetained(out);
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(home, { recursive: true, force: true });
    }
  },
);
