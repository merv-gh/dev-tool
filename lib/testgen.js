// Test context for a code part of a workspace: the source, what it depends on (and their methods), what
// the part calls on them, the Spring role and the test style that fits it, the project's test setup
// (JUnit, Mockito, AssertJ, Boot version, Testcontainers), an existing test to copy the style from, the
// tables it touches with a DDL snapshot to load, and a skeleton test that compiles and runs as it is.
// The model fills in the given/when/then; test_run runs it.
//
// Styles (Spring Boot conventions):
//   unit      plain JUnit 5, no Spring: logic without dependencies
//   mockito   @ExtendWith(MockitoExtension), @Mock each dependency, @InjectMocks the subject
//             (services, components, Kafka listeners: call the listener method directly)
//   webmvc    @WebMvcTest(Controller) + MockMvc, dependencies as @MockBean (@MockitoBean on Boot 3.4+)
//   jpa       @DataJpaTest against the real schema (DDL snapshot), no in-memory db
//   jdbc      @JdbcTest + @Import(Dao) against the real schema
const fs = require('fs');
const path = require('path');
const W = require('./workspace');

const findClass = (g, t) => {
  const [cls] = String(t).split(/#|::/);
  const all = g.classes.filter(c => c.id === cls || c.id.endsWith(`.${cls}`) || c.name === cls || c.file === cls || c.file.endsWith(`/${cls}`));
  return all.filter(c => !c.test).concat(all.filter(c => c.test));
};

function style(c, g, deps) {
  if (c.role === 'controller') return 'webmvc';
  if (c.role === 'repository' && c.kind === 'interface') return 'jpa';
  if (deps.some(d => /^(JdbcTemplate|NamedParameterJdbcTemplate|JdbcClient|DataSource|EntityManager)$/.test(baseName(d.type)))) return 'jdbc';
  if (deps.length) return 'mockito';
  return 'unit';
}

const baseName = (t) => String(t || '').replace(/<[\s\S]*$/, '').split('.').pop().trim();

// Build setup of the module that holds a file: nearest pom.xml / build.gradle(.kts) up from it
function moduleOf(root, file) {
  let dir = path.dirname(path.join(root, file));
  while (dir.startsWith(root)) {
    for (const f of ['pom.xml', 'build.gradle.kts', 'build.gradle']) if (fs.existsSync(path.join(dir, f))) return { dir: path.relative(root, dir).split(path.sep).join('/') || '.', buildFile: f, text: fs.readFileSync(path.join(dir, f), 'utf8') };
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return { dir: '.', buildFile: null, text: '' };
}

function setup(root, mod, app) {
  const all = [mod.text, fs.existsSync(path.join(root, 'pom.xml')) ? fs.readFileSync(path.join(root, 'pom.xml'), 'utf8') : '', ...['build.gradle', 'build.gradle.kts'].filter(f => fs.existsSync(path.join(root, f))).map(f => fs.readFileSync(path.join(root, f), 'utf8'))].join('\n');
  const boot = app?.springBoot || (all.match(/spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)/) || all.match(/org\.springframework\.boot['"]?\s*\)?\s*version\s*['"]([^'"]+)/) || [])[1] || null;
  const [maj, min] = String(boot || '0.0').split('.').map(Number);
  const has = (re) => re.test(all);
  return {
    springBoot: boot,
    starterTest: has(/spring-boot-starter-test/),
    junit: has(/junit:junit|junit<\/artifactId>\s*<version>4/) && !has(/junit-jupiter|spring-boot-starter-test/) ? 4 : 5,
    mockito: has(/mockito|spring-boot-starter-test/),
    assertj: has(/assertj|spring-boot-starter-test/),
    testcontainers: has(/testcontainers/),
    mockk: has(/mockk/),
    mockBean: maj > 3 || (maj === 3 && min >= 4) ? 'MockitoBean' : 'MockBean',
    buildTool: mod.buildFile ? (mod.buildFile === 'pom.xml' ? 'maven' : 'gradle') : null,
  };
}

// default argument values that compile
function argFor(type, ctx, name) {
  const t = String(type).trim();
  const b = baseName(t);
  // the module's TestData (test_data): its id constants and its valid objects
  const td = ctx.testData;
  if (td) {
    const concept = name && (/^id$/i.test(name) ? ctx.concept : (String(name).match(/^(\w+?)Id$/) || [])[1]);
    const id = concept && `${concept.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_ID`;
    if (id && td.ids.has(id) && /^(long|Long)$/.test(b)) return `TestData.${id}`;
    if (id && td.ids.has(id) && b === 'String' && td.parsed.has(name)) return `String.valueOf(TestData.${id})`;
    if (td.byType.has(b)) return `TestData.${td.byType.get(b)}()`;
    if (b === 'String' && ctx.topic && td.messages?.has(ctx.topic)) return `TestData.${td.messages.get(ctx.topic)}()`;
  }
  const imported = (n) => ctx.imports.has(n) || ctx.samePkg.has(n);
  const fq = (pkg, n) => (imported(n) ? n : `${pkg}.${n}`);
  const P = { long: '1L', Long: '1L', int: '1', Integer: '1', short: '(short) 1', Short: '(short) 1', byte: '(byte) 1', double: '1.0', Double: '1.0', float: '1.0f', Float: '1.0f', boolean: 'false', Boolean: 'false', char: "'a'", String: '"test"', Object: 'new Object()', CharSequence: '"test"' };
  if (/\[\]$/.test(t)) return `new ${t.replace(/\[\]$/, '[0]')}`;
  if (P[b] && !t.includes('<')) return P[b];
  const J = {
    BigDecimal: () => `new ${fq('java.math', 'BigDecimal')}("10.00")`, BigInteger: () => `${fq('java.math', 'BigInteger')}.ONE`,
    UUID: () => `${fq('java.util', 'UUID')}.randomUUID()`, List: () => `${fq('java.util', 'List')}.of()`, Set: () => `${fq('java.util', 'Set')}.of()`, Collection: () => `${fq('java.util', 'List')}.of()`,
    Map: () => `${fq('java.util', 'Map')}.of()`, Optional: () => `${fq('java.util', 'Optional')}.empty()`,
    LocalDate: () => `${fq('java.time', 'LocalDate')}.of(2026, 1, 15)`, LocalDateTime: () => `${fq('java.time', 'LocalDateTime')}.of(2026, 1, 15, 10, 0)`, Instant: () => `${fq('java.time', 'Instant')}.parse("2026-01-15T10:00:00Z")`,
    OffsetDateTime: () => `${fq('java.time', 'OffsetDateTime')}.parse("2026-01-15T10:00:00Z")`, ZonedDateTime: () => `${fq('java.time', 'ZonedDateTime')}.parse("2026-01-15T10:00:00Z")`, Duration: () => `${fq('java.time', 'Duration')}.ofSeconds(1)`,
  };
  if (J[b]) return J[b]();
  const c = ctx.byName.get(b);
  if (c) {
    if (c.kind === 'enum') return `${b}.values()[0]`;
    if (c.kind === 'interface') return `mock(${b}.class)`;
    if (c.kind === 'record' && c.ctor.length) return `new ${b}(${c.ctor.map(p => argFor(p.type, ctx)).join(', ')})`;
    const ctors = c.methods.filter(m => m.ctor && !m.mods.includes('private') && !m.mods.includes('protected'));
    const easiest = ctors.sort((x, y) => x.params.length - y.params.length)[0];
    if (easiest) return `new ${b}(${easiest.params.map(p => argFor(p.type, ctx)).join(', ')})`;
    if (!c.methods.some(m => m.ctor)) return `new ${b}()`;
  }
  return 'null';
}

// boundary values to try, by parameter type
const BOUNDS = { BigDecimal: ['0.00', '0.01', '1.00', '12.345', '-1.00'], int: ['0', '1', '-1', '2147483647'], Integer: ['0', '1', '-1'], long: ['0', '1', '-1'], Long: ['0', '1', '-1'], String: ["''", "' '", 'x'], boolean: ['true', 'false'], Boolean: ['true', 'false'], double: ['0.0', '0.1', '-1.0'] };

const indent = (s, n) => s.split('\n').map(l => (l ? ' '.repeat(n) + l : l)).join('\n');
// test method names: not the names of statically imported helpers (get, post, status, when, verify...)
const STATIC = new Set(['get', 'post', 'put', 'delete', 'patch', 'status', 'content', 'jsonPath', 'when', 'verify', 'mock', 'spy', 'reset', 'times', 'never', 'any', 'eq', 'assertThat', 'request', 'header']);
const testName = (m, i, all, suffix = '') => {
  let n = m.name + suffix;
  if (STATIC.has(n)) n += 'Test';
  return all.filter(x => x.name === m.name).length > 1 ? `${n}${i}` : n;
};

function javaSkeleton({ c, g, s, st, methods, deps, ctx, calls, ddl, db }) {
  const imports = new Set(ctx.fileImports.filter(i => !/^static /.test(i)).map(i => `import ${i};`));
  const add = (...xs) => xs.forEach(x => imports.add(`import ${x};`));
  const statics = new Set();
  const lines = [];
  const name = `${c.name}Test`;
  const fields = [];
  const ann = [];
  const mockBean = s.mockBean === 'MockitoBean' ? 'org.springframework.test.context.bean.override.mockito.MockitoBean' : 'org.springframework.boot.test.mock.mockito.MockBean';
  add('org.junit.jupiter.api.Test');
  if (s.assertj) statics.add('import static org.assertj.core.api.Assertions.assertThat;');
  statics.add('import static org.mockito.ArgumentMatchers.any;');
  statics.add('import static org.mockito.Mockito.*;');
  if (st === 'mockito') {
    if ([...(ctx.stubs?.values() || [])].flat().some(x => x.includes('returnsFirstArg'))) statics.add('import static org.mockito.AdditionalAnswers.returnsFirstArg;');
    if ([...(ctx.stubs?.values() || [])].flat().some(x => x.includes('Optional.'))) add('java.util.Optional');
    if ([...(ctx.stubs?.values() || [])].flat().some(x => x.includes('List.of('))) add('java.util.List');
    add('org.junit.jupiter.api.extension.ExtendWith', 'org.mockito.InjectMocks', 'org.mockito.Mock', 'org.mockito.junit.jupiter.MockitoExtension');
    ann.push('@ExtendWith(MockitoExtension.class)');
    for (const d of deps) {
      if (/^(String|int|long|Integer|Long|boolean|Boolean)$/.test(baseName(d.type))) continue; // @Value config: set below
      fields.push(`@Mock\n${d.type} ${d.name};`);
    }
    fields.push(`@InjectMocks\n${c.name} subject;`);
  } else if (st === 'webmvc') {
    add('org.springframework.beans.factory.annotation.Autowired', 'org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest', 'org.springframework.test.web.servlet.MockMvc', 'org.springframework.http.MediaType', mockBean);
    statics.add('import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;');
    statics.add('import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;');
    ann.push(`@WebMvcTest(${c.name}.class)`);
    fields.push('@Autowired\nMockMvc mvc;');
    for (const d of deps) fields.push(`@${s.mockBean}\n${d.type} ${d.name};`);
  } else if (st === 'jpa' || st === 'jdbc') {
    add('org.springframework.beans.factory.annotation.Autowired', 'org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase', 'org.springframework.jdbc.core.JdbcTemplate');
    if (st === 'jpa') { add('org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest'); ann.push('@DataJpaTest'); }
    else { add('org.springframework.boot.test.autoconfigure.jdbc.JdbcTest', 'org.springframework.context.annotation.Import'); ann.push('@JdbcTest', `@Import(${c.name}.class)`); }
    ann.push('@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)');
    if (s.testcontainers && ddl) {
      add('org.testcontainers.containers.PostgreSQLContainer', 'org.testcontainers.junit.jupiter.Container', 'org.testcontainers.junit.jupiter.Testcontainers', 'org.springframework.test.context.DynamicPropertyRegistry', 'org.springframework.test.context.DynamicPropertySource');
      ann.push('@Testcontainers');
      fields.push(`@Container\nstatic PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16-alpine").withInitScript("${ddl.resource}");`);
      fields.push('@DynamicPropertySource\nstatic void db(DynamicPropertyRegistry r) {\n    r.add("spring.datasource.url", pg::getJdbcUrl);\n    r.add("spring.datasource.username", pg::getUsername);\n    r.add("spring.datasource.password", pg::getPassword);\n}');
    }
    fields.push(`@Autowired\n${c.name} subject;`, '@Autowired\nJdbcTemplate jdbc;');
  } else {
    fields.push(`${c.name} subject = ${argFor(c.name, ctx).replace(/^null$/, `new ${c.name}()`)};`);
  }

  const body = [];
  methods.forEach((m, i) => {
    const topic = (g.edges.find(e => e[0] === `${c.id}#${m.name}` && e[2] === 'consumes') || [])[1]?.replace(/^topic:/, '');
    const call = `subject.${m.name}(${m.params.map(p => argFor(p.type, { ...ctx, topic }, p.name)).join(', ')})`;
    const ret = m.ret && m.ret !== 'void';
    const hint = (calls.get(m.name) || []).map(x => `//   ${x}`).join('\n');
    const throwsChecked = /throws\s/.test(m.throws || '');
    const t = [];
    t.push('@Test');
    if (st === 'webmvc') {
      const ep = (g.endpointsOf.get(m.name) || [])[0];
      if (!ep) return;
      const [verb, p] = ep.split(' ');
      const args = (p.match(/\{[^}]*\}/g) || []).map(() => '1');
      const builder = { GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete', PATCH: 'patch' }[verb] || 'get';
      const bodyParam = m.params.find(x => x.annos?.includes('RequestBody')) || (/(POST|PUT|PATCH)/.test(verb) ? m.params.find(x => !/^(Long|long|String|Integer|int|UUID)$/.test(baseName(x.type))) : null);
      const expect = m.annos.includes('ResponseStatus') ? (m.status || 'isCreated') : 'isOk';
      t.push(`void ${testName(m, i, methods, `Returns${expect.replace(/^is/, '')}`)}() throws Exception {`);
      t.push(`    // given${hint ? ': the controller calls\n' + indent(hint, 4) : ''}`);
      t.push(`    mvc.perform(${builder}("${p.replace(/\{[^}]*\}/g, '{id}')}"${args.length ? ', ' + args.join(', ') : ''})${bodyParam ? '\n            .contentType(MediaType.APPLICATION_JSON)\n            .content("{}")' : ''})`);
      t.push(`        .andExpect(status().${expect}());`);
      t.push('    // then: verify(...) the service call, check the JSON with jsonPath(...)');
      t.push('}');
    } else {
      t.push(`void ${testName(m, i, methods)}()${throwsChecked ? ' throws Exception' : ''} {`);
      if (st === 'jpa' || st === 'jdbc') {
        t.push(`    // given: rows the query needs (the test runs in a transaction that is rolled back)`);
        for (const ins of (db?.inserts || []).slice(0, 4)) t.push(`    // jdbc.update(${JSON.stringify(ins.sql)}${ins.args.length ? ', ' + ins.args.join(', ') : ''});`);
      } else t.push(`    // given${hint ? `: ${m.name} calls\n${indent(hint, 4)}` : ''}`);
      for (const stub of (st === 'mockito' && ctx.stubs?.get(m.name)) || []) t.push(`    ${stub}`);
      t.push(`    ${ret ? `var result = ${call};` : `${call};`}`);
      if (st === 'mockito') t.push('    // then: assertThat(result)... and verify(...) the calls that matter');
      else if (ret && s.assertj) t.push('    // then', '    assertThat(result).isNotNull();');
      else t.push('    // then');
      t.push('}');
    }
    body.push(indent(t.join('\n'), 4));
    // pure logic of simple values: many cases in one parameterized test
    const simple = m.params.length && m.params.every(p => BOUNDS[baseName(p.type)]);
    if ((st === 'unit' || (st === 'mockito' && !(calls.get(m.name) || []).length)) && simple && m.ret && m.ret !== 'void') {
      const rows = BOUNDS[baseName(m.params[0].type)].map(v => `"${[v, ...m.params.slice(1).map(p => BOUNDS[baseName(p.type)][1])].join(', ')}, ?"`);
      const conv = (p) => (baseName(p.type) === 'BigDecimal' ? `new BigDecimal(${p.name})` : p.name);
      const typ = (p) => (baseName(p.type) === 'BigDecimal' ? 'String' : p.type);
      body.push(indent([
        `// Boundaries of ${m.name} in one test (needs junit-jupiter-params, in spring-boot-starter-test): fill in the expected values`,
        '// @ParameterizedTest',
        `// @CsvSource({ ${rows.join(', ')} })`,
        `// void ${m.name}Cases(${[...m.params.map(p => `${typ(p)} ${p.name}`), `String expected`].join(', ')}) {`,
        `//     assertThat(subject.${m.name}(${m.params.map(conv).join(', ')})${baseName(m.ret) === 'BigDecimal' ? '.toPlainString()' : ''}).isEqualTo(${/^(int|long|Integer|Long)$/.test(baseName(m.ret)) ? 'Long.parseLong(expected)' : baseName(m.ret) === 'boolean' || baseName(m.ret) === 'Boolean' ? 'Boolean.parseBoolean(expected)' : 'expected'});`,
        '// }',
      ].join('\n'), 4));
    }
  });
  const note = {
    mockito: `Unit test of ${c.name}: its dependencies are mocks (Mockito strict stubs: stub only what the method uses).`,
    webmvc: `Web layer test of ${c.name}: MockMvc against the controller only; its dependencies are ${s.mockBean}s.`,
    jpa: `Repository test of ${c.name} against the real schema${s.testcontainers ? ` (Testcontainers + ${ddl?.resource})` : ` from SPRING_DATASOURCE_URL (dt test_run loads ${ddl?.resource || 'the DDL snapshot'} into a throwaway database)`}.`,
    jdbc: `JDBC test of ${c.name} against the real schema${s.testcontainers ? ` (Testcontainers + ${ddl?.resource})` : ` from SPRING_DATASOURCE_URL (dt test_run loads ${ddl?.resource || 'the DDL snapshot'} into a throwaway database)`}.`,
    unit: `Unit test of ${c.name}.`,
  }[st];
  const pkg = c.id.slice(0, c.id.length - c.name.length - 1);
  return [
    pkg ? `package ${pkg};\n` : '',
    [...imports].sort().join('\n'),
    '',
    [...statics].sort().join('\n'),
    '',
    `// ${note}`,
    ...ann,
    `class ${name} {`,
    indent(fields.join('\n\n'), 4),
    '',
    body.join('\n\n'),
    '}',
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

// Example inserts for tables (parents first): columns that need a value (not null, no default)
function inserts(cat, tables) {
  const by = new Map(cat.tables.map(t => [`${t.schema}.${t.name}`.toLowerCase(), t]));
  const order = [], seen = new Set();
  const visit = (k) => {
    if (seen.has(k) || !by.has(k)) return;
    seen.add(k);
    for (const c of by.get(k).constraints || []) if (c.type === 'f' && c.ref) visit(c.ref.toLowerCase());
    order.push(k);
  };
  tables.forEach(visit);
  const val = (type) => (/int|serial/.test(type) ? '1L' : /numeric|decimal|double|real/.test(type) ? 'new java.math.BigDecimal("10.00")' : /bool/.test(type) ? 'true' : /timestamp|date/.test(type) ? 'java.sql.Timestamp.from(java.time.Instant.now())' : /uuid/.test(type) ? 'java.util.UUID.randomUUID()' : /json/.test(type) ? '"{}"' : '"test"');
  return order.map(k => {
    const t = by.get(k);
    const cols = t.columns.filter(c => !c.nullable && !c.default && !c.identity);
    const checks = (t.constraints || []).filter(c => c.type === 'c').map(c => c.def);
    return { table: k, sql: `insert into ${k} (${cols.map(c => c.name).join(', ')}) values (${cols.map(() => '?').join(', ')})`, args: cols.map(c => val(c.type)), checks };
  });
}

function context(id, target, { env, db: dbName, writeDdl = true, flow, allFunctions } = {}) {
  const m = W.checkId(id);
  // a whole flow: an endpoint, a class of a library, or asked for
  const wg = W.index(id).graph_();
  const [tc, tm] = String(target).split(/#|::/);
  const entryMethod = tm && findClass(wg, tc)[0]?.methods.find(x => x.name === tm && x.annos.some(a => /^(Scheduled|KafkaListener|EventListener|TransactionalEventListener|RabbitListener|JmsListener|SqsListener)$/.test(a)));
  if (flow !== false && (flow || entryMethod || /^(GET|POST|PUT|DELETE|PATCH|ANY)\s+\//i.test(String(target)) || /^(kafka|scheduled|event|queue)\s/.test(String(target)) || !findClass(wg, target).length)) {
    const fc = flowContext(id, target);
    if (fc) return fc;
  }
  const idx = W.index(id);
  const g = idx.graph_();
  const found = findClass(g, target);
  if (!found.length) {
    const words = String(target).toLowerCase().split(/[#.\s/]+/).filter(Boolean);
    const cands = g.classes.filter(c => words.some(w => c.id.toLowerCase().includes(w))).slice(0, 15).map(c => c.id);
    throw new Error(`no class "${target}" in workspace ${id}${cands.length ? `; similar: ${cands.join(', ')}` : ''}${(m.libs || []).length ? '' : '. If it is library code: build the service\'s passport (it indexes its libraries), or workspace_open libraries=true'}`);
  }
  const c = found[0];
  const member = String(target).split(/#|::/)[1];
  const root = m.path;
  const src = fs.readFileSync(path.join(root, c.file), 'utf8');
  const srcLines = src.split('\n');
  const byName = new Map(g.classes.filter(x => !x.test).map(x => [x.name, x]));
  const deps = [];
  const seenDep = new Set();
  for (const p of c.bean ? c.ctor : []) if (!seenDep.has(p.name)) { seenDep.add(p.name); deps.push({ name: p.name, type: p.type, typeId: p.typeId }); }
  for (const f of c.fields) if (f.inject && !seenDep.has(f.name)) { seenDep.add(f.name); deps.push({ name: f.name, type: f.type, typeId: f.typeId }); }
  const st = style(c, g, deps);
  const pub = (x) => !x.ctor && !x.mods.includes('private') && x.name !== 'main';
  let methods = c.methods.filter(x => pub(x) && !x.abstract || (c.kind === 'interface' && !x.ctor));
  if (member) methods = c.methods.filter(x => x.name === member);
  if (member && !methods.length) throw new Error(`no method ${member} in ${c.id}; it has ${c.methods.filter(x => !x.ctor).map(x => x.name).join(', ')}`);

  // what each method calls on the dependencies (stubs it needs)
  const calls = new Map();
  const depByType = new Map(deps.map(d => [d.typeId, d]));
  for (const x of methods) {
    const out = [];
    for (const [from, to, kind] of g.edges) {
      if (from !== `${c.id}#${x.name}` || kind !== 'calls') continue;
      const [tid, mname] = to.split('#');
      const d = depByType.get(tid) || deps.find(dd => `ext:${dd.type.replace(/<.*$/, '')}` === tid || dd.typeId === tid);
      if (!d) continue;
      const dc = g.classes.find(k => k.id === tid);
      const dm = dc?.methods.find(k => k.name === mname);
      out.push(`${d.name}.${mname}(${dm ? dm.params.map(p => `${p.type} ${p.name}`).join(', ') : '...'})${dm?.ret ? ` -> ${dm.ret}` : ''}`);
    }
    calls.set(x.name, [...new Set(out)]);
  }
  // public methods of internal dependencies (what can be stubbed)
  const depApi = deps.map(d => {
    const dc = g.classes.find(k => k.id === d.typeId);
    return { name: d.name, type: d.type, internal: !!dc, file: dc?.file, kind: dc?.kind, methods: dc ? dc.methods.filter(pub).map(k => `${k.ret ? k.ret + ' ' : ''}${k.name}(${k.params.map(p => `${p.type} ${p.name}`).join(', ')})`) : undefined };
  });
  // endpoints of controller methods
  g.endpointsOf = new Map();
  for (const [from, to, kind] of g.edges) if (kind === 'handler' && to.startsWith(`${c.id}#`)) {
    const mn = to.split('#')[1];
    (g.endpointsOf.get(mn) || g.endpointsOf.set(mn, []).get(mn)).push(from.replace(/^endpoint:/, ''));
  }
  // the real path (with names of path variables) from the source
  for (const x of methods) {
    const raw = srcLines.slice(Math.max(0, x.startLine - 1), x.line).join('\n');
    const mm = raw.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)")?/);
    const base = (src.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"/) || [])[1] || '';
    if (mm && g.endpointsOf.has(x.name)) g.endpointsOf.set(x.name, [`${mm[1].toUpperCase()} ${(base + '/' + (mm[2] || '')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1')}`]);
    const rs = raw.match(/@ResponseStatus\s*\(\s*(?:value\s*=\s*|code\s*=\s*)?HttpStatus\.(\w+)/);
    if (rs) x.status = { CREATED: 'isCreated', NO_CONTENT: 'isNoContent', ACCEPTED: 'isAccepted', OK: 'isOk' }[rs[1]] || 'is2xxSuccessful';
    const ps = raw.match(/\(([\s\S]*)\)\s*(throws[^{]*)?\{?\s*$/);
    if (ps) { x.throws = ps[2] || ''; for (const p of x.params) p.annos = (ps[1].match(new RegExp(`((?:@\\w+(?:\\([^)]*\\))?\\s+)*)(?:final\\s+)?[\\w.<>,\\s\\[\\]?]+\\s+${p.name}\\b`)) || ['', ''])[1].match(/@(\w+)/g)?.map(a => a.slice(1)) || []; }
  }

  // tables this class touches, for the db styles (and the snapshot to load)
  const tables = new Set();
  const own = (from) => from === c.id || from.startsWith(`${c.id}#`) || from.startsWith(`${c.id}.`);
  for (const [from, to] of g.edges) if (own(from) && to.startsWith('table:')) tables.add(to.slice(6));
  if (c.role === 'repository') for (const [from, to, kind] of g.edges) if (from === c.id && kind === 'repository') { const ent = g.classes.find(k => k.id === to); if (ent?.table) tables.add(ent.table); }
  const fnCalls = new Set();
  for (const [from, to] of g.edges) if (own(from) && to.startsWith('pgfn:')) fnCalls.add(to.slice(5));

  const mod = moduleOf(root, c.file);
  const s = setup(root, mod, g.app);
  let ddl = null, db = null;
  if ((st === 'jpa' || st === 'jdbc' || tables.size) && env) {
    const pg = require('./pg');
    const cats = pg.loadAll(env);
    const { namesOf, resolve } = require('./pgindex');
    const has = (cat) => [...tables].some(t => resolve(namesOf(cat).rel, namesOf(cat).relBy, t).keys.length) || [...fnCalls].some(f => resolve(namesOf(cat).fn, namesOf(cat).fnBy, f).keys.length);
    const cat = dbName ? cats.find(x => x.db === dbName) : cats.find(has);
    if (cat) {
      const resource = `dt-schema/${cat.db}.sql`;
      const rel = `${mod.dir === '.' ? '' : mod.dir + '/'}src/test/resources/${resource}`;
      // one snapshot per db and module, extended by each test that needs more
      const D = require('./ddl');
      const prev = fs.existsSync(path.join(root, rel)) ? D.requested(fs.readFileSync(path.join(root, rel), 'utf8')) : null;
      const want = { tables: [...tables].filter(t => resolve(namesOf(cat).rel, namesOf(cat).relBy, t).keys.length), functions: [...fnCalls].filter(f => resolve(namesOf(cat).fn, namesOf(cat).fnBy, f).keys.length), views: [] };
      // every function of the schemas these tables are in (code calls them through SQL dt may not see)
      if (allFunctions !== false) {
        const schemas = new Set(want.tables.flatMap(t => resolve(namesOf(cat).rel, namesOf(cat).relBy, t).keys).map(k => k.split('.')[0]));
        want.functions = [...new Set([...want.functions, ...(cat.functions || []).filter(f => schemas.has(f.schema.toLowerCase()) && f.kind !== 'aggregate' && f.kind !== 'window').map(f => `${f.schema}.${f.name}`)])];
      }
      if (prev) for (const k of ['tables', 'functions', 'views']) want[k] = [...new Set([...prev[k], ...want[k]])];
      const snap = D.snapshot(env, cat.db, want);
      if (writeDdl) W.write(id, rel, { content: snap.sql });
      ddl = { db: cat.db, env, resource, path: rel, written: writeDdl, counts: snap.counts, tables: snap.tables, functions: snap.functions };
      db = { inserts: inserts(cat, snap.tables.filter(t => [...tables].some(x => t === x || t.endsWith(`.${x}`)))) };
    } else ddl = { note: `no synced database in ${env} has ${[...tables].join(', ')}: catalog_sync what=pg, then pass db=` };
  } else if (st === 'jpa' || st === 'jdbc') ddl = { note: 'pass env (and db) to get the DDL snapshot for this test' };

  const testData = readTestData(root, g);
  // stubs the method needs from what TestData has: a repository's reads give its entity, save gives back its argument
  const stubs = new Map();
  if (testData) for (const x of methods) {
    const out = [];
    for (const e of g.edges) {
      const [from, to, kind] = e;
      if (from !== `${c.id}#${x.name}` || kind !== 'calls') continue;
      const [tid, mname] = to.split('#');
      const d = depByType.get(tid);
      if (!d) continue;
      const dc = g.classes.find(k => k.id === tid);
      const dm = dc?.methods.find(k => k.name === mname);
      const entityId = g.edges.find(r => r[0] === tid && r[2] === 'repository')?.[1];
      const entity = entityId && g.classes.find(k => k.id === entityId)?.name;
      const body = srcLines.slice(Math.max(0, x.startLine - 1), x.endLine).join('\n');
      const reads = readsOf(g, root, tid, mname, entityId);
      const line = stubOf({ mock: d.name, method: mname, params: dm ? dm.params.map(p => p.type) : null, arity: e[4] ?? (/^(findAll|count|flush)$/.test(mname) ? 0 : 1), ret: dm?.ret, entity, body, ...reads }, testData);
      if (line) out.push(line);
    }
    if (out.length) stubs.set(x.name, [...new Set(out)]);
  }
  const kt = /\.kt$/.test(c.file);
  const fileImports = [...src.matchAll(/^\s*import\s+(static\s+)?([\w.*]+)\s*;?\s*$/gm)].map(x => (x[1] ? 'static ' : '') + x[2]);
  const ctx = { imports: new Set(fileImports.map(i => i.split('.').pop())), samePkg: new Set(g.classes.filter(x => x.id === `${c.id.slice(0, c.id.length - c.name.length)}${x.name}`).map(x => x.name)), byName, fileImports, testData, stubs, concept: c.name.replace(/(Service|Controller|Resource|Listener|Handler|Dao|Repository|Impl)$/, '') };
  const testDir = c.file.replace(/(^|\/)src\/main\/(java|kotlin)\//, `$1src/test/$2/`);
  const testPath = testDir.replace(/\.(java|kt)$/, `Test.$1`);
  const existing = fs.existsSync(path.join(root, testPath));
  let skeleton = kt ? null : javaSkeleton({ c, g, s, st, methods, deps, ctx, calls, ddl, db });
  const pkgOf = (x) => x.id.slice(0, x.id.length - x.name.length - 1);
  if (skeleton && testData && /\bTestData\./.test(skeleton) && testData.pkg !== pkgOf(c)) skeleton = skeleton.replace(/^(package [^\n]+\n\n)/, `$1import ${testData.pkg ? testData.pkg + '.' : ''}TestData;\n`);
  const example = exampleTest(root, mod.dir, c.file);

  const focus = member ? methods[0] : null;
  const from = focus ? Math.max(1, focus.startLine - 2) : 1;
  const to = focus ? focus.endLine + 1 : srcLines.length;
  return {
    workspace: id, class: c.id, file: c.file, role: c.role, kind: c.kind, style: st,
    source: (focus ? srcLines.slice(0, Math.min(srcLines.length, c.line + 1)).join('\n') + '\n    ...\n' : '') + srcLines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(4)}  ${l}`).join('\n'),
    methods: methods.map(x => ({ name: x.name, signature: `${x.ret ? x.ret + ' ' : ''}${x.name}(${x.params.map(p => `${p.type} ${p.name}`).join(', ')})`, lines: `${x.startLine}-${x.endLine}`, calls: calls.get(x.name) || [], endpoint: g.endpointsOf.get(x.name)?.[0] })),
    dependencies: depApi,
    callees: callees(g, root, c, methods),
    tables: [...tables], functions: [...fnCalls],
    setup: { ...s, module: mod.dir, buildFile: mod.buildFile },
    ddl, inserts: db?.inserts,
    test: { path: testPath, exists: existing, class: `${c.id}Test` },
    skeleton: skeleton || undefined,
    example,
    testData: testData ? { path: testData.path, factories: Object.fromEntries(testData.byType), ids: [...testData.ids], note: 'valid objects and ids for the arguments and stubs (used in the skeleton); TestData.with(x, "field", value) for variants' } : { note: 'no TestData in this module: test_data generates valid objects for the service\'s bodies, events and rows (with env: from the database)' },
    rules: rules(st, s, kt),
    next: `Write the test with workspace_write path="${testPath}"${existing ? ' (it exists: read it first and add to it, or use another name)' : ''}, then test_run tests=["${c.name}Test"]${ddl?.db ? ` env="${env}"` : ''}.`,
  };
}

// One stub from TestData for a call on a mock, or null when TestData has nothing for what it returns:
// a read gives TestData's object (Optional.empty() when the caller only checks presence), save its argument.
// call: { mock, method, params (types, or null), arity, ret, entity (of a repository), body (of the caller) }
function stubOf(call, td) {
  const { mock, method, params, arity, entity, body } = call;
  const any = (pt) => ({ long: 'anyLong()', int: 'anyInt()', boolean: 'anyBoolean()', double: 'anyDouble()', short: 'anyShort()' }[pt] || 'any()');
  const args = params ? params.map(any).join(', ') : Array(arity ?? 1).fill('any()').join(', ');
  const ret = call.ret || (entity ? { findById: `Optional<${entity}>`, getReferenceById: entity, getById: entity, findAll: `List<${entity}>`, save: 'arg', saveAndFlush: 'arg' }[method] : null);
  if (!ret || ret === 'void') return null;
  const on = `${mock}.${method}(${args})`;
  if (ret === 'arg' || (/^(save|saveAndFlush|merge)$/.test(method) && (params ? params.length : arity) === 1)) return `when(${on}).thenAnswer(returnsFirstArg());`;
  const inner = baseName(ret.replace(/^(Optional|List|Set|Collection)<\s*([\s\S]+)>$/, '$2'));
  // a read of a dictionary: its rows as TestData has them (the active ones when the query asks for those)
  const tableIs = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  const dicts = (td.dicts || []).filter(d => d.type === inner && (call.tables || []).some(t => tableIs(d.table, t)));
  if (dicts.length) {
    const pick = (k) => dicts.find(d => d.kind === k)?.factory;
    const many = /^(List|Collection|Iterable|Set)</.test(ret);
    const f = many ? (call.active && pick('active')) || pick('all') : pick('one');
    if (f) return `when(${on}).thenReturn(${many ? (/^Set</.test(ret) ? `java.util.Set.copyOf(TestData.${f}())` : `TestData.${f}()`) : /^Optional</.test(ret) ? `Optional.of(TestData.${f}())` : `TestData.${f}()`});`;
  }
  const f = td.byType.get(inner);
  if (!f) return null;
  const guard = body && new RegExp(`${mock}\\.${method}\\([^;]*?\\)\\s*\\.(isPresent|isEmpty)\\(`).test(body);
  const v = /^Optional</.test(ret) ? (guard ? 'Optional.empty()' : `Optional.of(TestData.${f}())`) : /^(List|Collection|Iterable)</.test(ret) ? `List.of(TestData.${f}())` : /^Set</.test(ret) ? `java.util.Set.of(TestData.${f}())` : `TestData.${f}()`;
  return `when(${on}).thenReturn(${v});`;
}

// What a method of a dependency reads: the tables its SQL (or its repository's entity) touches, and
// whether it asks for the active rows only (where active, findByActiveTrue)
function readsOf(g, root, typeId, method, entityId) {
  const tables = g.edges.filter(e => e[0] === `${typeId}#${method}` && String(e[1]).startsWith('table:')).map(e => e[1].slice(6));
  const ent = entityId && g.classes.find(k => k.id === entityId);
  if (ent?.table) tables.push(ent.table);
  const dc = g.classes.find(k => k.id === typeId);
  const dm = dc?.methods.find(k => k.name === method);
  let body = '';
  try { if (dm) body = fs.readFileSync(path.join(root, dc.file), 'utf8').split('\n').slice(Math.max(0, dm.startLine - 1), dm.endLine).join('\n'); } catch {}
  return { tables, active: /\bwhere\b[^"]*\b(is_)?(active|enabled)\b/i.test(body) || /Active(True)?\b/.test(method) };
}

// The module's generated TestData (test_data): type -> factory, its id constants, the names it parses
function readTestData(root, g) {
  const tdc = g.classes.find(x => x.test && x.name === 'TestData');
  if (!tdc) return null;
  let text = '';
  try { text = fs.readFileSync(path.join(root, tdc.file), 'utf8'); } catch { return null; }
  const byType = new Map();
  for (const m of text.matchAll(/^\s{4}public static ([\w.]+) (\w+)\(\) \{/gm)) if (!byType.has(m[1].split('.').pop()) && !/^(String|void)$/.test(m[1])) byType.set(m[1].split('.').pop(), m[2]);
  const ids = new Set([...text.matchAll(/public static final \w+ (\w+_ID) =/g)].map(m => m[1]));
  // "// dictionary <table>: an active row | all rows | the active rows" over the factory that gives it
  const dicts = [];
  for (const m of text.matchAll(/^\s{4}\/\/ dictionary (\S+): (an active row|all rows|the active rows)[^\n]*\n\s{4}public static ([\w.<>]+) (\w+)\(\)/gm)) {
    const type = m[3].replace(/^List<(.+)>$/, '$1').split('.').pop();
    dicts.push({ table: m[1], kind: { 'an active row': 'one', 'all rows': 'all', 'the active rows': 'active' }[m[2]], type, factory: m[4] });
  }
  // "// Kafka message <topic> (...)" over the text a listener of that topic is given
  const messages = new Map([...text.matchAll(/^\s{4}\/\/ Kafka message (\S+) [^\n]*\n\s{4}public static String (\w+)\(\)/gm)].map(m => [m[1], m[2]]));
  return { path: tdc.file, pkg: tdc.id.slice(0, tdc.id.length - tdc.name.length - 1), byType, ids, dicts, messages, parsed: require('./testdata').parsedNames(g.classes.filter(x => !x.test).map(x => { try { return fs.readFileSync(path.join(root, x.file), 'utf8'); } catch { return ''; } })) };
}

// The bodies of what the target methods call in the repo (short ones), so assertions need fewer reads
function callees(g, root, c, methods, max = 6) {
  const out = [], seen = new Set();
  const files = new Map();
  const lines = (file) => { if (!files.has(file)) { try { files.set(file, fs.readFileSync(path.join(root, file), 'utf8').split('\n')); } catch { files.set(file, []); } } return files.get(file); };
  for (const m of methods) for (const [from, to, kind] of g.edges) {
    if (from !== `${c.id}#${m.name}` || kind !== 'calls' || seen.has(to) || out.length >= max) continue;
    seen.add(to);
    const [cid, name] = to.split('#');
    const k = g.classes.find(x => x.id === cid);
    const mm = k?.methods.find(x => x.name === name && !x.abstract);
    if (!mm || mm.endLine - mm.startLine > 40) continue;
    out.push({ method: `${k.name}#${name}`, file: `${k.file}:${mm.startLine}`, code: lines(k.file).slice(mm.startLine - 1, mm.endLine).join('\n') });
  }
  return out;
}

function exampleTest(root, modDir, file) {
  const testRoot = path.join(root, modDir === '.' ? '' : modDir, 'src', 'test');
  const near = path.join(root, path.dirname(file).replace(/src\/main\//, 'src/test/'));
  const pick = (dir) => { try { return fs.readdirSync(dir).filter(f => /Test\.(java|kt)$/.test(f)).map(f => path.join(dir, f))[0]; } catch { return null; } };
  let f = pick(near);
  if (!f) {
    (function rec(d, depth) { if (f || depth > 8) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (f) return; if (e.isDirectory()) rec(path.join(d, e.name), depth + 1); else if (/Test\.(java|kt)$/.test(e.name)) f = path.join(d, e.name); } })(testRoot, 0);
  }
  if (!f) return null;
  const text = fs.readFileSync(f, 'utf8').split('\n').slice(0, 60).join('\n');
  return { path: path.relative(root, f).split(path.sep).join('/'), head: text };
}

function rules(st, s, kt) {
  const r = [
    s.junit === 4 ? 'JUnit 4 project: use org.junit.Test, @RunWith(MockitoJUnitRunner.class) / @RunWith(SpringRunner.class).' : 'JUnit 5 (org.junit.jupiter.api.Test); test classes and methods package-private.',
    'One behaviour per test; name it after the behaviour (createChargesTheFee, settleRejectsSettled).',
    s.assertj ? 'Assert with AssertJ assertThat(...); exceptions with assertThatThrownBy(...).isInstanceOf(...).hasMessageContaining(...).' : 'Assert with org.junit.jupiter.api.Assertions.',
  ];
  if (st === 'mockito') r.push('MockitoExtension uses strict stubs: an unused when(...) fails the test; stub only what the method calls. Use any()/eq() matchers consistently in one call.', 'Verify interactions that are the behaviour (verify(events).created(saved)); use ArgumentCaptor to check what was passed.', 'Do not start Spring (@SpringBootTest) for unit tests.');
  if (st === 'webmvc') r.push(`@WebMvcTest starts only the web layer: every bean the controller needs must be a @${s.mockBean}.`, 'Check status, JSON (jsonPath("$.id").value(1)) and that the service got the right arguments.', s.mockBean === 'MockitoBean' ? 'Boot 3.4+: @MockBean is deprecated, use @MockitoBean.' : 'Boot < 3.4: @MockBean (org.springframework.boot.test.mock.mockito).');
  if (st === 'jpa' || st === 'jdbc') r.push('Runs against the real schema (the DDL snapshot), not H2: native SQL, functions and constraints behave as in production.', 'Insert the rows the test needs (parents first, see inserts); @DataJpaTest/@JdbcTest roll back after each test.', 'With JPA, flush (entityManager.flush() / repo.saveAndFlush) before asserting on SQL results.');
  if (kt) r.push('Kotlin: no skeleton is generated; follow the example test. With Mockito use `whenever` from mockito-kotlin if present, or MockK if the project uses it.');
  return r;
}

// ── flow tests ───────────────────────────────────────────────────────────
// An isolated test of one flow: the beans on its chain are real (the service's and its libraries'),
// everything at its edge is a mock (repositories, clients, KafkaTemplate, beans not on the flow), the
// @Value properties come from the service config; it checks what leaves the service.
function flowContext(id, target) {
  const m = W.checkId(id);
  const keys = W.keys(id);
  const F = require('./flows');
  const config = F.serviceConfig(m.path);
  const G = require('./impact').load({ repos: keys });
  const t = String(target).trim();
  const normPath = (p) => p.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
  const all = F.flows(keys, { config });
  let f = null;
  const ep = t.match(/^(GET|POST|PUT|DELETE|PATCH|ANY)\s+(\S+)/i);
  if (ep) {
    const want = normPath(ep[2]).split('/');
    f = all.find(x => { if (x.kind !== 'http') return false; const [v, p] = x.entry.split(' '); const have = p.split('/'); return v === ep[1].toUpperCase() && have.length === want.length && have.every((seg, i) => seg === '{}' || want[i] === '{}' || seg === want[i]); });
  }
  if (!f) f = all.find(x => x.entry === t);
  const [cls, meth] = t.split(/#|::/);
  const classes = [...G.classes.values()].filter(c => !c.test && (c.id === cls || c.name === cls || c.id.endsWith(`.${cls}`)));
  if (!f && classes.length) {
    const ids = classes.flatMap(c => (meth ? [`${c.id}#${meth}`] : c.methods.filter(x => !x.ctor && !x.mods.includes('private')).map(x => `${c.id}#${x.name}`)));
    f = all.find(x => ids.includes(x.method)) || (ids[0] ? F.from(keys, ids[0], { config }) : null);
  }
  if (!f) return null;
  const entryCls = G.classes.get(f.method.split('#')[0]);
  const entryMethod = entryCls.methods.find(x => x.name === f.method.split('#')[1]);
  // the test goes next to the application class (so @WebMvcTest finds the configuration)
  const g = W.index(id).graph_();
  const app = g.classes.find(c => c.role === 'application') || g.classes.find(c => !c.test);
  const pkg = app ? app.id.slice(0, app.id.length - app.name.length - 1) : '';
  const testFile = app ? app.file.replace(/(^|\/)src\/main\/(java|kotlin)\//, '$1src/test/$2/').replace(/[^/]+\.(java|kt)$/, `${entryCls.name}${cap(entryMethod.name)}FlowTest.java`) : `src/test/java/${entryCls.name}FlowTest.java`;
  const s = setup(m.path, moduleOf(m.path, app ? app.file : entryCls.file), g.app);
  const web = f.kind === 'http';
  const imports = new Set(['org.junit.jupiter.api.Test', 'org.springframework.beans.factory.annotation.Autowired', 'org.springframework.context.annotation.Import']);
  const useType = (typeId) => { if (typeId && !typeId.startsWith('ext:') && typeId.slice(0, typeId.lastIndexOf('.')) !== pkg && !/^java\.lang\.[A-Z]/.test(typeId)) imports.add(typeId); if (typeId && typeId.startsWith('ext:') && !/^ext:java\.lang\./.test(typeId)) imports.add(typeId.slice(4).replace(/#.*$/, '')); };
  const beans = f.beans.map(b => G.classes.get(b.id)).filter(Boolean);
  for (const b of beans) useType(b.id);
  for (const k of f.mocks) useType(k.typeId);
  for (const a of [...(entryMethod.params || [])]) useType(a.typeId);
  const mockAnno = s.mockBean === 'MockitoBean' ? 'org.springframework.test.context.bean.override.mockito.MockitoBean' : 'org.springframework.boot.test.mock.mockito.MockBean';
  imports.add(mockAnno);
  const ann = [];
  if (web) {
    imports.add('org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest'); imports.add('org.springframework.test.web.servlet.MockMvc'); imports.add('org.springframework.http.MediaType');
    ann.push(`@WebMvcTest(controllers = ${entryCls.name}.class)`);
  } else { imports.add('org.springframework.test.context.junit.jupiter.SpringJUnitConfig'); ann.push(`@SpringJUnitConfig`); }
  // Jackson as Boot configures it (the web slice has it already)
  if (!web && (f.infra || []).includes('jackson')) { imports.add('org.springframework.boot.autoconfigure.ImportAutoConfiguration'); imports.add('org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration'); ann.push('@ImportAutoConfiguration(JacksonAutoConfiguration.class)'); }
  ann.push(`@Import({${beans.map(b => `${b.name}.class`).join(', ')}})`);
  const props = [...f.properties].sort((a, b) => a.key.localeCompare(b.key)).map(p => `"${p.key}=${p.value ?? (p.hasDefault ? '' : 'TODO')}"`).filter(x => !x.endsWith('="'));
  if (props.length) { imports.add('org.springframework.test.context.TestPropertySource'); ann.push(`@TestPropertySource(properties = {${props.join(', ')}})`); }
  // what the chain calls on each mock: stubs to give, interactions to verify
  const chainIds = new Set(f.chain.map(c => c.method));
  const callsOn = (mock) => {
    const ids = [mock.typeId].filter(Boolean);
    const out = [];
    for (const cm of chainIds) for (const e of G.fwd.get(cm) || []) if (e.kind === 'calls' && ids.some(i => e.to === `${i}#${e.to.split('#')[1]}` && e.to.startsWith(`${i}#`))) out.push({ method: e.to.split('#')[1], arity: e.arity, from: cm.split('.').pop(), fromId: cm });
    return out.filter((x, i) => out.findIndex(y => y.method === x.method && y.arity === x.arity) === i);
  };
  const fields = [web ? '@Autowired\nMockMvc mvc;' : `@Autowired\n${entryCls.name} entry;`];
  const given = [], then = [];
  // TestData (test_data) of the service: the input of the flow and what its mocks return
  const td = readTestData(m.path, g);
  const sourceOf = (cid) => { const c = G.classes.get(cid); if (!c) return null; try { return fs.readFileSync(path.join(m.path, c.file), 'utf8'); } catch { return null; } };
  const bodyOf = (mid) => {
    const [cid, mn] = mid.split('#');
    const c = G.classes.get(cid), text = sourceOf(cid), mt = c?.methods.find(x => x.name === mn);
    return text && mt ? text.split('\n').slice(Math.max(0, mt.startLine - 1), mt.endLine).join('\n') : null;
  };
  const handlerParams = (() => {
    const body = bodyOf(f.method);
    if (!body) return [];
    const TD = require('./testdata');
    const text = TD.noComments(body);
    const at = text.search(new RegExp(`\\b${entryMethod.name}\\s*\\(`));
    if (at < 0) return [];
    const open = text.indexOf('(', at);
    let d = 0, e = open;
    for (; e < text.length; e++) { if (text[e] === '(') d++; else if (text[e] === ')' && --d === 0) break; }
    return TD.splitTop(text.slice(open + 1, e)).map(TD.declaration).filter(Boolean);
  })();
  const tdCtx = td && { imports: new Set(), samePkg: new Set(), byName: new Map(), fileImports: [], testData: td, concept: entryCls.name.replace(/(Controller|Resource|Listener|Handler|Consumer|Job)$/, ''), topic: f.kind === 'kafka' ? f.entry.replace(/^kafka\s+/, '') : null };
  const topics = f.out.produces.map(p => p.topic);
  for (const k of f.mocks) {
    fields.push(`@${s.mockBean}\n${k.type} ${k.name};`);
    for (const c of callsOn(k)) {
      const args = Array.from({ length: c.arity ?? 1 }, () => 'any()');
      if (/KafkaTemplate|StreamBridge/.test(k.type) && topics.length === 1 && args.length) args[0] = `eq("${topics[0]}")`;
      const dc = G.classes.get(k.typeId);
      const ret = dc?.methods.find(x => x.name === c.method)?.ret;
      const entityId = (G.fwd.get(k.typeId) || []).find(e => e.kind === 'repository')?.to;
      const stub = td && stubOf({ mock: k.name, method: c.method, params: dc?.methods.find(x => x.name === c.method)?.params.map(p => p.type) || null, arity: c.arity, ret, entity: entityId && G.classes.get(entityId)?.name, body: bodyOf(c.fromId), ...readsOf(g, m.path, k.typeId, c.method, entityId) }, td);
      if (stub) given.push(`${stub}  // used by ${c.from}`);
      else if (ret && ret !== 'void') given.push(`// when(${k.name}.${c.method}(${args.join(', ')})).thenReturn(...);  // ${ret}, used by ${c.from}`);
      else if (!dc && /^(find|get|load|query|exchange|retrieve|postFor|getFor|select)/.test(c.method)) given.push(`// when(${k.name}.${c.method}(${args.join(', ')})).thenReturn(...);  // used by ${c.from}`);
      then.push(`// verify(${k.name}).${c.method}(${args.join(', ')});  // ${k.why}, from ${c.from}`);
    }
  }
  const call = web ? (() => {
    const [verb, p] = f.entry.split(' ');
    let i = 0;
    const path = p.replace(/\{\}/g, () => `{p${++i}}`);
    // path variables and the body from TestData where it has them
    const pathParams = handlerParams.filter(x => x.annos.PathVariable);
    const vars = Array.from({ length: i }, (_, n) => (td && pathParams[n] ? argFor(pathParams[n].type, tdCtx, pathParams[n].name) : '"1"'));
    const bodyParam = handlerParams.find(x => x.annos.RequestBody);
    const bodyFactory = td && bodyParam && td.byType.get(baseName(bodyParam.type));
    const body = /POST|PUT|PATCH/.test(verb) ? `\n            .contentType(MediaType.APPLICATION_JSON)\n            .content(${bodyFactory ? `TestData.json(TestData.${bodyFactory}())` : '"{}"'})` : '';
    return `mvc.perform(${({ GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete', PATCH: 'patch' })[verb] || 'get'}("${path}"${vars.length ? ', ' + vars.join(', ') : ''})${body})\n        .andExpect(status().is2xxSuccessful());`;
  })() : `entry.${entryMethod.name}(${entryMethod.params.map(p => argFor(p.type, tdCtx || { imports: new Set(), samePkg: new Set(), byName: new Map([...G.classes.values()].map(c => [c.name, c])), fileImports: [] }, p.name)).join(', ')});`;
  if (given.some(x => x.includes('Optional.'))) imports.add('java.util.Optional');
  if (given.some(x => /\bList\.of\(/.test(x))) imports.add('java.util.List');
  if (td && td.pkg !== pkg && /TestData\./.test(`${given.join('\n')}${call}`)) imports.add(`${td.pkg ? td.pkg + '.' : ''}TestData`);
  const statics = [...(given.some(x => x.includes('returnsFirstArg')) ? ['import static org.mockito.AdditionalAnswers.returnsFirstArg;'] : []), 'import static org.mockito.ArgumentMatchers.any;', 'import static org.mockito.ArgumentMatchers.eq;', 'import static org.mockito.Mockito.*;', ...(s.assertj ? ['import static org.assertj.core.api.Assertions.assertThat;'] : []), ...(web ? ['import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;', 'import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;'] : [])];
  const outLines = [
    ...f.out.produces.map(p => `topic ${p.topic}${p.raw ? ` (${p.raw})` : ''} from ${p.from}`),
    ...f.out.http.map(h => `HTTP ${h.call} via ${h.via}`),
    ...f.out.external.filter(x => x.kind !== 'kafka').map(x => `${x.kind} ${x.type}.${x.call} from ${x.from}`),
    ...f.out.tables.map(x => `table ${x.table} (${x.access}${x.via.length ? ` via ${x.via.join(', ')}` : ''})`),
    ...f.out.functions.map(x => `db function ${x.function}`),
  ];
  const skeleton = [
    pkg ? `package ${pkg};\n` : '',
    [...imports].sort().map(i => `import ${i};`).join('\n'),
    '',
    statics.sort().join('\n'),
    '',
    `// Flow test of ${f.entry}: ${[...new Set(f.chain.map(c => c.method.split('#')[0].split('.').pop()))].join(' -> ')}.`,
    `// Real beans: ${beans.map(b => b.name).join(', ')}. Mocked at the edge: ${f.mocks.map(k => k.name).join(', ') || 'nothing'}.`,
    ...(outLines.length ? [`// What leaves the service: ${outLines.join('; ')}.`] : []),
    ...ann,
    `class ${path.basename(testFile, '.java')} {`,
    indent(fields.join('\n\n'), 4),
    '',
    indent(['@Test', `void ${entryMethod.name}Flow() throws Exception {`, ...(given.length ? ['    // given', ...given.map(x => '    ' + x)] : []), `    ${call}`, '    // then: what leaves the service', ...then.map(x => '    ' + x), '}'].join('\n'), 4),
    '}',
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return {
    workspace: id, style: 'flow', entry: f.entry, kind: f.kind, handler: f.method,
    flow: { chain: f.chain.map(c => `${c.method.split('.').slice(-1)[0]}${c.repo ? ` [${c.repo}]` : ''}${c.at ? ` ${c.at}` : ''}`), out: f.out, beans: f.beans, mocks: f.mocks, properties: f.properties },
    libraries: (m.libs || []).map(l => ({ artifactId: l.artifactId, repo: l.repo, module: l.module, error: l.error })),
    setup: s, test: { path: testFile, exists: fs.existsSync(path.join(m.path, testFile)), class: `${pkg ? pkg + '.' : ''}${path.basename(testFile, '.java')}` },
    sources: [...new Set(f.chain.map(c => c.method.split('#')[0]))].slice(0, 8).map(cid => { const c = G.classes.get(cid); return { class: cid, repo: c.repo, file: c.file }; }),
    skeleton,
    rules: [
      'Flow test: the beans on the chain are real (also the library ones), everything at its edge is a mock. Keep @Import to the chain; a missing bean fails the context with the bean it lacks: mock it or import it.',
      'Stub what the flow reads from its mocks (when ... thenReturn), then check what leaves the service: verify the topic sends, HTTP calls and writes (ArgumentCaptor for the payload).',
      'The verify/when hints use any() for every argument: where the method is overloaded (JdbcTemplate.update, RestTemplate.postForObject with String or URI) use typed matchers (anyString(), any(Map.class), eq("...")) so the right overload is checked.',
      'Mocks of framework beans (KafkaTemplate, RestTemplate) may see calls while the context starts (lifecycle, metrics): verify the calls that matter (never().send(...)) rather than verifyNoInteractions on them.',
      'Give the request what the handler needs to be chosen (path variables, body fields): read the entry and the handler before writing it.',
      web ? `@WebMvcTest(controllers = X) only scans controllers of the application; a library controller must also be in @Import. Its other controllers are not loaded.` : 'Call the entry method directly (listener, job), as the framework would.',
      `@${s.mockBean} for every mock (${s.mockBean === 'MockitoBean' ? 'Boot 3.4+' : 'Boot < 3.4'}); generic types (KafkaTemplate<String, String>) as the bean declares them.`,
      'Read the chain\'s sources (code_read / workspace_read; library files are in the libraries\' indexes) before writing assertions.',
    ],
    next: `Write it with workspace_write path="${testFile}", then test_run tests=["${path.basename(testFile, '.java')}"]. The libraries must be resolvable by the build (your Maven/Gradle repository).`,
  };
}

const cap = (x) => x[0].toUpperCase() + x.slice(1);

module.exports = { context, flowContext, setup, moduleOf, argFor, inserts };
