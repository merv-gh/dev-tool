// Native semantic and passport tools share the authenticated Admin transport.
let semanticAdminTools = []; let semanticAdminLoaded = false; const semanticAdminPending = new DTState.Activity(); const semanticAdminVersion = new DTState.Revision(); const semanticAdminDirty = new DTState.Dirty(); let semanticAdminJob = null; let semanticAdminJobTimer = null; let semanticAdminPorts = null; const semanticAdminEdits = new DTState.Revision(); let semanticAdminCurrentTool = null;
let semanticAdminLoading = null, semanticAdminHash = '', semanticAutoPortHash = '';
const semanticToolNames = ["semantic_capabilities", "semantic_index", "semantic_search", "semantic_query", "semantic_ports", "passport_adjustments", "passport_adjust"];
function semanticAdminMessage(text, error = false) {
  $("smAdminMessage").textContent = text;
  $("smAdminMessage").className = error ? "err-text" : "hint";
}
function semanticAdminScope() {
  return { service: $("smService").value.trim(), repo: $("smRepository").value.trim(), revision: $("smRevision").value.trim(), analysis: $("smAnalysis").value.trim(), env: env() };
}
function semanticAdminDefaults(schema) {
  const value = {};
  for (const [key, property] of Object.entries(schema?.properties || {})) {
    if (property.default !== void 0) value[key] = property.default;
    else if ((schema.required || []).includes(key)) value[key] = Array.isArray(property.type) && property.type.includes("null") ? null : property.enum ? property.enum[0] : property.type === "string" ? "" : property.type === "array" ? [] : property.type === "integer" || property.type === "number" ? 0 : property.type === "boolean" ? false : {};
  }
  return value;
}
function semanticAdminPrepare(name, args) {
  const tool = semanticAdminTools.find((tool2) => tool2.name === name);
  if (!tool) {
    semanticAdminMessage("Tool is not enabled: " + name, true);
    return false;
  }
  if (semanticAdminDirty.value && !confirm("Replace the current argument draft?")) { if (semanticAdminCurrentTool) $("smTool").value=semanticAdminCurrentTool; return false; }
  const scope = semanticAdminScope(), value = args || semanticAdminDefaults(tool.inputSchema), props = tool.inputSchema.properties || {};
  if (!args) {
    for (const key of ["service", "repo", "env", "analysis"]) if (scope[key] && key in props) value[key] = scope[key];
    if (scope.revision) {
      if ("revision" in props) value.revision = scope.revision;
      else if ("ref" in props) value.ref = scope.revision;
    }
    if (name === "semantic_query") {
      value.operation = "paths";
      value.mode = "reachability";
      value.from = { signature: "" };
      value.to = { signature: "" };
    }
    if (name === "passport_adjust") {
      value.expected_revision = semanticAdminPorts?.revision ?? null;
      value.reason = "";
      value.operations = [{ action: "add", port: { type: "http-ingress", handler: { file: null, line: null, signature: null }, boundary: { host: null, method: "GET", path: null }, mappings: [] } }];
    }
  }
  $("smTool").value = name;
  semanticAdminCurrentTool = name;
  $("smArgs").value = JSON.stringify(value, null, 2);
  $("smSchema").textContent = tool.description + "\n\n" + JSON.stringify(tool.inputSchema, null, 2);
  semanticAdminDirty.value = false;
  $("smRunStatus").textContent = "Arguments prepared. Review before running.";
  return true;
}
function semanticAdminJobId(result) {
  return typeof result?.job === "string" ? result.job : result?.job?.id || null;
}
function semanticAdminRender(result, name) {
  const view = rtNativeView(result?.view);
  $("smAdminOutput").innerHTML = (view ? '<iframe id="smAdminView" class="sm-admin-view" title="Semantic analysis result" sandbox="allow-scripts allow-popups allow-downloads"></iframe>' : "") + rtDisclosure("Complete tool result", result, !view);
  if (view) $("smAdminView").src = view;
  const analyses = Array.isArray(result?.analyses) ? result.analyses : Array.isArray(result?.versions) ? result.versions : [];
  $("smRetained").innerHTML = analyses.length ? "<table><thead><tr><th>Repository</th><th>Exact source revision</th><th>Analysis / generation</th><th></th></tr></thead><tbody>" + analyses.slice(0,200).map((analysis, index) => "<tr><td>" + rtEsc(analysis.repo) + '</td><td class="mono">' + rtEsc(analysis.sha || analysis.revision) + "</td><td>" + rtEsc(analysis.id || analysis.analysisId) + '<br><span class="muted">' + rtEsc(analysis.generation || analysis.revisionKey) + '</span></td><td><button data-sm-analysis="' + index + '">Use analysis</button></td></tr>').join("") + "</tbody></table>" : "";
  $("smRetained").querySelectorAll("[data-sm-analysis]").forEach((button) => button.onclick = () => {
    const analysis = analyses[Number(button.dataset.smAnalysis)];
    $("smAnalysis").value = analysis.id || analysis.analysisId || "";
    if (analysis.repo) $("smRepository").value = analysis.repo;
    if (analysis.sha || analysis.revision) $("smRevision").value = analysis.sha || analysis.revision;
    semanticAdminPrepare("semantic_query");
  });
  if (["semantic_ports", "passport_adjustments", "passport_adjust"].includes(name)) {
    semanticAdminPorts = result;
    const identity = result.identity || {};
    for (const [key, id] of [["service", "smService"], ["repo", "smRepository"], ["revision", "smRevision"]]) if (identity[key]) $(id).value = identity[key];
    $("smPortEditor").hidden = false;
    $("smPortRevision").textContent = "Adjustment revision: " + (result.revision || "none") + " \xB7 " + (result.gaps || []).length + " gaps. Edits preserve detected findings and require this revision.";
    $("smPortRows").innerHTML = (result.ports || []).slice(0, 100).map((port, index) => '<div class="sm-admin-port"><div><strong>' + rtEsc(port.type) + " \xB7 " + rtEsc(port.id) + "</strong><small>" + rtEsc(port.evidence?.origin || port.origin || port.status || "origin unknown") + " \xB7 " + rtEsc([port.handler?.file, port.handler?.line].filter(Boolean).join(":")) + '</small></div><button data-sm-port="' + index + '" data-action="correct">Prepare correction</button><button data-sm-port="' + index + '" data-action="disable">Prepare disable</button></div>').join("") || '<p class="hint">No typed ports returned. Add a declaration or inspect the recorded gaps.</p>';
    $("smPortRows").querySelectorAll("[data-sm-port]").forEach((button) => button.onclick = () => semanticAdminPortEdit(button.dataset.action, (result.ports || [])[Number(button.dataset.smPort)]));
  }
  const jobId = semanticAdminJobId(result);
  semanticAdminJob = jobId;
  clearTimeout(semanticAdminJobTimer);
  $("smCancel").hidden = !jobId || ["done", "ready", "failed", "cancelled", "interrupted"].includes(result.state || result.job?.state);
  $("smJobInspect").hidden = !jobId;
  if (jobId && !["done","ready","failed","cancelled","interrupted"].includes(result.state||result.job?.state)) semanticAdminPollJob(jobId);
  else $("smJobStatus").textContent=jobId?"Job "+jobId+" · "+(result.state||result.job?.state):"";
}
function semanticAdminProject(value, schema) {
  if (value == null) return value;
  if (schema?.type === "array" && Array.isArray(value)) return value.map((item) => semanticAdminProject(item, schema.items));
  if (typeof value === "object" && !Array.isArray(value) && schema?.properties) return Object.fromEntries(Object.entries(value).filter(([key]) => key in schema.properties).map(([key, item]) => [key, semanticAdminProject(item, schema.properties[key])]));
  return value;
}
function semanticAdminPortEdit(action, port) {
  const tool = semanticAdminTools.find((tool2) => tool2.name === "passport_adjust");
  if (!tool) return;
  const scope = semanticAdminScope(), value = { service: scope.service, env: scope.env, repo: scope.repo || null, revision: scope.revision || null, expected_revision: semanticAdminPorts?.revision ?? null, reason: "", operations: [action === "add" ? { action: "add", port: { type: "http-ingress", handler: { file: null, line: null, signature: null }, boundary: { method: "GET", host: null, path: null }, mappings: [] } } : { action, port_id: port.id, ...action === "correct" ? { port: semanticAdminProject(port, tool.inputSchema.properties.operations.items.properties.port) } : {} }] };
  semanticAdminPrepare("passport_adjust", value);
  $("smArgs").focus();
}
function semanticAdminMetadataEdit() {
  const scope=semanticAdminScope(),value={service:scope.service,env:scope.env,repo:scope.repo||null,revision:scope.revision||null,expected_revision:semanticAdminPorts?.revision??null,reason:'',metadata:{...semanticAdminPorts?.metadata}};
  for(const [key,fallback] of [['description',null],['notes',null],['owners',[]],['tags',[]]]) if(value.metadata[key]===undefined||value.metadata[key]==='')value.metadata[key]=fallback;
  semanticAdminPrepare('passport_adjust',value);$('smArgs').focus();
}
async function semanticAdminRun() {
  if (semanticAdminPending.value) return;
  let args;
  try {
    args = JSON.parse($("smArgs").value);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw Error("Arguments must be a JSON object");
  } catch (error) {
    semanticAdminMessage(error.message, true);
    return;
  }
  const name = $("smTool").value, scope = runtimeScopeVersion.value, version = ++semanticAdminVersion.value, edits = semanticAdminEdits.value;
  semanticAdminPending.value = true;
  $("smRun").disabled = true;
  $("smRunStatus").textContent = "Running " + name + "\u2026";
  semanticAdminMessage("");
  try {
    const response = await api("/api/tool/" + encodeURIComponent(name), args);
    if (scope !== runtimeScopeVersion.value || version !== semanticAdminVersion.value) return;
    semanticAdminDirty.value = edits !== semanticAdminEdits.value;
    semanticAdminRender(response.result, name);
    $("smRunStatus").textContent = response.result?.state ? "State: " + response.result.state : response.result?.error ? "Completed with a reported error." : "Completed.";
  } catch (error) {
    if (scope === runtimeScopeVersion.value && version === semanticAdminVersion.value) {
      semanticAdminMessage(error.message, true);
      $("smRunStatus").textContent = "Call failed. Your argument draft is preserved.";
    }
  } finally {
    semanticAdminPending.value = false;
    $("smRun").disabled = false;
  }
}
async function semanticAdminPollJob(id) {
  const scope = runtimeScopeVersion.value;
  try {
    const job = await api("/api/admin/job/" + encodeURIComponent(id));
    if (scope !== runtimeScopeVersion.value || id !== semanticAdminJob) return;
    $("smJobStatus").textContent = [job.title, job.state, job.stage, job.log?.at(-1), job.error].filter(Boolean).join(" \xB7 ");
    $("smCancel").hidden = !["queued", "running", "cancelling", "draining"].includes(job.state);
    if (["queued", "running", "cancelling", "draining"].includes(job.state) && tab === "semantic") semanticAdminJobTimer = setTimeout(() => semanticAdminPollJob(id), 1500);
    else if (job.state === "done" && job.result) {
      const result = await api("/api/tool/show", { view: job.result.flowMap ? "semantic-flow-map" : "semantic-analysis", data: job.result, title: "Semantic job result" });
      if (scope !== runtimeScopeVersion.value || id !== semanticAdminJob) return;
      const view = rtNativeView(result.result?.view);
      if (view) {
        $("smAdminOutput").innerHTML = '<iframe id="smAdminView" class="sm-admin-view" title="Semantic job result" sandbox="allow-scripts allow-popups allow-downloads"></iframe>' + rtDisclosure("Job result", job.result);
        $("smAdminView").src = view;
      }
    }
  } catch (error) {
    if (scope === runtimeScopeVersion.value) $("smJobStatus").textContent = error.message;
  }
}
async function loadSemanticAdmin() {
  if (!semanticAdminLoaded) {
    if(!semanticAdminLoading)semanticAdminLoading=(async()=>{
      semanticAdminTools = (await api("/api/tools")).filter((tool) => semanticToolNames.includes(tool.name));
      $("smTool").innerHTML = semanticAdminTools.map((tool) => "<option>" + rtEsc(tool.name) + "</option>").join("");
      semanticAdminLoaded = true;
    })().finally(()=>{semanticAdminLoading=null;});
    await semanticAdminLoading;
  }
  if(semanticAdminHash!==location.hash){semanticAdminHash=location.hash;const params = new URLSearchParams(location.hash.split("?")[1] || "");
    for (const [key, id] of [["service", "smService"], ["repo", "smRepository"], ["revision", "smRevision"], ["analysis", "smAnalysis"]]) if (params.has(key)) $(id).value = params.get(key);
    if (params.has("env") && [...$("env").options].some((option) => option.value === params.get("env"))) $("env").value = params.get("env");
  }
  if (!semanticAdminCurrentTool) semanticAdminPrepare("semantic_query");
  const requestedPort=new URLSearchParams(location.hash.split('?')[1]||'').get('port');
  if(requestedPort&&semanticAutoPortHash!==location.hash){semanticAutoPortHash=location.hash;const s=semanticAdminScope();if(semanticAdminPrepare('passport_adjustments',{service:s.service,env:s.env,...(s.repo?{repo:s.repo}:{}),...(s.revision?{revision:s.revision}:{})}))await semanticAdminRun();}
  if (semanticAdminJob) semanticAdminPollJob(semanticAdminJob);
}
function semanticAdminClear() {
  semanticAdminVersion.value++;semanticAutoPortHash='';if(typeof uxClearScope==='function')uxClearScope();
  semanticAdminPorts = null;
  semanticAdminJob = null;
  semanticAdminDirty.value = false;
  clearTimeout(semanticAdminJobTimer);
  for (const id of ["smRetained", "smPortRows", "smAdminOutput"]) $(id).replaceChildren();
  $("smPortEditor").hidden = true;
  $("smJobStatus").textContent = "";
  $("smRunStatus").textContent = "";
  $("smCancel").hidden = $("smJobInspect").hidden = true;
  for (const id of ["smService", "smRepository", "smRevision", "smAnalysis"]) $(id).value = "";
  $("smArgs").value = "{}";
}
function semanticAdminInit() {
  for (const id of ['smService','smRepository','smRevision']) $(id).oninput=()=>{semanticAdminPorts=null;$('smPortEditor').hidden=true;$('smAnalysis').value='';};
  $('env').addEventListener('change',()=>{semanticAdminPorts=null;$('smPortEditor').hidden=true;});
  $("smPrepare").onclick = () => semanticAdminPrepare($("smTool").value);
  $("smTool").onchange = () => semanticAdminPrepare($("smTool").value);
  $("smArgs").oninput = () => {
    semanticAdminDirty.value = true;
    semanticAdminEdits.value++;
  };
  $("smRun").onclick = semanticAdminRun;
  for (const [id, name] of [["smCapabilities", "semantic_capabilities"], ["smList", "semantic_index"], ["smPorts", "passport_adjustments"], ["smIndex", "semantic_index"]]) $(id).onclick = async () => {
    await loadSemanticAdmin();
    if (!semanticAdminPrepare(name, id === "smList" ? { versions: true } : void 0)) return;
    if (id !== "smIndex") await semanticAdminRun();
  };
  $("smFlowMap").onclick = async () => {
    await loadSemanticAdmin(); const s=semanticAdminScope();
    semanticAdminPrepare('semantic_query',{operation:'flowmap',mode:'dataflow',...(s.service?{service:s.service}:{}),...(s.repo?{repo:s.repo}:{}),...(s.analysis?{analysis:s.analysis}:{}),env:s.env,waitMs:0,maxMethods:20,maxStates:180});
  };
  $("smPortAdd").onclick = () => semanticAdminPortEdit("add");
  $('smMetadataEdit').onclick=semanticAdminMetadataEdit;
  $("smJobInspect").onclick = () => {
    selectedJob = semanticAdminJob;
    show("jobs");
    showJob(semanticAdminJob);
  };
  $("smCancel").onclick = async () => {
    const id = semanticAdminJob;
    if (!id) return;
    try {
      await api("/api/admin/job/" + encodeURIComponent(id) + "/cancel", { reason: "Cancelled from semantic inspector" });
      await semanticAdminPollJob(id);
    } catch (error) {
      semanticAdminMessage(error.message, true);
    }
  };
  window.addEventListener("message", (event) => {
    const frame = $("smAdminView");
    if (frame && event.source === frame.contentWindow && event.data?.type === "iframe:height" && Number.isFinite(event.data.height)) frame.style.height = Math.max(72, Math.min(1100, Math.ceil(event.data.height))) + "px";
  });
  window.addEventListener("beforeunload", (event) => {
    if (semanticAdminDirty.value) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", semanticAdminInit);
