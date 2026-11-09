const test = require('node:test'), assert = require('node:assert/strict'), http = require('http');
const { promisify } = require('util'), execFile = promisify(require('child_process').execFile);
const { args, validateEndpoint } = require('../dev/eval-discovery-model');
test('model evaluation requires an explicit endpoint and enforces budgets without implicit remote access', () => {
  assert.throws(() => validateEndpoint('https://example.com/v1', false), /allow-remote/);
  assert.throws(() => validateEndpoint('http://user:password@localhost/v1', false), /credentials/);
  assert.equal(validateEndpoint('http://127.0.0.1:1234/v1/', false), 'http://127.0.0.1:1234/v1');
  assert.throws(() => args(['--max-turns', '100']), /bounded/);
  assert.throws(() => args(['--max-context-bytes', 'Infinity']), /bounded/);
  assert.throws(() => args(['--input-usd-per-million', '-1']), /price/i);
});
test('scripted endpoint tests transport, judgment isolation, invalid-argument recovery and no task execution', async () => {
  let count = 0, leaked = false;
  const requests = [], actions = [
    ['tool_search', { query: 'overview', limit: 3 }],
    ['tool_describe', { name: 'overview' }],
    ['tool_execute', { name: 'overview', arguments: { env: 7 } }],
    ['tool_execute', { name: 'overview', arguments: { env: 'staging' } }],
  ];
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'scripted-test', owned_by: 'unit-test' }] }));
    let raw = ''; for await (const c of req) raw += c;
    const body = JSON.parse(raw); requests.push(body);
    // A model sees questions, schema definitions and tool responses; no judgment labels.
    if (body.messages.some(m => /"relevant"|"recall"|"ops-env"/.test(m.content || ''))) leaked = true;
    const action = actions[count++];
    res.end(JSON.stringify({ model: 'scripted-test-revision', usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [{ message: { role: 'assistant', content: action ? null : 'Discovery complete; no operation ran.', ...(action ? { tool_calls: [{ id: 'call-' + count, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] } : {}) } }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const { stdout } = await execFile(process.execPath, [require.resolve('../dev/eval-discovery-model'), '--endpoint', `http://127.0.0.1:${server.address().port}/v1`, '--model', 'scripted-test', '--scripted-endpoint', '--limit', '1', '--input-usd-per-million', '1', '--output-usd-per-million', '2']);
    const report = JSON.parse(stdout);
    assert.equal(report.kind, 'scripted-endpoint-contract-check');
    assert.equal(report.provenance.instructionSha256, require('crypto').createHash('sha256').update(requests[0].messages[0].content).digest('hex'));
    assert.equal(report.provenance.schemaCount, 4);
    assert.equal(report.provenance.modelSizeVerified, false);
    assert.equal(report.samples[0].applicationExecutionPerformed, false);
    assert.deepEqual(report.samples[0].selected, ['overview']);
    assert.equal(report.metrics.invalidCalls, 1);
    assert.equal(report.usage.reportedCalls, 5);
    assert.equal(report.estimatedCostUsd, .0006);
    assert.equal(leaked, false);
    assert.ok(requests.every(r => r.tools.length === 4));
    assert.match(requests.at(-1).messages.at(-1).content, /"executionPerformed":false/);
    const beforeBudget = requests.length;
    const bounded = await execFile(process.execPath, [require.resolve('../dev/eval-discovery-model'), '--endpoint', `http://127.0.0.1:${server.address().port}/v1`, '--model', 'scripted-test', '--scripted-endpoint', '--limit', '1', '--max-context-bytes', '512']);
    const budget = JSON.parse(bounded.stdout);
    assert.equal(budget.samples[0].finish, 'context-budget');
    assert.equal(budget.usage.reportedCalls, 0);
    assert.equal(budget.estimatedCostUsd, null);
    assert.equal(requests.length, beforeBudget, 'over-budget context never reaches inference endpoint');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('native Ollama transport keeps tools, a bounded non-thinking context and withheld custom-corpus judgments',async()=>{
 const corpus={version:1,cases:[{id:'private-oracle-id',query:'Inspect a path between two source values.',relevant:['semantic_trace']}]},requests=[];let count=0;
 const actions=[['tool_describe',{name:'semantic_trace'}],['tool_execute',{name:'semantic_trace',arguments:{analysis:'synthetic-v1',from:{kind:'method',name:'submit',parameter:'rebate'},to:{kind:'call',name:'save',argument:2}}}]];
 const server=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.method==='GET')return res.end(JSON.stringify({models:[{name:'scripted-test',digest:'provider-digest',details:{parameter_size:'4B'}}]}));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);const action=actions[count++];res.end(JSON.stringify({model:'scripted-test',prompt_eval_count:10,eval_count:5,message:{role:'assistant',content:action?'':'No operation ran.',...(action?{tool_calls:[{type:'function',function:{name:action[0],arguments:action[1]}}]}:{})}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const endpoint='http://127.0.0.1:'+server.address().port,code=`const E=require('./dev/eval-discovery-model');E.run(E.args(['--endpoint',${JSON.stringify(endpoint)},'--model','scripted-test','--scripted-endpoint','--limit','1']),{corpus:${JSON.stringify(corpus)},transport:'ollama'}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});`,{stdout}=await execFile(process.execPath,['-e',code]);const r=JSON.parse(stdout);assert.equal(r.kind,'scripted-endpoint-contract-check');assert.equal(r.samples[0].calls[1].arguments.arguments.analysis,'synthetic-v1');assert.equal(r.samples[0].applicationExecutionPerformed,false);assert.equal(r.provenance.advertised.models[0].details.parameter_size,'4B');assert.ok(requests.every(q=>q.think===false&&q.options.num_ctx===16384));assert.ok(requests.at(-1).messages.some(m=>m.role==='tool'&&m.tool_name==='tool_execute'));assert.ok(requests.every(q=>!JSON.stringify(q.messages).includes('private-oracle-id')));assert.equal(r.usage.reportedCalls,3);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
