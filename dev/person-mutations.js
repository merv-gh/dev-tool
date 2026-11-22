// Private evaluation data/oracle. Never copy this module into the model's repo.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BASE = 'src/main/java/person/';
const mutations = [
  ['archived-table', 'PersonRepository.java', 'FROM registry.person_document d', 'FROM registry.person_document_archive d'],
  ['wrong-person-column', 'PersonRepository.java', 'WHERE d.person_id = ?', 'WHERE d.id = ?'],
  ['wrong-state-join', 'PersonRepository.java', 's.document_id = d.id', 's.document_id = d.person_id'],
  ['resultset-column', 'PersonRepository.java', 'rs.getString("last_name")', 'rs.getString("first_name")'],
  ['registry-column', 'PersonRepository.java', 'rs.getString("family_name")', 'rs.getString("given_name")'],
  ['address-join', 'PersonRepository.java', 'a.person_id = p.id\n', 'a.person_id = p.id + 1\n'],
  ['inactive', 'DocumentPolicy.java', 'return d.active()', 'return true'],
  ['annulled', 'DocumentPolicy.java', '&& !d.annulled()', '&& true'],
  ['future', 'DocumentPolicy.java', '&& !d.effectiveFrom().isAfter(asOf)', '&& true'],
  ['expired', 'DocumentPolicy.java', '&& (d.expiresOn() == null || !d.expiresOn().isBefore(asOf))', '&& true'],
  ['expiry-boundary', 'DocumentPolicy.java', '!d.expiresOn().isBefore(asOf)', 'd.expiresOn().isAfter(asOf)'],
  ['effective-boundary', 'DocumentPolicy.java', '!d.effectiveFrom().isAfter(asOf)', 'd.effectiveFrom().isBefore(asOf)'],
  ['incomplete-name', 'DocumentPolicy.java', '&& d.name().complete()', '&& true'],
  ['issue-date-rank', 'DocumentPolicy.java', 'Document::effectiveFrom', 'Document::issuedOn'],
  ['oldest-rank', 'DocumentPolicy.java', '.max(Comparator', '.min(Comparator'],
  ['tie-break', 'DocumentPolicy.java', 'thenComparingLong(Document::id)', 'thenComparingLong(d -> -d.id())'],
  ['mixed-name', 'PersonMapper.java', 'selected.name();', 'new Name(selected.name().lastName(), selected.name().firstName(), selected.name().patronymic() == null ? person.name().patronymic() : selected.name().patronymic());'],
  ['birth-date-source', 'PersonMapper.java', 'fio.display(), person.birthDate(),', 'fio.display(), selected == null ? person.birthDate() : selected.birthDate(),'],
  ['address-mapping', 'PersonMapper.java', 'new Address(person.city(), person.street())', 'new Address(person.street(), person.city())'],
  ['dto-name-swap', 'PersonMapper.java', 'person.id(), fio, fio.display()', 'person.id(), new Name(fio.firstName(), fio.lastName(), fio.patronymic()), fio.display()'],
].map(([id, file, before, after]) => ({ id, file: BASE + file, before, after }));
const compounds = ['inactive+annulled+future', 'resultset-column+birth-date-source', 'issue-date-rank+tie-break'];
const validCase=id=>typeof id==='string'&&id.length<=240&&id.split('+').every(part=>mutations.some(m=>m.id===part));

function mutate(root, id) {
  if (id.includes('+')) return id.split('+').map(part => mutate(root, part));
  const m = mutations.find(m => m.id === id);
  if (!m) throw Error('Unknown mutation ' + id);
  const file = path.join(root, m.file), source = fs.readFileSync(file, 'utf8');
  if (source.split(m.before).length !== 2) throw Error('Mutation must match exactly once: ' + id);
  fs.writeFileSync(file, source.replace(m.before, m.after));
  return m.file;
}
function reference(person, documents, asOf) {
  const eligible = documents.filter(d => d.person_id === person.id && d.active === true && d.annulled === false &&
    d.effective_from <= asOf && (d.expires_on === null || d.expires_on >= asOf) &&
    typeof d.last_name === 'string' && d.last_name.trim() && typeof d.first_name === 'string' && d.first_name.trim());
  eligible.sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id);
  const d = eligible[0];
  const fio = d ? { lastName: d.last_name, firstName: d.first_name, patronymic: d.middle_name } :
    { lastName: person.family_name, firstName: person.given_name, patronymic: person.patronymic };
  return { id: person.id, fio, fullName: [fio.lastName, fio.firstName, fio.patronymic].filter(v => v !== null && v.trim()).join(' '),
    birthDate: person.birth_date, sourceDocumentId: d?.id ?? null, effectiveFrom: d?.effective_from ?? null,
    address: { city: person.city, street: person.street }, asOf };
}
function dataset(seed = 42, copies = 3) {
  if (!Number.isInteger(copies) || copies < 1 || copies > 20) throw Error('copies must be 1..20');
  const people = [], documents = [];
  const date = (n) => new Date(Date.UTC(2026, 10, 20 + n)).toISOString().slice(0, 10);
  for (let copy = 0; copy < copies; copy++) for (let scenario = 0; scenario < 17; scenario++) {
    const id = copy === 0 ? 100 + scenario : 2000 + copy * 100 + scenario + (seed % 11) * 1000;
    const suffix = copy === 0 ? '' : '-' + seed + '-' + copy;
    const p = { id, family_name: 'Смирнов' + suffix, given_name: 'Иван', patronymic: 'Ильич', birth_date: '1990-04-05', city: 'Город-' + id, street: 'Улица-' + id };
    people.push(p);
    if (scenario === 0) continue;
    const doc = (n, patch = {}) => ({ id: id * 10 + n, person_id: id, last_name: 'Иванова' + suffix, first_name: 'Анна', middle_name: 'Петровна',
      birth_date: '1991-05-06', issued_on: date(-100), effective_from: date(-30), expires_on: null, active: true, annulled: false, ...patch });
    const rows = [doc(1)];
    if (scenario === 1) rows.push(doc(2, { last_name: 'Отменённая', effective_from: date(-1), annulled: true }));
    if (scenario === 2) rows.push(doc(2, { last_name: 'Неактивная', effective_from: date(-1), active: false }));
    if (scenario === 3) rows.push(doc(2, { last_name: 'Будущая', effective_from: date(1) }));
    if (scenario === 4) rows.push(doc(2, { last_name: 'Истёкшая', effective_from: date(-1), expires_on: date(-1) }));
    if (scenario === 5) rows.push(doc(2, { last_name: 'Сегодня', effective_from: date(-1), expires_on: date(0) }));
    if (scenario === 6) rows.push(doc(2, { last_name: 'Вступила', effective_from: date(0) }));
    if (scenario === 7) rows.push(doc(2, { last_name: 'ВыданаПозже', effective_from: date(-60), issued_on: date(-1) }));
    if (scenario === 8) rows.push(doc(2, { last_name: 'ПриоритетID' }));
    if (scenario === 9) rows.push(doc(2, { last_name: 'Неполная', first_name: ' ', effective_from: date(-1) }));
    if (scenario === 10) rows[0].middle_name = null;
    if (scenario === 11) rows.push(doc(2, { last_name: 'НовоеИмя', first_name: 'Елена', middle_name: 'Андреевна', effective_from: date(-5) }));
    if (scenario === 12) rows[0].expires_on = date(2);
    if (scenario === 13) rows[0].effective_from = date(-2);
    if (scenario === 14) rows.push(doc(2, { last_name: null, effective_from: date(-1) }));
    if (scenario === 15) { rows[0].active = false; rows.push(doc(2, { annulled: true })); }
    if (scenario === 16) rows.push(doc(2, { last_name: 'Полное', first_name: 'Мария', middle_name: '', effective_from: date(-1) }));
    documents.push(...rows);
  }
  // Deterministic permutation prevents relying on JDBC's incidental row order.
  documents.sort((a, b) => ((a.id * 31 + seed) % 101) - ((b.id * 31 + seed) % 101));
  return { people, documents, asOf: date(0), cases: people.map(p => ({ id: p.id, expected: reference(p, documents, date(0)) })) };
}
function sql(data) {
  const quote = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
  const inserts = (table, columns, rows) => rows.length ? `INSERT INTO registry.${table} (${columns.join(',')}) VALUES\n` + rows.map(r => '(' + columns.map(c => quote(r[c])).join(',') + ')').join(',\n') + ';' : '';
  return `DROP SCHEMA IF EXISTS registry CASCADE; CREATE SCHEMA registry;
CREATE TABLE registry.person(id bigint primary key, family_name text not null, given_name text not null, patronymic text, birth_date date not null);
CREATE TABLE registry.person_address(person_id bigint primary key references registry.person, city text, street text);
CREATE TABLE registry.person_document(id bigint primary key, person_id bigint references registry.person, last_name text, first_name text, middle_name text, birth_date date, issued_on date not null, effective_from date not null, expires_on date);
CREATE TABLE registry.document_state(document_id bigint primary key, active boolean not null, annulled boolean not null);
CREATE TABLE registry.person_document_archive (LIKE registry.person_document INCLUDING ALL);
${inserts('person', ['id','family_name','given_name','patronymic','birth_date'], data.people)}
${inserts('person_address', ['person_id','city','street'], data.people.map(p => ({ ...p, person_id: p.id })))}
${inserts('person_document', ['id','person_id','last_name','first_name','middle_name','birth_date','issued_on','effective_from','expires_on'], data.documents)}
${inserts('document_state', ['document_id','active','annulled'], data.documents.map(d => ({ ...d, document_id: d.id })))}
${inserts('person_document_archive', ['id','person_id','last_name','first_name','middle_name','birth_date','issued_on','effective_from','expires_on'], data.documents.map((d,i)=>({...d,last_name:['Соколова','Крылова','Алексеева'][i%3],first_name:['Лидия','Ольга'][i%2],middle_name:i%2?'Сергеевна':null})))}
`;
}
function diff(expected, actual, at = '') {
  if (expected === actual) return [];
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].flatMap(k => diff(expected[k], actual[k], at + '/' + k));
  }
  return [{ path: at || '/', expected: expected ?? null, actual: actual ?? null }];
}
function sourceDigest(root) {
  const dir = path.join(root, BASE);
  return crypto.createHash('sha256').update(fs.readdirSync(dir).filter(f => f.endsWith('.java')).sort().map(f => f + '\n' + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')).digest('hex');
}
module.exports = { BASE, mutations, compounds, validCase, mutate, reference, dataset, sql, diff, sourceDigest };
