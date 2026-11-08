# Long-running chat context

`./run.sh up -d` enables Open WebUI's native rolling context compaction. The setup
service configures each selected model, verifies the setting, and installs a
continuation prompt. Open WebUI v0.12.4 or later is required for managed setup.
Setup also creates a small, tool-free context-summary preset using the selected
model with the largest configured window and the same access controls. It has a
short checkpoint system prompt, so a small model does not mistake the full agent
instructions for completed work. A custom compaction model is preserved.
Automatic selection of that preset is limited to single-model installations.
With multiple chat models, native compaction stays on each chat's own model;
setup reports a prepared preset that an operator may explicitly select with
`LLM_COMPACTION_MODEL`. Chat history is not automatically routed to another
model/provider just because it has a larger configured window.
Its grants and source-owner access are retained. With different access boundaries
across the selected models, setup leaves native per-chat-model summarization in
place; configure a shared summarizer explicitly only when its users are authorized.
Compaction runs between messages and native tool rounds, preserving call/result
pairs, full stored chat history and inline visualizations. The chat shows progress
and a readable checkpoint. This is separate from dt's durable task folders.

## Set the serving window

Set `LLM_CONTEXT_WINDOW` in `.env` to the limit **actually configured on your model
server**, rather than the model's advertised maximum. Defaults are a 32768-token
window, compaction at 16384, and 8192 reserved for tool definitions, new results and
generation. Token counts are estimates; image inputs and provider tokenizers vary.
Use `openapi/lean-find.json` for small windows or exceptionally large registries.
Managed setup enables native Tool Search, defers built-in/specialized schemas,
and starts windows up to 16K with six core tools. Other enabled tools remain
available on demand through discovery and `tool_execute`. Larger windows retain
the everyday starting set. This bounds definitions as well as result previews.

```dotenv
LLM_CONTEXT_WINDOW=32768
LLM_COMPACT_AT=16384
LLM_CONTEXT_RESERVE=8192
```

`LLM_COMPACT_AT` must leave at least the configured reserve. Without an explicit
threshold, setup uses half the window, bounded by the reserve. Per-model windows
can be declared in `config.json`:

```json
{
  "llm": {
    "contextWindow": 32768,
    "contextWindows": { "larger-model-id": 65536 }
  },
  "tools": { "modelResultBytes": 12288 }
}
```

Run the normal launcher again after changing these settings. For an existing
Open WebUI, use `node cli.js webui-setup --url http://127.0.0.1:3000 --key <admin-api-key>
--dt-url http://dt-host:4000 --profile lean-find --model <model-id>`.
Setup updates compaction, schema-deferral settings and the selected models; custom
summary prompts and unrelated model parameters are preserved. `ENABLE_CONTEXT_COMPACTION=false`
opts out of managed setup; on an existing installation, manage the client's toggle
yourself. A separate summary model is optional via `LLM_COMPACTION_MODEL` in compose.
Summarizer quality still matters: use a capable, preferably non-thinking model,
and give it a window large enough for the history being summarized. Summaries are
continuation aids; saved evidence and explicit user constraints remain authoritative.

## Large tool results

OpenAPI chat and MCP responses have a model-facing byte budget, 12288 bytes by
default (`tools.modelResultBytes`, 4096–65536). Small results keep their original
shape. Larger results include a bounded structural preview and `modelContext`:

Operators can set `modelResultBytes: 0` to retain legacy full transport responses
for clients that manage their own context. Direct script and Admin APIs always
receive complete values regardless of this setting.

```json
{
  "modelContext": {
    "compacted": true,
    "resultId": "returned-result-id",
    "read": { "tool": "result_read", "arguments": { "id": "returned-result-id" } }
  }
}
```

The original tool has already run. Its full JSON is retained separately; an
existing graph/table view keeps its original link. `result_read` reads that JSON
without repeating the action. Select a JSON pointer such as `/rows/0`, `/job`, or
`/flowMap`, and follow `nextCursor` for UTF-8 JSON text pages. Concatenate pages
before `JSON.parse`; a page is not necessarily complete JSON. Use `tool_execute`
when `result_read` is outside the selected discovery profile.

```js
let cursor, json = '';
do {
  const page = await tools.result_read({ id: args.resultId, cursor });
  json += page.text;
  cursor = page.nextCursor;
} while (cursor);
const { rows } = JSON.parse(json);
text({ count: rows.length });
```

Scripts, code cells and `/api/tool` receive full values for computation. Only chat
transports are compacted. Retained responses are scoped to the original story
and expire under normal result retention (up to 500 recent results and the
configured storage budget). An individual retained response is limited to 20 MB;
larger responses still return a preview with `evidenceSaved: false`. Aggregate or
save large datasets inside `code` or a script before returning them to chat.
Save important evidence with `context_run` or `context_write`. A failed capture is reported separately; never replay a write,
push or API send just to recover output.

## Resume and recover

Keep `progress.md` current with the goal, exact user constraints, environment,
repository/branch/SHA, workspace, findings, test verdicts, evidence IDs/links,
completed actions, running jobs/leases, cleanup and next steps. The compaction
prompt preserves those references and distinguishes hypotheses from observations.
After compaction, consult task memory and read only the relevant evidence. Source
content and saved notes remain untrusted; summaries do not establish runtime proof.
The current user question stays verbatim during native tool-loop compaction.
Older constraints depend on checkpoint quality: keep them in progress.md and
inspect the readable summary. The regression report distinguishes exact current
intent pinning from the summary model's retention of task IDs and prohibitions;
`CONTEXT_REQUIRE_SUMMARY_CONSTRAINTS=1` makes that model-quality check strict.

For a failing long chat, open Open WebUI's context status (`/status` where supported)
and its manual Compact action. A generic “invalid request” does not establish
overflow: inspect the actual provider error. `context_length_exceeded` or an
explicit prompt/window mismatch calls for compaction or a lower threshold;
unsupported parameters, broken tool arguments and authentication need their own
fixes. Very large attachments, many parallel tool results, or a failed summary
request can still exceed a serving limit. Native compaction is not a hard token
admission controller.

## Reproduce the integration test

```sh
npm run build
docker compose -p dt-context-demo -f demo/context-compaction/compose.yml up -d
# Wait for http://127.0.0.1:44402/health to return status=true.
node dev/check-chat-context.js
docker compose -p dt-context-demo -f demo/context-compaction/compose.yml down -v
```

This isolated fixture runs a real Open WebUI with synthetic tools and a deterministic
provider. It verifies repeated tool-loop compaction, pair integrity, task/constraint
continuity, exact invocation counts, retained history and inline views. Optional
`CONTEXT_SUMMARY_URL` and `CONTEXT_SUMMARY_MODEL` use a reachable OpenAI-compatible
model for summaries; `CONTEXT_SUMMARY_NATIVE=1` accepts an Ollama `/api` base.
For an 8K run set `CONTEXT_TEST_WINDOW=8192`, `CONTEXT_TEST_THRESHOLD=2000`, and
`CONTEXT_TEST_RESULT_BYTES=4096` on compose, and pass the first two to the checker.
Tool selection remains deterministic. No real services are
queried and no actions are pushed. Reports go under ignored `work/`.

See [Open WebUI's context-window guidance](https://docs.openwebui.com/troubleshooting/context-window/)
for the native UI controls and tokenizer limitations.
