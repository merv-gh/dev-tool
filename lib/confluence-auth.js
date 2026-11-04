// Shared policy for live tools and the documentation mirror. A Server/DC PAT
// identifies its user; only Cloud API tokens need an account email for Basic auth.
module.exports = function confluenceAuth(cfg) {
  if (!cfg.url || !cfg.token) throw new Error('Confluence not configured: confluence.url and confluence.token are required');
  const kind = cfg.type || cfg.flavour;
  if (kind && !['cloud', 'server', 'dc'].includes(kind)) throw new Error('confluence.type must be server, dc or cloud');
  const cloud = kind ? kind === 'cloud' : !!cfg.user;
  if (cloud && !cfg.user) throw new Error('Confluence Cloud requires confluence.user (email) and token');
  return { cloud, headers: { accept: 'application/json', authorization: cloud ? 'Basic ' + Buffer.from(`${cfg.user}:${cfg.token}`).toString('base64') : `Bearer ${cfg.token}` } };
};
