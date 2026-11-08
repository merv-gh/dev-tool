// One click-through composer over the real authorized registry and owned jobs.
const wb = {
  data: null,
  scope: null,
  tool: null,
  args: {},
  intent: null,
  drafts: new Map(),
  runs: [],
  selected: null,
  facts: [],
  request: 0,
  linkRequest: 0,
  loadedLink: null,
  poll: 0,
  timer: null,
  form: null,
  helpController: null,
  loading: null,
};
const wbLife = DTState.create(
  DTState.define("UI.workbench", "idle", {
    idle: ["loading"],
    loading: ["ready", "failed", "idle"],
    ready: ["loading", "starting", "idle"],
    starting: ["running", "ready", "failed", "idle"],
    running: ["cancelling", "ready", "failed", "idle"],
    cancelling: ["ready", "failed", "idle"],
    failed: ["loading", "starting", "ready", "idle"],
  }),
);
const wbScope = () => adminRequestScope() + "|" + (env() || wb.data?.env || "");
const wbActive = () => wbLife.is("starting", "running", "cancelling");
const wbText = (tag, text, className) => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
};
function wbButton(label, fn, className) {
  const b = wbText("button", label, className);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function wbMessage(text, error = false) {
  $("wbStatus").textContent = text;
  $("wbStatus").className = error ? "wb-status err-text" : "wb-status hint";
}
function wbDefaults(t) {
  const out = {};
  for (const [key, s] of Object.entries(t.inputSchema.properties || {})) {
    if (s.default !== undefined) out[key] = structuredClone(s.default);
    else if ((t.inputSchema.required || []).includes(key))
      out[key] = dtToolForm.initial(s);
  }
  if (t.inputSchema.properties.env?.default !== undefined)
    out.env = env() || wb.data?.env;
  return out;
}
function wbKnownValues() {
  const values = [...wb.facts];
  for (const run of wb.runs.slice(0, 6))
    for (const fact of wbFacts(run.result?.result))
      if (
        !values.some(
          (v) => JSON.stringify(v.value) === JSON.stringify(fact.value),
        )
      )
        values.push(fact);
  return values.slice(0, 160);
}
window.dtToolChoices = async function (a) {
  const tool = a.tool || wb.tool?.name;
  if (!tool)
    return {
      source: "recent",
      choices: [],
      gaps: ["Choose a concrete tool to browse indexed values."],
    };
  const { schema, ...request } = a;
  const response = await api("/api/admin/workbench/choices", {
    ...request,
    tool,
    env: a.arguments?.env || env() || wb.data?.env,
  });
  if (response.source === "recent") {
    const words = (a.query || "").toLowerCase();
    response.choices = wbKnownValues()
      .filter(
        (f) =>
          String(f.value).toLowerCase().includes(words) &&
          ["string", "number", "boolean"].includes(typeof f.value),
      )
      .slice(0, 40)
      .map((f) => ({
        value: f.value,
        label: String(f.value),
        prefix: "Evidence",
        detail: f.path,
      }));
    if (response.choices.length) response.gaps = [];
  }
  return response;
};
function wbEnsure() {
  if ($("wbRoot").dataset.ready) return;
  $("wbRoot").dataset.ready = "1";
  $("wbRoot").innerHTML = `
 <div class="wb-toolbar"><label for="wbContext">Save evidence to task</label><select id="wbContext"><option value="">Session only</option></select><button id="wbNewTask" type="button">New investigation</button><button id="wbResume" type="button">Refresh choices</button><a href="/admin#handbook?chapter=start" id="wbGuide">How to investigate</a><span id="wbContextStatus" class="hint" role="status"></span><button id="wbContextRetry" type="button" hidden>Retry task folders</button></div>
 <div class="wb-layout"><aside class="wb-intents"><div class="wb-rail-title"><h3>What do you want to do?</h3><button id="wbAllTools" type="button">All tools</button></div><p class="hint">Browse a goal. Every action starts as an editable draft.</p><nav id="wbIntentTree" aria-label="Investigation intent tree"></nav><div class="wb-history"><h3>Runs in this session</h3><div id="wbHistory"><p class="hint">Run a prepared action to keep evidence here.</p></div></div></aside>
 <div class="wb-work"><div id="wbIntentHeading"><h3>Choose a starting point</h3><p>Inspect a service, find data, investigate a symptom, or browse every enabled tool.</p></div><div id="wbCatalog" class="wb-catalog" hidden></div><div id="wbStages" class="wb-stages"></div><div id="wbCandidates" class="wb-candidates"></div>
 <div class="wb-compose"><div class="wb-tool-heading"><h3>Prepare an action</h3><span id="wbPrepared" class="hint">Nothing executes until you choose Run.</span></div><div class="wb-tool-picker"><label for="wbToolGroup">Tool group</label><select id="wbToolGroup"><option value="">Every group</option></select><label for="wbTool">Tool</label><input id="wbTool" placeholder="Browse or search enabled tools" autocomplete="off"></div><p id="wbDescription" class="wb-description"></p><div id="wbFields"></div><details id="wbExact"><summary>Exact arguments and full contract</summary><label for="wbArgs">Editable arguments (JSON)</label><textarea id="wbArgs" rows="8" spellcheck="false">{}</textarea><pre id="wbContract" class="code cx-wrap"></pre><div class="row"><button id="wbApplyJson" type="button">Apply JSON to form</button><button id="wbReset" type="button">Reset this draft</button><button id="wbCopyArgs" type="button">Copy arguments</button></div></details>
 <div class="wb-runbar"><button id="wbRun" type="button" class="primary" disabled>Run action</button><button id="wbCancel" type="button" hidden>Cancel run</button><button id="wbViewEvidence" type="button" hidden>View evidence</button><a id="wbExecution" hidden target="_blank" rel="noopener">Open execution</a><span id="wbElapsed" class="hint"></span></div><p id="wbStatus" class="wb-status hint" role="status" aria-live="polite">Choose an intent or browse the tool selector.</p></div>
 <div class="wb-assistance"><div class="wb-assistance-heading"><h3>Help with the next decision</h3><span id="wbModelCaption" class="hint"></span></div><label for="wbGoal">Question or investigation note</label><textarea id="wbGoal" rows="2" placeholder="Optional: describe expected and actual behavior"></textarea><div class="row"><button id="wbSuggest" type="button">Suggest next action</button><button id="wbInterpret" type="button" disabled>Interpret this result</button><button id="wbCancelHelp" type="button" hidden>Cancel model help</button><label class="wb-check"><input type="checkbox" id="wbAutoHelp"> Interpret completed runs automatically</label></div><p class="hint">Model help sends the selected question and bounded, redacted evidence to your configured model. Suggestions remain editable and never run automatically.</p><div id="wbHelp" aria-live="polite"></div></div>
 <section id="wbEvidence" class="wb-evidence" hidden><div class="wb-evidence-heading"><div><h3 id="wbResultTitle">Evidence</h3><p id="wbResultMeta" class="hint"></p></div><div class="row"><a id="wbOpenResult" target="_blank" rel="noopener" hidden>Open full result</a><button id="wbShare" type="button">Copy run link</button><button id="wbExport" type="button">Download recipe</button><button id="wbAgain" type="button">Prepare again</button></div></div><div id="wbOutcome" class="wb-outcome" role="status"></div><p id="wbPreviewStatus" class="hint" role="status" hidden>Loading native preview… Open full result if it cannot be displayed here.</p><iframe id="wbNative" title="Workbench native tool result" sandbox="allow-scripts allow-popups allow-downloads" hidden></iframe><details id="wbValues" open><summary>Use evidence in another action</summary><p class="hint">Choose a value to carry forward. Preparing an action preserves its exact identifiers.</p><div id="wbFacts" class="wb-facts"></div><div id="wbSelectedFacts" class="wb-selected-facts"></div><div id="wbFollowups" class="wb-followups"></div></details><details><summary>Invocation, source and complete preview</summary><pre id="wbResultRaw" class="code cx-wrap"></pre></details></section>
 </div></div>`;
  $("wbHelp").closest(".wb-assistance").before($("wbEvidence"));
  $("wbViewEvidence").onclick = () => wbReveal("wbEvidence");
  $("wbContextRetry").onclick = wbContexts;
  $("wbRun").onclick = wbRun;
  $("wbCancel").onclick = wbCancel;
  $("wbAllTools").onclick = () => {
    $("wbToolGroup").value = "";
    $("wbTool")._dtCombo.open("");
  };
  $("wbResume").onclick = () => loadWorkbench(true);
  $("wbToolGroup").onchange = () => {
    $("wbTool")._dtCombo.open("");
  };
  dtCombo.attach($("wbTool"), {
    label: "enabled tools",
    prefix: "Tool",
    epoch: wbScope,
    load: async ({ query, cursor }) => {
      const all = (wb.data?.tools || []).filter(
          (t) =>
            (!$("wbToolGroup").value || t.group === $("wbToolGroup").value) &&
            (t.name + " " + t.description)
              .toLowerCase()
              .includes(query.toLowerCase()),
        ),
        offset = Number(cursor || 0);
      return {
        source: "authorized registry",
        choices: all.slice(offset, offset + 40).map((t) => ({
          value: t.name,
          label: t.name,
          prefix: t.group,
          detail: t.description.slice(0, 180),
        })),
        nextCursor: offset + 40 < all.length ? String(offset + 40) : null,
      };
    },
    onPick: (c) => wbPrepare(c.value),
  });
  $("wbApplyJson").onclick = () => {
    try {
      const value = JSON.parse($("wbArgs").value);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Arguments must be an object.");
      wb.args = value;
      wbForm();
      wbMessage("JSON applied to the editable form.");
    } catch (e) {
      wbMessage(e.message, true);
    }
  };
  $("wbArgs").oninput = () => {
    wb.jsonDirty = true;
    wbMessage(
      "Apply JSON to the form before running. The visible fields still contain the previous draft.",
    );
    $("wbRun").disabled = true;
  };
  $("wbReset").onclick = () => {
    if (wb.tool) wbPrepare(wb.tool.name, wbDefaults(wb.tool));
  };
  $("wbCopyArgs").onclick = () =>
    copy(JSON.stringify(wb.args, null, 2), "tool arguments");
  $("wbNewTask").onclick = async () => {
    try {
      const r = (
        await api("/api/tool/context_open", {
          id:
            "workbench-" +
            Date.now().toString(36) +
            "-" +
            crypto.randomUUID().slice(0, 8),
          title: wb.intent?.title || "Workbench investigation",
          summary:
            $("wbGoal").value || wb.intent?.goal || "Interactive investigation",
          tasks: [runtimeStory || "default"],
        })
      ).result;
      const context = r.contexts?.[0] || r;
      if (!context.id)
        throw Error(
          "Choose an existing matching context from Context before attaching it.",
        );
      await wbContexts();
      $("wbContext").value = context.id;
      wbMessage("New evidence will be saved to " + context.title + ".");
    } catch (e) {
      wbMessage(e.message, true);
    }
  };
  $("wbSuggest").onclick = () => wbHelp("suggest");
  $("wbInterpret").onclick = () => wbHelp("interpret");
  $("wbCancelHelp").onclick = () => wb.helpController?.abort();
  $("wbShare").onclick = () => {
    if (wb.selected)
      copy(
        location.origin +
          "/admin#workbench?" +
          new URLSearchParams({
            ...(wb.selected.evidenceId
              ? { result: wb.selected.evidenceId }
              : { job: wb.selected.id }),
            env: wb.selected.result?.env || env(),
            story: runtimeStory || "default",
          }),
        "owned run link",
      );
  };
  $("wbExport").onclick = () => {
    if (wb.selected)
      download(
        "dt-investigation.json",
        JSON.stringify(
          {
            protocol: "dt.workbench-recipe/v1",
            sourceJob: wb.selected.id,
            tool: wb.selected.result?.tool,
            arguments: wb.selected.result?.arguments,
            env: wb.selected.result?.env,
            recordView: wb.selected.result?.recordView,
            expectedOutcome: "Define independent expectations before replay.",
            executionPerformed: false,
          },
          null,
          2,
        ),
        "application/json",
      );
  };
  $("wbAgain").onclick = () => {
    if (wb.selected?.result)
      wbPrepare(wb.selected.result.tool, wb.selected.result.arguments);
  };
  $("wbNative").addEventListener("load", () => {
    $("wbPreviewStatus").hidden = true;
  });
}
async function wbContexts() {
  try {
    const r = (await api("/api/tool/context_find", { limit: 100 })).result,
      selected = $("wbContext").value;
    $("wbContext").replaceChildren(new Option("Session only", ""));
    for (const c of r.contexts) $("wbContext").add(new Option(c.title, c.id));
    $("wbContext").value = selected;
    $("wbContext").disabled = false;
    $("wbNewTask").disabled = !wb.data.tools.some(
      (t) => t.name === "context_open",
    );
    $("wbContextRetry").hidden = true;
    $("wbContextStatus").textContent = "";
  } catch (e) {
    $("wbNewTask").disabled = true;
    $("wbContext").disabled = true;
    $("wbContextStatus").textContent =
      e.message + " Task capture is unavailable; session runs still work.";
    $("wbContextRetry").hidden = false;
  }
}
async function loadWorkbench(force = false) {
  if (force && wbActive()) {
    wbMessage("Wait for this run or cancel it before refreshing choices.");
    return;
  }
  wbEnsure();
  const linkedEnv = new URLSearchParams(location.hash.split("?")[1] || "").get(
    "env",
  );
  if (
    wb.data &&
    linkedEnv &&
    linkedEnv !== (env() || wb.data.env) &&
    wb.data.envs.includes(linkedEnv)
  ) {
    if (wbActive()) {
      wbMessage(
        "Wait for this run or cancel it before opening another environment.",
      );
      return;
    }
    $("env").value = linkedEnv;
    clearWorkbench();
  }
  const scope = adminRequestScope(),
    selectedEnv = linkedEnv || env();
  if (wb.data && wb.scope === wbScope() && !force) {
    try {
      await wbOpenLinked();
    } catch (e) {
      wbMessage(e.message, true);
    }
    return;
  }
  if (wb.loading) return wb.loading;
  const request = ++wb.request;
  if (!wbLife.is("loading")) wbLife.to("loading");
  wbMessage("Loading authorized tools and cached intent choices…");
  wb.loading = (async () => {
    try {
      const data = await api(
        "/api/admin/workbench" +
          (selectedEnv ? "?env=" + encodeURIComponent(selectedEnv) : ""),
      );
      if (request !== wb.request || scope !== adminRequestScope()) return;
      wb.data = data;
      if (linkedEnv && [...$("env").options].some((o) => o.value === linkedEnv))
        $("env").value = linkedEnv;
      wb.scope = wbScope();
      wbLife.to("ready");
      wbTree();
      const prior = $("wbToolGroup").value;
      $("wbToolGroup").replaceChildren(new Option("Every group", ""));
      for (const group of [
        ...new Set(data.tools.map((t) => t.group || "other")),
      ].sort())
        $("wbToolGroup").add(new Option(group, group));
      $("wbToolGroup").value = prior;
      $("wbModelCaption").textContent = !data.model.allowed
        ? "Model help unavailable for this credential"
        : data.model.configured
          ? data.model.model
          : "No model configured";
      $("wbSuggest").disabled = !data.model.allowed;
      $("wbAutoHelp").disabled = !data.model.configured || !data.model.allowed;
      wbCatalog();
      await wbContexts();
      await wbOpenLinked();
      if (!wb.tool) {
        const first = data.groups[0]?.intents[0];
        if (first) wbIntent(first.id);
      }
      if(!wb.loadedLink)wbMessage("Choose indexed values, then Run. Model help is optional.");
    } catch (e) {
      if (request === wb.request) {
        if (!wbLife.is("failed")) wbLife.to("failed");
        wbMessage(e.message + " Refresh choices to retry.", true);
      }
    } finally {
      wb.loading = null;
    }
  })();
  return wb.loading;
}
async function wbOpenLinked() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  // Evidence views can link to an editable, scope-authorized source-reading draft.
  // A URL never executes a tool or changes the selected principal/story.
  if (params.has('tool')) {
    const key='draft:'+params.toString();if(key===wb.loadedLink)return;
    if(wbActive()){wbMessage('Wait for this run or cancel it before opening a tool draft.');return;}
    try {
      const text=params.get('args')||'{}';if(text.length>20000)throw Error('Linked argument draft is too large');
      const args=JSON.parse(text);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Linked arguments must be an object');
      if(!wb.data?.tools.some(t=>t.name===params.get('tool')))throw Error('Linked tool is unavailable for the current scope');
      wbPrepare(params.get('tool'),args);wb.loadedLink=key;wbMessage('Source-reading draft prepared. Review the exact revision and arguments, then choose Run.');
    }catch(error){wbMessage(error.message,true);}
    return;
  }
  const
    kind = params.has("job") ? "job" : params.has("result") ? "result" : null;
  const key = kind ? kind + ":" + params.get(kind) : "";
  if (!key || key === wb.loadedLink) return;
  if (wbActive()) {
    wbMessage("Wait for this run or cancel it before opening another run.");
    return;
  }
  const scope = wbScope(),
    ticket = ++wb.linkRequest;
  const run = await api(
    "/api/admin/workbench/" +
      (kind === "job" ? "run/" : "evidence/") +
      encodeURIComponent(params.get(kind)),
  );
  if (scope !== wbScope() || ticket !== wb.linkRequest) return;
  wb.loadedLink = key;
  wbRemember(run);
  if (run.result?.tool) wbPrepare(run.result.tool, run.result.arguments);
  if (run.state === "running") {
    wb.currentJob = run.id;
    wbLife.to("starting");
    wbLife.to("running");
    $("wbCancel").hidden = false;
    $("wbExecution").hidden = false;
    $("wbExecution").href = run.executionView;
    wbPoll(run.id);
  } else {
    wbShowRun(run);
    wbReveal("wbEvidence");
  }
}
function wbReveal(id) {
  const root = $(id);
  root.tabIndex = -1;
  root.scrollIntoView({ block: "start", behavior: "auto" });
  root.focus({ preventScroll: true });
}
function wbCatalog() {
  const root = $("wbCatalog");
  root.replaceChildren();
  root.hidden = !!wb.data.catalog.generation;
  if (root.hidden) return;
  root.append(
    wbText(
      "p",
      wb.data.catalog.catalog
        ? "Browsing a legacy catalog. Build a versioned index for stable choice pages."
        : "The searchable catalog has not been built. Prepare it from retained source metadata to browse service and data names.",
    ),
  );
  if (wb.data.tools.some((t) => t.name === "catalog_sync"))
    root.append(
      wbButton("Prepare cached index", () =>
        wbPrepare("catalog_sync", { env: env() || wb.data.env, what: "index" }),
      ),
    );
  else
    root.append(
      wbText(
        "p",
        "Ask an administrator to refresh the cached index. Exact names can still be entered.",
        "hint",
      ),
    );
}
function wbTree() {
  const root = $("wbIntentTree");
  root.replaceChildren();
  for (const group of wb.data.groups) {
    const details = document.createElement("details");
    details.open = group.intents.some(
      (i) => i.id === (wb.intent?.id || "service-boundaries"),
    );
    const summary = wbText("summary", group.title);
    details.append(summary, wbText("p", group.description, "hint"));
    for (const intent of group.intents) {
      const b = wbButton(intent.title, () => wbIntent(intent.id));
      b.dataset.wbIntent = intent.id;
      b.setAttribute("aria-pressed", String(intent.id === wb.intent?.id));
      details.append(b);
    }
    root.append(details);
  }
}
function wbIntent(id) {
  if (wbActive()) {
    wbMessage(
      "Wait for this run or cancel it before preparing another action.",
    );
    return;
  }
  const intent = wb.data.groups
    .flatMap((g) => g.intents)
    .find((i) => i.id === id);
  if (!intent) return;
  const previousGoal = wb.intent?.goal;
  wb.intent = intent;
  wbTree();
  $("wbIntentHeading").replaceChildren(
    wbText("h3", intent.title),
    wbText("p", intent.goal),
  );
  if (!$("wbGoal").value || $("wbGoal").value === previousGoal)
    $("wbGoal").value = intent.goal;
  wbStages(intent);
  $("wbCandidates").replaceChildren();
  for (const name of intent.tools) {
    const t = wb.data.tools.find((t) => t.name === name);
    if (!t) continue;
    const b = wbButton(
      wbLabel(t.name),
      () => wbPrepare(t.name, wbSeed(t)),
      "wb-candidate",
    );
    b.append(wbText("small", t.name));
    $("wbCandidates").append(b);
  }
  wbPrepare(
    intent.tools[0],
    wbSeed(wb.data.tools.find((t) => t.name === intent.tools[0])),
  );
}
function wbLabel(name) {
  return (
    {
      passport: "Inspect service passport",
      architecture_service: "Collect architecture evidence",
      pg_table: "Inspect table",
      pg_usage: "Find readers and writers",
      pg_query: "Prepare a SQL query",
      catalog_search: "Browse indexed objects",
      code_search: "Search source code",
      code_read: "Read exact source",
      semantic_query: "Trace semantic evidence",
      scenario_inventory: "Inspect entry points and effects",
      health: "Check service health",
      map: "Explore service map",
      context_find: "Find previous work",
      test_run: "Run selected tests",
      files_archive: "Archive selected files",
    }[name] || name.replaceAll("_", " ")
  );
}
function wbStages(intent) {
  const root = $("wbStages");
  root.replaceChildren();
  const guide = wb.data.guides.find((g) => g.id === intent.guide);
  if (!guide) return;
  const details = document.createElement("details"),
    summary = wbText(
      "summary",
      "Guided workflow · " + guide.stages.length + " stages",
    );
  details.append(summary);
  for (const stage of guide.stages) {
    const row = document.createElement("div");
    row.className = "wb-stage";
    row.append(wbText("strong", stage.goal));
    for (const name of stage.tools)
      row.append(
        wbButton(wbLabel(name), () =>
          wbPrepare(name, wbSeed(wb.data.tools.find((t) => t.name === name))),
        ),
      );
    details.append(row);
  }
  for (const boundary of guide.boundaries)
    details.append(wbText("p", boundary, "hint"));
  root.append(details);
}
function wbSeed(t) {
  if (!t) return {};
  const out = wbDefaults(t),
    facts = wb.facts.length
      ? wb.facts
      : wb.selected
        ? wbFacts(wb.selected.result?.result).filter((f) =>
            [
              "service",
              "repo",
              "workspace",
              "db",
              "store",
              "table",
              "object",
              "topic",
              "index",
              "site",
            ].includes(f.name),
          )
        : [];
  for (const [key, s] of Object.entries(t.inputSchema.properties)) {
    const match = facts.find(
      (f) =>
        f.name === key ||
        (["name", "object", "table"].includes(key) &&
          ["table", "object"].includes(f.name)),
    );
    if (
      match &&
      []
        .concat(s.type || [])
        .some(
          (kind) =>
            kind === typeof match.value ||
            (kind === "integer" && Number.isInteger(match.value)),
        )
    )
      out[key] = match.value;
  }
  for (const key of ["service", "repo", "workspace", "db", "store"])
    if (
      wb.selected?.result?.arguments?.[key] !== undefined &&
      key in t.inputSchema.properties &&
      (out[key] === undefined || out[key] === "")
    )
      out[key] = wb.selected.result.arguments[key];
  return out;
}
function wbPrepare(name, args) {
  if (wbActive()) {
    wbMessage(
      "Wait for this run or cancel it before preparing another action.",
    );
    return;
  }
  const t = wb.data?.tools.find((t) => t.name === name);
  if (!t) {
    wbMessage("This tool is unavailable for the current scope.", true);
    return;
  }
  if (wb.tool) wb.drafts.set(wb.tool.name, structuredClone(wb.args));
  while (wb.drafts.size > 30) wb.drafts.delete(wb.drafts.keys().next().value);
  wb.tool = t;
  wb.args = structuredClone(args || wb.drafts.get(name) || wbDefaults(t));
  $("wbTool").value = name;
  $("wbDescription").textContent = t.description;
  $("wbContract").textContent = JSON.stringify(t.inputSchema, null, 2);
  $("wbPrepared").textContent = "Prepared only · " + (t.group || "tool");
  $("wbRun").textContent = "Run " + name;
  wbForm();
  if (document.activeElement && document.activeElement !== document.body)
    wbReveal("wbFields");
}
function wbForm() {
  if (!wb.tool) return;
  wb.jsonDirty = false;
  $("wbArgs").value = JSON.stringify(wb.args, null, 2);
  wb.form = dtToolForm.mount(
    $("wbFields"),
    wb.tool.inputSchema,
    wb.args,
    (args) => {
      wb.args = args;
      $("wbArgs").value = JSON.stringify(args, null, 2);
      wbValidate();
    },
    {
      tool: wb.tool.name,
      secondary:
        wb.tool.name === "passport"
          ? ["repo", "ref", "refresh", "libraries", "graph", "job"]
          : [],
      epoch: wbScope,
      onChoice: (item, path, args) => {
        wb.facts = [
          ...(item.facts
            ? Object.entries(item.facts).map(([name, value]) => ({
                name,
                value,
                path: "Indexed " + item.label,
              }))
            : []),
          ...wb.facts,
        ].slice(0, 50);
        wbValidate();
      },
      syntax: wbSyntax,
    },
  );
  wbValidate();
}
function wbValidate() {
  if (!wb.tool) return;
  const missing = (wb.tool.inputSchema.required || []).filter(
    (k) => wb.args[k] === undefined || wb.args[k] === "",
  );
  const invalid = wb.form?.errors() || [];
  $("wbRun").disabled =
    wbActive() || wb.jsonDirty || missing.length > 0 || invalid.length > 0;
  $("wbPrepared").textContent = missing.length
    ? "Choose " + missing.join(", ")
    : invalid.length
      ? invalid[0]
      : "Prepared only · review arguments and intended effects";
}
function wbSyntax(bar, input, name, args) {
  if (name === "sql") {
    const pick = document.createElement("input");
    pick.placeholder = "Browse indexed tables";
    pick.setAttribute("aria-label", "SQL table");
    bar.append(pick);
    let chosen = null;
    pick.addEventListener("input", () => {
      chosen = null;
    });
    const selected = () => {
      if (chosen && args().db && chosen.facts?.db !== args().db) chosen = null;
      return chosen;
    };
    dtCombo.attach(pick, {
      label: "SQL tables",
      prefix: "Table",
      epoch: wbScope,
      load: (page) =>
        dtToolChoices({
          tool: wb.tool.name,
          field: "sql",
          arguments: {
            env: args().env,
            ...(args().db ? { db: args().db } : {}),
          },
          ...page,
        }),
      onPick: (item) => {
        chosen = item;
      },
    });
    const quote = (s) => '"' + String(s).replaceAll('"', '""') + '"';
    bar.append(
      wbButton("Preview 20 rows", () => {
        if (!selected()) {
          pick._dtCombo.open("");
          return;
        }
        const table = chosen.facts?.table || chosen.label,
          parts = table.split(".");
        input.value =
          "SELECT * FROM " + parts.map(quote).join(".") + " LIMIT 20";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (chosen.facts?.db) wb.form.set(["db"], chosen.facts.db);
        wbValidate();
      }),
      wbButton("Count rows", () => {
        if (!selected()) {
          pick._dtCombo.open("");
          return;
        }
        input.value =
          "SELECT count(*) FROM " +
          (chosen.facts?.table || chosen.label).split(".").map(quote).join(".");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (chosen.facts?.db) wb.form.set(["db"], chosen.facts.db);
      }),
    );
  } else {
    const pick = document.createElement("input");
    pick.placeholder = "Insert an enabled tool call";
    pick.setAttribute("aria-label", "Code tool completion");
    bar.append(pick);
    dtCombo.attach(pick, {
      label: "code tool calls",
      prefix: "Tool",
      epoch: wbScope,
      load: async ({ query }) => ({
        source: "registry",
        choices: (wb.data?.tools || [])
          .filter((t) => t.name.includes(query))
          .slice(0, 50)
          .map((t) => ({
            value: t.name,
            label: t.name,
            detail: t.description.slice(0, 120),
          })),
      }),
      onPick: (item) => {
        const t = wb.data.tools.find((t) => t.name === item.value),
          snippet =
            "const result = await tools.call(" +
            JSON.stringify(item.value) +
            ", " +
            JSON.stringify(wbDefaults(t), null, 2) +
            ");\ntext(result);";
        input.focus();
        input.setRangeText(
          snippet,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
    });
  }
}
async function wbRun() {
  if (wbActive() || !wb.tool) return;
  const scope = wbScope();
  wbLife.to("starting");
  wbValidate();
  wbMessage("Submitting " + wb.tool.name + "…");
  $("wbRun").disabled = true;
  try {
    const result = await api("/api/admin/workbench/run", {
      tool: wb.tool.name,
      arguments: wb.args,
      env: env() || wb.data.env,
      context: $("wbContext").value || undefined,
      goal: $("wbGoal").value,
    });
    if (scope !== wbScope()) return;
    wbLife.to("running");
    wb.currentJob = result.job;
    $("wbCancel").hidden = false;
    $("wbExecution").hidden = false;
    $("wbExecution").href =
      "/admin#runtime?" +
      new URLSearchParams({
        execution: result.executionId,
        story: runtimeStory || "default",
      });
    wbPoll(result.job);
  } catch (e) {
    if (scope === wbScope()) {
      wbLife.to("ready");
      wbValidate();
      wbMessage(
        e.message +
          " Your draft is preserved. Check Runtime before retrying: the server may already have accepted the run.",
        true,
      );
    }
  }
}
async function wbPoll(id) {
  clearTimeout(wb.timer);
  const ticket = ++wb.poll,
    scope = wbScope();
  try {
    const run = await api("/api/admin/workbench/run/" + encodeURIComponent(id));
    if (ticket !== wb.poll || scope !== wbScope()) return;
    wb.currentJob = id;
    $("wbElapsed").textContent =
      run.ms !== undefined
        ? run.ms + " ms"
        : "Started " + new Date(run.startedAt).toLocaleTimeString();
    if (
      run.state === "running" ||
      ["cancelling", "draining"].includes(run.cleanup?.state)
    ) {
      wbMessage(
        (wbLife.is("cancelling")
          ? "Cancellation requested"
          : "Running " + (wb.tool?.name || "action")) +
          (run.log?.at(-1) ? " · " + run.log.at(-1) : ""),
      );
      wb.timer = setTimeout(() => wbPoll(id), 650);
      return;
    }
    wbLife.to("ready");
    $("wbCancel").hidden = true;
    wbRemember(run);
    wbShowRun(run);
    wbValidate();
    if (run.result?.tool === "catalog_sync" && run.result.ok) {
      wb.data.catalog = (
        await api(
          "/api/admin/workbench?env=" +
            encodeURIComponent(env() || wb.data.env),
        )
      ).catalog;
      wbCatalog();
    }
    const params = new URLSearchParams({
      job: run.id,
      env: run.result?.env || env(),
      story: runtimeStory || "default",
    });
    if (tab === "workbench")
      history.replaceState(null, "", "#workbench?" + params);
    wb.loadedLink = "job:" + run.id;
    if ($("wbAutoHelp").checked && run.result) wbHelp("interpret");
  } catch (e) {
    if (scope === wbScope()) {
      wbLife.to("failed");
      wbValidate();
      wbMessage(
        e.message +
          " Use Open execution to inspect the outcome before trying again.",
        true,
      );
      $("wbCancel").hidden = true;
    }
  }
}
async function wbCancel() {
  if (!wb.currentJob) return;
  wbLife.to("cancelling");
  $("wbCancel").disabled = true;
  try {
    await api(
      "/api/admin/job/" + encodeURIComponent(wb.currentJob) + "/cancel",
      {},
    );
    wbMessage("Cancellation requested. Waiting for owned resources to settle.");
    wbPoll(wb.currentJob);
  } catch (e) {
    wbMessage(e.message, true);
  } finally {
    $("wbCancel").disabled = false;
  }
}
function wbRemember(run) {
  wb.runs = [run, ...wb.runs.filter((r) => r.id !== run.id)].slice(0, 20);
  $("wbHistory").replaceChildren();
  for (const item of wb.runs) {
    const b = wbButton(
      item.title || item.result?.tool || "Tool run",
      () => {
        wbShowRun(item);
        wbReveal("wbEvidence");
      },
      "wb-history-run",
    );
    b.append(wbText("small", [item.state, item.ms + " ms"].join(" · ")));
    $("wbHistory").append(b);
  }
}
function wbFacts(value) {
  const out = [];
  let visited = 0;
  function walk(v, path = [], depth = 0) {
    if (++visited > 1600 || depth > 7 || out.length >= 90) return;
    if (v && typeof v === "object") {
      if (path.at(-1) === "tables" && !Array.isArray(v)) {
        for (const table of Object.keys(v).slice(0, 30))
          out.push({ name: "table", value: table, path: path.join(".") });
      }
      if (typeof v.project === "string" && typeof v.repo === "string")
        out.push({
          name: "repo",
          value: v.project + "/" + v.repo,
          path: path.join("."),
        });
      for (const [k, x] of Object.entries(v).slice(0, 100)) {
        if (k === "repo" && typeof v.project === "string") continue;
        if (k === "entries" && Array.isArray(x) && typeof v.path === "string") {
          x.slice(0, 100).forEach((entry, i) =>
            walk(
              typeof entry === "string"
                ? (v.path ? v.path.replace(/\/$/, "") + "/" : "") + entry
                : entry,
              [...path, k, String(i)],
              depth + 1,
            ),
          );
          continue;
        }
        if (
          /password|secret|token|authorization|cookie|content|body|text|code/i.test(
            k,
          )
        )
          continue;
        walk(x, [...path, k], depth + 1);
      }
      return;
    }
    if (
      !["string", "number", "boolean"].includes(typeof v) ||
      String(v).length > 300 ||
      v === ""
    )
      return;
    const name = /^\d+$/.test(path.at(-1))
      ? {
          tables: "table",
          topics: "topic",
          consumes: "topic",
          produces: "topic",
          repositories: "repo",
          entries: "path",
        }[path.at(-2)] || path.at(-2)
      : path.at(-1);
    if (name === "line" && typeof v === "string") {
      const m = v.match(/^(pg|pgfn) (\S+) (.+?)(?:\s+~|\s+\[|\()/);
      if (m) {
        out.push({
          name: "object",
          value: m[2] + ":" + m[3],
          path: path.join("."),
        });
        out.push({ name: "db", value: m[2], path: path.join(".") });
        return;
      }
      const service = v.match(/^svc (\S+)/);
      if (service) {
        out.push({ name: "service", value: service[1], path: path.join(".") });
        return;
      }
    }
    out.push({ name, value: v, path: path.join(".") });
  }
  walk(value);
  return out;
}
function wbShowRun(run) {
  wb.selected = run;
  const r = run.result;
  $("wbEvidence").hidden = false;
  $("wbViewEvidence").hidden = false;
  $("wbResultTitle").textContent =
    (r?.tool || run.title || "Run") + " · " + run.state;
  $("wbResultMeta").textContent = [
    r?.env || env(),
    new Date(run.startedAt).toLocaleString(),
    run.ms === undefined ? "Retained evidence" : run.ms + " ms",
    r?.saved ? "Saved to " + r.saved : "Session evidence",
  ].join(" · ");
  $("wbOutcome").textContent =
    run.state === "saved"
      ? "Retained result opened. No action was replayed. Inspect its source and freshness before using it."
      : run.state === "cancelled"
        ? "Cancelled. Check cleanup and external outcomes before repeating an action."
        : !r
          ? "Run failed: " + run.error
          : r.ok === false
            ? "Tool failed: " +
              (r.error?.message || "Inspect the complete preview")
            : r.saveError
              ? "Tool completed; saving evidence failed: " +
                r.saveError +
                ". Do not rerun solely to save it."
              : "Tool invocation completed. Inspect the application verdict and evidence gaps before drawing a conclusion.";
  $("wbResultRaw").textContent = JSON.stringify(r || run, null, 2);
  $("wbAgain").hidden = !r?.tool;
  const view = rtNativeView(r?.result?.view || r?.recordView);
  $("wbNative").hidden = !view;
  $("wbPreviewStatus").hidden = !view;
  if (view) $("wbNative").src = view;
  else $("wbNative").removeAttribute("src");
  $("wbOpenResult").hidden = !view;
  if (view) $("wbOpenResult").href = view.replace(/[?&]embed=1/, "");
  $("wbInterpret").disabled = !r || !wb.data?.model.allowed;
  $("wbFacts").replaceChildren();
  const facts = wbFacts(r?.result);
  for (const fact of facts) {
    const button = wbButton(
      String(fact.value),
      () => {
        wb.facts = [
          fact,
          ...wb.facts.filter(
            (f) => JSON.stringify(f.value) !== JSON.stringify(fact.value),
          ),
        ].slice(0, 50);
        wbSelectedFacts();
        wbFollowups();
      },
      "wb-fact",
    );
    button.append(wbText("small", fact.name + " · " + fact.path));
    button.title = fact.path;
    $("wbFacts").append(button);
  }
  if (!facts.length)
    $("wbFacts").append(
      wbText(
        "p",
        "No short reusable identifiers in this preview. Open the complete evidence or choose another tool.",
        "hint",
      ),
    );
  wbSelectedFacts();
  wbFollowups();
  wbMessage(
    r?.ok === false || run.state === "failed"
      ? "The action failed; the draft and previous evidence remain available."
      : "Evidence is ready. Choose a value or prepare the next action.",
    r?.ok === false || run.state === "failed",
  );
}
function wbSelectedFacts() {
  $("wbSelectedFacts").replaceChildren();
  if (!wb.facts.length) return;
  $("wbSelectedFacts").append(wbText("strong", "Carrying forward"));
  for (const fact of wb.facts.slice(0, 8))
    $("wbSelectedFacts").append(
      wbText("span", fact.name + ": " + String(fact.value)),
    );
  $("wbSelectedFacts").append(
    wbButton("Clear selected values", () => {
      wb.facts = [];
      wbSelectedFacts();
      wbFollowups();
    }),
  );
}
function wbFollowups() {
  const root = $("wbFollowups");
  root.replaceChildren();
  const selected = wb.selected?.result,
    result = selected?.result;
  if (
    result?.job &&
    typeof result.job === "string" &&
    wb.data.tools.find((t) => t.name === selected.tool)?.inputSchema.properties
      ?.job
  ) {
    root.append(
      wbButton("Observe background job", () =>
        wbPrepare(selected.tool, { ...selected.arguments, job: result.job }),
      ),
    );
    if (["running", "queued", "cancelling", "draining"].includes(result.state))
      root.append(
        wbButton("Cancel background job", async () => {
          try {
            await api(
              "/api/admin/job/" + encodeURIComponent(result.job) + "/cancel",
              {},
            );
            wbMessage(
              "Background cancellation requested. Observe the job to check cleanup.",
            );
          } catch (e) {
            wbMessage(e.message, true);
          }
        }),
      );
  }
  const names = [
    ...(wb.intent?.tools || []),
    "catalog_search",
    "pg_table",
    "pg_usage",
    "pg_query",
    "passport",
    "code_search",
    "context_find",
  ];
  for (const name of [...new Set(names)].slice(0, 12)) {
    const t = wb.data.tools.find((t) => t.name === name);
    if (!t) continue;
    root.append(wbButton(wbLabel(name), () => wbPrepare(name, wbSeed(t))));
  }
}
async function wbHelp(mode) {
  if (wb.helpController) return;
  const scope = wbScope(),
    controller = new AbortController();
  wb.helpController = controller;
  $("wbCancelHelp").hidden = false;
  $("wbSuggest").disabled = true;
  $("wbInterpret").disabled = true;
  const previous = $("wbHelp").textContent;
  $("wbHelp").replaceChildren(
    wbText(
      "p",
      mode === "interpret"
        ? "Asking the configured model to interpret this evidence…"
        : "Asking the configured model for editable next actions…",
      "hint",
    ),
  );
  try {
    const result = await api(
      "/api/admin/workbench/assist",
      {
        mode,
        env: env() || wb.data?.env,
        goal: $("wbGoal").value || wb.intent?.goal || "",
        tool: wb.tool?.name,
        arguments: wb.args,
        job:
          mode === "interpret" && !wb.selected?.evidenceId
            ? wb.selected?.id
            : undefined,
        result: mode === "interpret" ? wb.selected?.evidenceId : undefined,
        context: $("wbContext").value || undefined,
      },
      { signal: controller.signal },
    );
    if (scope !== wbScope()) return;
    const root = $("wbHelp");
    root.replaceChildren();
    if (!result.configured) {
      root.append(wbText("p", result.message, "hint"));
      if (runtimeState?.identity?.role === "admin")
        root.append(wbButton("Open model configuration", () => show("config")));
      return;
    }
    root.append(wbText("p", result.summary));
    for (const [title, list] of [
      ["Observed", result.observations],
      ["Uncertain or missing", result.uncertainties],
    ])
      if (list?.length) {
        root.append(wbText("h4", title));
        const ul = document.createElement("ul");
        for (const text of list) ul.append(wbText("li", text));
        root.append(ul);
      }
    for (const next of result.next || []) {
      const row = document.createElement("div");
      row.className = "wb-model-action";
      row.append(
        wbButton("Prepare " + next.tool, () =>
          wbPrepare(next.tool, next.arguments),
        ),
        wbText("p", next.reason),
      );
      if (next.missing.length || next.validation.length)
        row.append(
          wbText(
            "small",
            [
              ...next.missing,
              ...next.validation.map((v) => v.path + ": " + v.message),
            ].join(" · "),
            "hint",
          ),
        );
      root.append(row);
    }
    root.append(
      wbText(
        "p",
        "Model suggestion · " + result.model + " · no action executed",
        "hint",
      ),
    );
  } catch (e) {
    if (scope === wbScope()) {
      $("wbHelp").replaceChildren(
        wbText(
          "p",
          controller.signal.aborted
            ? "Model help cancelled. Your action and evidence are unchanged."
            : e.message,
          "err-text",
        ),
      );
      if (previous)
        $("wbHelp").append(wbText("p", "Previous help: " + previous, "hint"));
    }
  } finally {
    if (wb.helpController !== controller) return;
    wb.helpController = null;
    $("wbCancelHelp").hidden = true;
    $("wbSuggest").disabled = !wb.data?.model.allowed;
    $("wbInterpret").disabled = !wb.selected?.result || !wb.data?.model.allowed;
  }
}
function clearWorkbench() {
  wb.request++;
  wb.poll++;
  clearTimeout(wb.timer);
  wb.helpController?.abort();
  wb.helpController = null;
  wb.form?.destroy();
  wb.data = null;
  wb.scope = null;
  wb.tool = null;
  wb.args = {};
  wb.runs = [];
  wb.selected = null;
  wb.currentJob = null;
  wb.facts = [];
  wb.drafts.clear();
  wb.loading = null;
  wb.loadedLink = null;
  wb.linkRequest++;
  wbLife.to("idle");
  if ($("wbRoot")?.dataset.ready) {
    $("wbTool")._dtCombo.close();
    for (const id of [
      "wbResultRaw",
      "wbContract",
      "wbFacts",
      "wbSelectedFacts",
      "wbFollowups",
      "wbDescription",
      "wbIntentTree",
      "wbCandidates",
      "wbStages",
    ])
      $(id).replaceChildren();
    $("wbContext").replaceChildren(new Option("Session only", ""));
    $("wbContext").disabled = false;
    $("wbNewTask").disabled = false;
    $("wbArgs").value = "{}";
    $("wbCancel").hidden = true;
    $("wbExecution").hidden = true;
    $("wbCancelHelp").hidden = true;
    $("wbAutoHelp").checked = false;
    $("wbInterpret").disabled = true;
    $("wbNative").hidden = true;
    $("wbNative").removeAttribute("src");
    $("wbEvidence").hidden = true;
    $("wbFields").replaceChildren();
    $("wbHelp").replaceChildren();
    $("wbGoal").value = "";
    $("wbTool").value = "";
    $("wbHistory").replaceChildren();
  }
}
document.addEventListener("DOMContentLoaded", () => {
  $("env").addEventListener("change", () => {
    const running = wbActive();
    clearWorkbench();
    if (tab === "workbench")
      loadWorkbench().then(() => {
        if (running)
          wbMessage(
            "Environment changed. The previous run remains in Runtime in its original environment; it was not cancelled.",
          );
      });
  });
  window.addEventListener("beforeunload", (e) => {
    if (wbActive()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("message", (e) => {
    const frame = $("wbNative");
    if (
      frame &&
      e.source === frame.contentWindow &&
      e.data?.type === "iframe:height" &&
      Number.isFinite(e.data.height)
    )
      frame.style.height = Math.min(1000, Math.max(140, e.data.height)) + "px";
  });
  if (tab === "workbench") loadWorkbench();
});
