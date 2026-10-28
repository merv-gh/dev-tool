// Public worker. Never receives an oracle, expected answer, endpoint credential or grader source.
const fs = require("fs"),
  path = require("path"),
  readline = require("readline");
let seeded = false;
function safe(root, rel) {
  if (
    typeof rel !== "string" ||
    !rel ||
    path.isAbsolute(rel) ||
    rel.includes("\\") ||
    rel.split("/").includes("..")
  )
    throw Error("invalid public task path");
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + "/")) throw Error("path escape");
  return full;
}
async function handle(r) {
  if (r.op === "seed") {
    if (seeded) throw Error("already seeded");
    seeded = true;
    const root = "/case/work/" + r.task.id;
    fs.mkdirSync(root, { recursive: true });
    for (const [rel, text] of Object.entries(r.task.files)) {
      const file = safe(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    fs.writeFileSync(
      "/case/config.json",
      JSON.stringify({
        envs: { evaluation: {} },
        tools: { profile: "lean-find" },
        tests: {
          waitMs: 50,
          timeoutMs: 30000,
          compileCheck: false,
          node: process.execPath,
        },
      }),
    );
    fs.mkdirSync("/case/cache/work", { recursive: true });
    fs.writeFileSync(
      "/case/cache/work/" + r.task.id + ".json",
      JSON.stringify({
        id: r.task.id,
        path: root,
        project: "EVAL",
        repo: r.task.id,
        sha: r.revision,
        createdAt: new Date().toISOString(),
        dirty: true,
      }),
    );
    return { seeded: true };
  }
  if (!seeded) throw Error("not seeded");
  if (r.op === "read") {
    const full = safe("/case/work/" + r.workspace, r.path);
    if (fs.statSync(full).size > 2097152) throw Error("file exceeds 2 MiB");
    return { text: fs.readFileSync(full, "utf8") };
  }
  if (r.op === "snapshot")
    return require("../lib/evaluation-evidence").snapshot(
      "/case/work/" + r.workspace,
    );
  if (r.op === "schemas")
    return require("../lib/tools").schemas({
      profile: r.profile || "lean-find",
    });
  if (r.op === "tool") return require("../lib/tools").call(r.name, r.arguments);
  if (r.op === "probe") {
    const root = "/case/work/" + r.workspace,
      module = safe(root, r.module),
      scratch = fs.mkdtempSync("/tmp/dt-probe-");
    try {
      const input = path.join(scratch, "input.json"),
        output = path.join(scratch, "output.json");
      fs.writeFileSync(
        input,
        JSON.stringify({ module, export: r.export, args: r.args }),
      );
      const result = await require("../lib/testrun").execLocal(
        process.execPath,
        ["/opt/dt/lib/differential-worker.js", input, output],
        {
          cwd: root,
          env: { PATH: process.env.PATH, HOME: "/tmp", TMPDIR: "/tmp" },
          timeoutMs: Math.min(r.timeoutMs || 5000, 30000),
        },
      );
      if (result.code !== 0 || result.killed || !fs.existsSync(output))
        throw Error("hidden input probe failed");
      if (fs.statSync(output).size > 1048576)
        throw Error("probe response too large");
      return JSON.parse(fs.readFileSync(output, "utf8"));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  throw Error("unsupported RPC operation");
}
let pending = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  pending = pending.then(async () => {
    let r;
    try {
      r = JSON.parse(line);
      const value = await handle(r);
      const output = JSON.stringify(value);
      process.stdout.write(
        JSON.stringify({
          id: r.id,
          result:
            Buffer.byteLength(output) > 262144
              ? {
                  error: "tool output budget exceeded",
                  code: "DT_EVAL_OUTPUT_BUDGET",
                }
              : value,
        }) + "\n",
      );
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          id: r?.id,
          error: { message: e.message, code: e.code || "DT_EVAL_WORKER" },
        }) + "\n",
      );
    }
  });
});
