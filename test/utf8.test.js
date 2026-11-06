const test = require('node:test');
const assert = require('node:assert/strict');
const { environment } = require('../lib/utf8');

test('encoding policy is idempotent, preserves build options and does not inherit secrets', () => {
  const input = { PATH: '/bin', JAVA_TOOL_OPTIONS: '-Xmx256m "-Dfile.encoding=US-ASCII" -Dkeep=yes' };
  const env = environment(input);
  assert.equal(env.JAVA_TOOL_OPTIONS, '-Xmx256m  -Dkeep=yes -Dfile.encoding=UTF-8');
  assert.deepEqual(environment(env), env);
  assert.equal(env.DT_API_KEY, undefined);
  assert.equal(input.LC_ALL, undefined);
  assert.match(env.LC_ALL, /UTF-8$/);
});

test('local builds decode split UTF-8 on stdout and stderr independently', async () => {
  const text = 'Заказ_客户😀.java';
  const code = `const bytes=Buffer.from(${JSON.stringify(text)});let i=0;const t=setInterval(()=>{if(i===bytes.length){clearInterval(t);return;}process.stdout.write(bytes.subarray(i,i+1));process.stderr.write(bytes.subarray(i,i+1));i++;},3);`;
  const result = await require('../lib/testrun').execLocal(process.execPath, ['-e', code], { env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' }, timeoutMs: 5000 });
  assert.equal(result.code, 0);
  // Streams may interleave, but no partial byte can turn into a replacement glyph.
  assert.ok(!result.out.includes('\ufffd'));assert.ok(!result.out.includes('?'));
  for (const char of text) assert.equal([...result.out].filter(c => c === char).length, [...text].filter(c => c === char).length * 2);
});

test('a real JVM generates, compiles and loads a Unicode Java filename', async t => {
  const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
  const probe=spawnSync('javac',['-version'],{encoding:'utf8',timeout:10000});
  if(probe.status!==0){t.skip('JDK unavailable');return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-utf8-java-'));
  const exec=require('../lib/testrun').execLocal,env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C',JAVA_TOOL_OPTIONS:'-Dfile.encoding=US-ASCII'};
  try {
    fs.writeFileSync(path.join(root,'Generate.java'),'import java.nio.file.*; public class Generate { public static void main(String[] a) throws Exception { Files.writeString(Path.of("Заказ.java"), "public class Заказ { public static void main(String[] a) { System.out.print(\\"客户\\"); } }"); } }');
    for(const [cmd,args] of [['javac',['Generate.java']],['java',['-cp','.', 'Generate']],['javac',['Заказ.java']]]) {
      const r=await exec(cmd,args,{cwd:root,env,timeoutMs:20000});assert.equal(r.code,0,r.out);
    }
    assert.ok(fs.readdirSync(root).includes('Заказ.class'));
    const r=await exec('java',['-cp','.', 'Заказ'],{cwd:root,env,timeoutMs:20000});
    assert.equal(r.code,0,r.out);assert.ok(r.out.includes('客户'));assert.ok(!r.out.includes('????'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
