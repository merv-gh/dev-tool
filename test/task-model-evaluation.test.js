const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  os = require("os"),
  path = require("path"),
  http = require("http"),
  { spawn } = require("child_process");
const { options, validateTask } = require("../dev/eval-tasks-model");
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
  { skip: process.env.DT_TEST_TASK_EVAL_DOCKER !== "1", timeout: 120000 },
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
              "src/privacy.cjs": `exports.inspect=()=>({key:process.env.DT_EVAL_API_KEY||null,oracle:require('fs').existsSync('/opt/dt/dev/PRIVATE-ORACLE.cjs'),corpus:require('fs').existsSync('/opt/dt/dev/challenge-oracle-v1.json'),socket:require('fs').existsSync('/var/run/docker.sock')})`,
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
        ],
      }),
    );
    fs.writeFileSync(
      grader,
      `module.exports=async c=>{for(const n of [-7,0,2,99]){const got=await c.invoke({module:'src/value.cjs',export:'total',args:[n]});c.assert(got.status==='returned'&&got.value===n*2,'private doubled contract');}const privacy=await c.invoke({module:'src/privacy.cjs',export:'inspect',args:[]});const fields=Object.fromEntries(privacy.value.entries);c.assert(fields.key===null&&!fields.oracle&&!fields.corpus&&!fields.socket,'isolated oracle and credentials');return {passed:true};};`,
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
        isFalse = task.includes("Workspace: false-success");
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
                    workspace: isFalse ? "false-success" : "fixed",
                    path: "src/value.cjs",
                  },
                }),
              },
            },
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
                    workspace: isFalse ? "false-success" : "fixed",
                    path: "src/value.cjs",
                    content: isFalse
                      ? `exports.total=n=>8`
                      : `exports.total=n=>n*2`,
                    check: false,
                  },
                }),
              },
            },
          ],
        };
      else
        message = {
          role: "assistant",
          content: JSON.stringify({
            claimedStatus: "complete",
            summary: "Fixed and verified.",
          }),
        };
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
        "4",
        "--max-duration-ms",
        "90000",
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
      assert.equal(result.metrics.cases, 2);
      assert.equal(result.metrics.complete, 1, JSON.stringify(result.samples));
      assert.equal(result.metrics.falseSuccess, 1);
      assert.equal(result.metrics.infrastructureErrors, 0);
      assert.equal(sawOracle, false);
      assert.equal(requests, 6);
      const record = JSON.parse(
        fs.readFileSync(path.join(out, "fixed/result.json")),
      );
      assert.equal(record.assessment.toolComplete, true);
      assert.equal(record.execution.baseline.counts.failed, 1);
      assert.equal(record.execution.baseline.assertionFailure, true);
      assert.equal(record.execution.isolation.network, "none");
      assert.equal(record.execution.isolation.readOnlyRootfs, true);
      assert.equal(record.execution.post.counts.passed, 1);
      assert.equal(record.grade.assertions, 5);
      assert.equal(record.integrity.protectedUnchanged, true);
      const manifest = fs.readFileSync(path.join(out, "summary.json"), "utf8");
      assert.ok(!manifest.includes("host-only-key"));
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(home, { recursive: true, force: true });
    }
  },
);
