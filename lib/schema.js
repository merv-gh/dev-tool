// Same schema validation in the browser and every tool transport.
const {validate} = require('../web/tool-schema');
function assert(value, schema) {
  let text;
  try { text = JSON.stringify(value); } catch { throw Object.assign(new Error('Arguments must be JSON serializable'), { code: 'DT_ARGUMENT_INVALID' }); }
  const maxInputBytes = require('./config').getTools().maxInputBytes;
  if (text === undefined || Buffer.byteLength(text) > maxInputBytes) throw Object.assign(new Error(`Arguments exceed ${maxInputBytes} bytes`), { code: 'DT_ARGUMENT_INVALID' });
  const issues = validate(value, schema);
  if (issues.length) throw Object.assign(new Error(`Invalid argument ${issues[0].path}: ${issues[0].message}`), { code: 'DT_ARGUMENT_INVALID', issues });
  return value;
}
module.exports = { validate, assert };
