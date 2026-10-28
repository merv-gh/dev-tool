// Test output, short and to the point: stack traces with the repo's frames and the frames that threw,
// framework frames folded ("... 23 frames: org.springframework.test, org.junit.platform"); build logs
// without banners, downloads, task lines and INFO logs; expected and actual values from assertion
// messages (JUnit, AssertJ, Hamcrest, Mockito).
// "at com.x.Y.m(Y.java:3)", also with the JDK's loader/module prefix: "at app//com.x.Y.m(...)", "at java.base/java.lang.T.m(...)"
const FRAME = /^\s*at (?:[\w.$-]+(?:@[\w.-]+)?\/\/?)?([\w$.]+)\.([\w$<>]+)\(([^)]*)\)\s*$/;

const LIB = /^(jdk\.internal|java\.lang\.reflect|java\.base|sun\.|org\.assertj|org\.opentest4j|org\.junit\.(jupiter\.api|Assert)|junit\.framework|org\.hamcrest|org\.mockito|org\.springframework\.test\.util|org\.springframework\.test\.web\.servlet)/;

// repo: (className) => true for classes of the workspace and its libraries
function compactStack(stack, repo, { maxLines = 30, keepTop = 2, messageLines = 8 } = {}) {
  if (!stack) return null;
  const out = [];
  let folded = [], blockFrames = 0, msgLines = 0, inHeader = true, seenRepo = false;
  const flush = () => {
    if (!folded.length) return;
    const all = [...new Set(folded.map(c => c.split('.').slice(0, -1).slice(0, 3).join('.')))]; // packages, not classes
    out.push(`\t... ${folded.length} frame${folded.length > 1 ? 's' : ''}: ${all.slice(0, 3).join(', ')}${all.length > 3 ? ', …' : ''}`);
    folded = [];
  };
  for (const line of String(stack).split('\n')) {
    const f = line.match(FRAME);
    if (f) {
      inHeader = false;
      const cls = f[1].replace(/\$.*$/, '');
      // the frames that threw, unless they are reflection or the assertion library itself
      const own = repo(cls);
      const top = !own && !seenRepo && blockFrames < keepTop && !LIB.test(f[1]);
      if (own || top) { flush(); out.push(`\tat ${f[1]}.${f[2]}(${f[3]})`); if (top) blockFrames++; if (own) seenRepo = true; }
      else folded.push(f[1]);
      continue;
    }
    if (/^\s*\.\.\. \d+ more\s*$/.test(line)) { flush(); out.push(line.replace(/^\s*/, '\t')); continue; }
    if (/^(Caused by|Suppressed):/.test(line.trim())) { flush(); blockFrames = 0; msgLines = 0; inHeader = true; seenRepo = false; out.push(line.trim()); continue; }
    if (!line.trim()) continue;
    if (inHeader && msgLines++ < messageLines) out.push(line);
    else if (inHeader && msgLines === messageLines + 1) out.push('\t(message cut)');
  }
  flush();
  if (out.length > maxLines) {
    // keep the first exception and the root cause (the last "Caused by")
    const last = out.map((l, i) => (/^Caused by:/.test(l) ? i : -1)).filter(i => i >= 0).pop();
    const head = out.slice(0, Math.floor(maxLines / 2));
    const tail = last !== undefined && last > maxLines / 2 ? out.slice(last, last + Math.ceil(maxLines / 2)) : out.slice(-Math.ceil(maxLines / 2));
    return [...head, `\t... ${out.length - head.length - tail.length} lines`, ...tail].join('\n');
  }
  return out.join('\n');
}

// Build output without the noise; failures, errors and the build result kept
const NOISE = [
  /^\[INFO\]/, /^\[WARNING\]/, /Download(ing|ed) from/, /^Progress \(/, /^> Task /, /^> Configure project/, /^BUILD SUCCESSFUL/,
  /Deprecated Gradle features/, /--warning-mode/, /^For more on this/, /docs\.gradle\.org/, /^WARNING: (A terminally|sun\.misc|Please consider|.*will be removed|A Java agent|If a serviceability|Dynamic loading)/,
  /^Picked up JAVA_TOOL_OPTIONS/, /^OpenJDK 64-Bit Server VM warning/, /Mockito is currently self-attaching/, /inline-mock-maker/, /-javaagent/, /^\s+\.\s+____|^\s+\/\\\\|^\s+\\\\\/|^ =+\|_|^\s+'\s+\|____|:: Spring Boot ::/,
  /^\d{4}-\d{2}-\d{2}[T ][\d:.]+.*\b(INFO|DEBUG|TRACE)\b/, /^\d\d:\d\d:\d\d\.\d+ \[.*\] (INFO|DEBUG|TRACE)/, /^\s*at [\w$.]+\(/, /^\s*\.\.\. \d+ more$/, /^Starting a Gradle Daemon|^Daemon will be stopped/,
];
const SIGNAL = /\b(ERROR|FAIL(ED|URE)?|Exception|error:|What went wrong|Execution failed|Could not|Tests run:|tests completed|No tests found|Unresolved reference|cannot find symbol|BUILD FAILURE)\b|^e: |^\* (What|Where)/;

function compactLog(out, { max = 40 } = {}) {
  const lines = String(out || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  const kept = lines.filter(l => !NOISE.some(re => re.test(l)));
  const signal = kept.filter(l => SIGNAL.test(l));
  const pick = signal.length ? kept.filter((l, i) => SIGNAL.test(l) || (i > 0 && SIGNAL.test(kept[i - 1]))) : kept;
  const seen = new Set();
  const uniq = pick.filter(l => { if (seen.has(l)) return false; seen.add(l); return true; });
  const res = uniq.length ? uniq : lines.slice(-15);
  return res.length > max ? [`... ${res.length - max} lines`, ...res.slice(-max)].join('\n') : res.join('\n');
}

// expected / actual of an assertion message, when it has them
function expectedActual(message) {
  const m = String(message || '');
  let x;
  // JUnit 5: expected: <a> but was: <b>
  if ((x = m.match(/expected:\s*<([\s\S]*?)>\s*but was:\s*<([\s\S]*?)>\s*$/))) return { expected: x[1], actual: x[2] };
  // AssertJ isEqualTo / isEqualByComparingTo
  if ((x = m.match(/expected:\s*([\s\S]*?)\n\s*but was:\s*([\s\S]*?)\s*$/))) return { expected: x[1].trim(), actual: x[2].trim() };
  if ((x = m.match(/Expecting actual:\s*\n([\s\S]*?)\nto be equal to:\s*\n([\s\S]*?)(\nwhen comparing|\nbut was not|$)/))) return { expected: x[2].trim(), actual: x[1].trim() };
  if ((x = m.match(/Expecting actual:\s*\n([\s\S]*?)\nto (contain|be|have|start with|end with|match)([\s\S]*?):?\s*\n([\s\S]*?)(\n(but|when)[\s\S]*)?$/))) return { expected: `${x[2]}${x[3]} ${x[4].trim()}`, actual: x[1].trim() };
  // Hamcrest
  if ((x = m.match(/Expected:\s*([\s\S]*?)\n\s*but:\s*([\s\S]*?)\s*$/))) return { expected: x[1].trim(), actual: x[2].trim() };
  // Mockito: wanted but not invoked, with the interactions there were
  if ((x = m.match(/Wanted but not invoked:\s*\n([\s\S]*?)\n->[^\n]*\n[\s\S]*?interactions? with this mock:\s*\n([\s\S]*?)\s*$/))) return { expected: x[1].trim(), actual: x[2].replace(/\n->[^\n]*/g, '').trim() };
  // Mockito: Wanted ... Actual invocations have different arguments
  if ((x = m.match(/Wanted:\s*\n([\s\S]*?)\n->[^\n]*\nActual invocations? ha(?:ve|s) different arguments[^\n]*:\s*\n([\s\S]*?)(\n->|$)/))) return { expected: x[1].trim(), actual: x[2].trim() };
  return null;
}

// a message for the model: the first lines, not a page
function compactMessage(message, { lines = 6, chars = 600 } = {}) {
  if (!message) return null;
  const ls = String(message).split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  let t = ls.slice(0, lines).join('\n');
  if (ls.length > lines) t += `\n(${ls.length - lines} more lines)`;
  return t.length > chars ? `${t.slice(0, chars)}…` : t;
}

// the stack without its header (the message, shown already)
const framesOnly = (stack) => String(stack || '').split('\n').filter(l => /^\s*(at |\.\.\. |Caused by:|Suppressed:)/.test(l)).join('\n');

module.exports = { framesOnly, compactStack, compactLog, expectedActual, compactMessage };
