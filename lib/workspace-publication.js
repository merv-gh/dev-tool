// Checked-tree publication for the task supervisor. Existing workspace_push
// keeps its interactive contract; this path never replays an untested tree.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const G = require('./git'), W = require('./workspace'), A = require('./access'), C = require('./config'), D = require('./durable-private-store');
const store = () => D.create(A.scopedDirectory(path.join(C.HOME,'workspace-publications')));
const fail = message => { throw Object.assign(Error(message),{code:'DT_PUBLICATION_BLOCKED'}); };
async function candidate(workspace) {
  const m = W.checkId(workspace), directory = await G.git(['rev-parse','--absolute-git-dir'],m.path);
  const index = path.join(directory,'dt-candidate-' + crypto.randomUUID()), options = {env:{GIT_INDEX_FILE:index}};
  try {
    await G.git(['read-tree','HEAD'],m.path,[],options);
    await G.git(['add','-A','--','.',':(exclude,glob)**/.dt/**'],m.path,[],options);
    return {head:await G.git(['rev-parse','HEAD'],m.path),tree:await G.git(['write-tree'],m.path,[],options),files:(await G.git(['diff','--cached','--name-only','HEAD'],m.path,[],options)).split('\n').filter(Boolean)};
  } finally { fs.rmSync(index,{force:true}); fs.rmSync(index + '.lock',{force:true}); }
}
async function publish({workspace,branch,message,tree,request_id}) {
  A.checkTool('workspace_push');
  if (!require('./tools').enabled(C.live(() => C.getTools()))({name:'workspace_push',group:'code'})) throw A.deny('Tool is disabled');
  const m = W.checkId(workspace), cfg = C.live(() => C.getPush());
  if (m.local) fail('Local repository has no publication target; use an existing remote workspace');
  if (!cfg.enabled) fail('Pushing is disabled in configuration');
  if (!branch?.startsWith('codex/') || cfg.protect.some(p => W.branchGlob(p).test(branch))) fail('Only an unprotected codex/ task branch may be published');
  await G.git(['check-ref-format','--branch',branch],m.path);
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) fail('Supply a commit message');
  D.key(request_id); const s = store(), release = s.lock(request_id);
  try {
    let receipt = s.read(request_id); const digest = D.hash(JSON.stringify({workspace,branch,message,tree}));
    if (receipt && receipt.digest !== digest) fail('Publication request id was used for a different candidate');
    const url = m.remote || G.remote(m.project,m.repo), auth = G.authArgs(url);
    const refs = await G.git(['ls-remote','--symref',url,'HEAD','refs/heads/' + branch],m.path,auth);
    const defaultBranch = refs.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m)?.[1];
    if (!defaultBranch || branch === defaultBranch) fail('Default branch could not be excluded safely');
    const remoteHead = refs.split('\n').map(line => line.split(/\s+/)).find(([,ref]) => ref === 'refs/heads/' + branch)?.[0] || null;
    if (receipt?.commit && remoteHead === receipt.commit) {
      receipt.state = 'pushed'; s.write(request_id,receipt);
    } else {
      if (receipt?.state === 'pushed') fail('Published remote branch changed; inspect it before another push');
      if (remoteHead && remoteHead !== (receipt?.parent || m.sha)) fail('Task branch moved; rebase/reconcile and rerun checks before publishing');
      const current = await candidate(workspace);
      if (current.tree !== tree || !current.files.length) fail('Candidate changed or contains no changes; rerun checks');
      if (!receipt) {
        receipt = {id:request_id,digest,workspace,branch,tree,parent:current.head,files:current.files,state:'admitted',at:new Date().toISOString()}; s.write(request_id,receipt);
      }
      if (!receipt.commit) {
        const who = cfg.author?.match(/^\s*(.+?)\s*<([^>]+)>\s*$/), ident = ['-c','user.name=' + (who?.[1] || 'dt'),'-c','user.email=' + (who?.[2] || 'dt@localhost')];
        receipt.commit = await G.git(['commit-tree',tree,'-p',receipt.parent,'-m',message],m.path,ident); receipt.state = 'committed'; s.write(request_id,receipt);
      }
      receipt.state = 'pushing'; s.write(request_id,receipt);
      try { await G.git(['push','-q',url,receipt.commit + ':refs/heads/' + branch],m.path,auth); }
      catch (error) { receipt.state = 'uncertain'; receipt.error = require('./redact').clean(error.message); s.write(request_id,receipt); throw error; }
      receipt.state = 'pushed'; s.write(request_id,receipt);
    }
    // HEAD/index move only after verified publication; working files are retained.
    await G.git(['reset','--mixed','-q',receipt.commit],m.path);
    require('./util').writeJson(path.join(A.scopedDirectory(path.join(C.PATHS.cache,'work')),workspace + '.json'),{...m,sha:receipt.commit,ref:branch,pushes:[...(m.pushes || []).filter(p => p.commit !== receipt.commit),{branch,commit:receipt.commit,base:receipt.parent,at:receipt.at,files:receipt.files.length}]});
    return {...receipt,repo:m.project + '/' + m.repo,defaultBranch};
  } finally { release(); }
}
module.exports = {candidate,publish};
