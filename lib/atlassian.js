// Bitbucket Server and Confluence REST, read-only, with personal tokens from .env.personal.
const { getPersonal } = require('./config');
const { http } = require('./util');

function bb(p, opts = {}) {
  const { url, token } = getPersonal().bitbucket;
  if (!url || !token) throw new Error('Bitbucket not configured: set BITBUCKET_URL and BITBUCKET_HTTP_TOKEN in .env.personal');
  return http(url + p, { ...opts, headers: { authorization: `Bearer ${token}`, ...opts.headers } });
}

// Bitbucket paged list -> all values (capped).
async function bbAll(p, max = 2000) {
  const out = [];
  for (let start = 0; out.length < max;) {
    const res = await bb(`${p}${p.includes('?') ? '&' : '?'}limit=500&start=${start}`);
    out.push(...res.values);
    if (res.isLastPage) break;
    start = res.nextPageStart;
  }
  return out;
}

async function repos(filter = '') {
  const all = await bbAll(`/rest/api/1.0/repos${filter ? `?name=${encodeURIComponent(filter)}` : ''}`);
  return all.map(r => ({ project: r.project.key, repo: r.slug, name: r.name, description: r.description || undefined }));
}

async function files(project, repo, { at } = {}) {
  const q = at ? `?at=${encodeURIComponent(at)}` : '';
  return bbAll(`/rest/api/1.0/projects/${project}/repos/${repo}/files${q}`, 20000);
}

async function file(project, repo, filePath, { at } = {}) {
  const q = at ? `?at=${encodeURIComponent(at)}` : '';
  return bb(`/rest/api/1.0/projects/${project}/repos/${repo}/raw/${filePath.split('/').map(encodeURIComponent).join('/')}${q}`, { raw: true });
}

async function prs(project, repo, { state = 'OPEN' } = {}) {
  const res = await bb(`/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests?state=${state}&limit=50`);
  return res.values.map(p => ({ id: p.id, title: p.title, state: p.state, author: p.author?.user?.displayName, from: p.fromRef?.displayId, to: p.toRef?.displayId, updated: new Date(p.updatedDate).toISOString() }));
}

const prBase = (project, repo, id) => `/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests/${id}`;
const user = (u) => u?.user?.displayName || u?.displayName || u?.user?.name || null;

// PRs where you are author / reviewer / participant, across all repos.
async function myPrs({ role = 'REVIEWER', state = 'OPEN' } = {}) {
  const res = await bb(`/rest/api/1.0/dashboard/pull-requests?role=${role}&state=${state}&limit=100`);
  return res.values.map(p => ({
    project: p.toRef?.repository?.project?.key, repo: p.toRef?.repository?.slug, id: p.id, title: p.title,
    author: user(p.author), from: p.fromRef?.displayId, to: p.toRef?.displayId, state: p.state,
    reviewers: (p.reviewers || []).map(r => `${user(r)}:${r.status}`).join(', '),
    updated: new Date(p.updatedDate).toISOString(), link: p.links?.self?.[0]?.href,
  }));
}

// Bitbucket's structured diff -> unified diff text, plus per-file +/- counts.
function unified(diffs) {
  const files = [];
  const out = [];
  for (const d of diffs || []) {
    const from = d.source?.toString || '/dev/null', to = d.destination?.toString || '/dev/null';
    let add = 0, del = 0;
    out.push(`diff --git a/${from} b/${to}`, `--- a/${from}`, `+++ b/${to}`);
    if (d.binary) out.push('Binary file');
    for (const h of d.hunks || []) {
      out.push(`@@ -${h.sourceLine},${h.sourceSpan} +${h.destinationLine},${h.destinationSpan} @@${h.context ? ' ' + h.context : ''}`);
      for (const s of h.segments || []) {
        const sign = s.type === 'ADDED' ? '+' : s.type === 'REMOVED' ? '-' : ' ';
        for (const l of s.lines || []) { out.push(sign + l.line); if (sign === '+') add++; if (sign === '-') del++; }
      }
    }
    if (d.truncated) out.push('... (truncated by Bitbucket)');
    files.push({ path: to !== '/dev/null' ? to : from, from, add, del });
  }
  return { text: out.join('\n'), files };
}

async function prDetails(project, repo, id) {
  const base = prBase(project, repo, id);
  const [pr, diff, acts] = await Promise.all([
    bb(base),
    bb(`${base}/diff?contextLines=3&withComments=false&maxLines=20000`).catch(e => ({ error: e.message })),
    bb(`${base}/activities?limit=200`).catch(() => ({ values: [] })),
  ]);
  const u = unified(diff.diffs);
  const comments = acts.values.filter(a => a.action === 'COMMENTED' && a.comment).map(a => ({
    at: new Date(a.createdDate).toISOString(), author: user(a.user), text: a.comment.text,
    file: a.commentAnchor?.path || null, line: a.commentAnchor?.line || null,
  })).reverse();
  return {
    project, repo, id: pr.id, title: pr.title, description: pr.description || '', state: pr.state,
    author: user(pr.author), from: pr.fromRef?.displayId, to: pr.toRef?.displayId,
    fromSha: pr.fromRef?.latestCommit, toSha: pr.toRef?.latestCommit,
    reviewers: (pr.reviewers || []).map(r => ({ name: user(r), status: r.status })),
    created: new Date(pr.createdDate).toISOString(), updated: new Date(pr.updatedDate).toISOString(),
    link: pr.links?.self?.[0]?.href, files: u.files, diff: u.text, diffError: diff.error, comments,
  };
}

function cf(p) {
  const { url, user, token } = getPersonal().confluence;
  if (!url || !token) throw new Error('CONFLUENCE_URL / CONFLUENCE_API_TOKEN not set in .env.personal');
  // Cloud: email + API token (basic). Server/DC: personal access token (bearer).
  return user ? http(url + p, { auth: { user, pass: token } }) : http(url + p, { headers: { authorization: `Bearer ${token}` } });
}

async function confluenceSearch(text, { space, limit = 20 } = {}) {
  let cql = `text ~ ${JSON.stringify(text)} and type = page`;
  if (space) cql += ` and space = ${JSON.stringify(space)}`;
  const res = await cf(`/rest/api/content/search?limit=${limit}&cql=${encodeURIComponent(cql)}`);
  return res.results.map(r => ({ id: r.id, title: r.title, space: r._expandable?.space?.split('/').pop(), url: r._links?.webui }));
}

const stripHtml = (h) => h.replace(/<(br|\/p|\/h\d|\/li|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();

async function confluencePage(id) {
  const p = await cf(`/rest/api/content/${encodeURIComponent(id)}?expand=body.storage,version,space`);
  return { id: p.id, title: p.title, space: p.space?.key, version: p.version?.number, text: stripHtml(p.body?.storage?.value || '') };
}

module.exports = { repos, files, file, prs, myPrs, prDetails, unified, confluenceSearch, confluencePage, bb };
