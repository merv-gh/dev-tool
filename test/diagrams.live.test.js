// Opt-in: DT_PLANTUML_JAR=/path/to/plantuml.jar node --test test/diagrams.live.test.js
// Uses the JDK and PlantUML's bundled C4 standard library; no Graphviz or outbound renderer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../lib/diagrams');
const model = {
  name: 'Refund feature',
  nodes: [
    { id:'customer', name:'Customer', kind:'person' },
    { id:'pay', name:'Payment service', kind:'service', technology:'Java', owner:'Payments' },
    { id:'db', name:'Refunds DB', kind:'database', technology:'PostgreSQL', tables:['pay.refunds'] },
    { id:'topic', name:'refund_created', kind:'topic', technology:'Kafka', schema:{name:'RefundCreated',version:2}, partitions:3 },
    { id:'fraud', name:'Fraud service', kind:'external' },
  ],
  relations: [
    {from:'customer',to:'pay',label:'Request refund',technology:'HTTP',provenance:{source:'code'}},
    {from:'pay',to:'db',label:'Save refund',technology:'SQL',provenance:{source:'code'}},
    {from:'pay',to:'topic',label:'Publish',provenance:{source:'docs:diagram'}},
    {from:'pay',to:'fraud',label:'Check',conflict:true},
  ],
  flows:[{name:'Refund flow',steps:[
    {from:'customer',to:'pay',label:'POST /refund',provenance:{source:'code'}},
    {from:'pay',to:'db',label:'INSERT refund',provenance:{source:'code'}},
    {from:'pay',to:'topic',label:'RefundCreated',provenance:{source:'docs:diagram'}},
  ]}],
};
for (const view of ['context','container','dynamic','sequence']) {
  test(`PlantUML JAR renders ${view} with secure bundled C4 and no Graphviz`, { skip:!process.env.DT_PLANTUML_JAR }, async () => {
    const result = await render(model, {view,plantumlJar:process.env.DT_PLANTUML_JAR,timeoutMs:30000});
    assert.equal(result.rendered,true); assert.equal(result.renderer,'plantuml');
    assert.match(result.svg,/^<svg\b/);
    const labels = result.svg.replace(/<[^>]+>/g,'').replace(/\u00a0/g,' ');
    assert.match(labels,/Payment service/);
    assert.doesNotMatch(result.svg,/Syntax Error|Error line|href=|onload=/i);
    if (view !== 'context') assert.match(labels,/Refunds DB/);
  });
}
