// Only the named query engine is exposed, never arbitrary SQL or Scala.
const { parentPort, workerData } = require('worker_threads');
require('./semantic-query-engine').query(workerData.args, workerData.analyses, workerData.options).then(value=>parentPort.postMessage({ok:true,value}),error=>parentPort.postMessage({ok:false,error:{message:error.message,code:error.code}}));
