// What a project's build needs from its machine: the private repository credentials and proxies that
// build scripts read from gradle.properties (mavenUser, mavenPassword, nexusUrl...) or the environment.
//   tests.gradleProperties   files, read in order (the first value of a key wins); then
//                            <config folder>/gradle.properties, and ~/.gradle/gradle.properties when
//                            GRADLE_USER_HOME points elsewhere (as in the container)
//   tests.env                environment variables for every build (Maven settings.xml can use ${env.X})
// Values may be ${VAR} from .env. Gradle gets project properties as ORG_GRADLE_PROJECT_<name> (nothing is
// written to disk), systemProp.* and org.gradle.* as -D. Every value is masked in what dt shows.
const fs = require('fs');
const os = require('os');
const path = require('path');

function gradleFiles(cfg) {
  const { HOME } = require('./config');
  const files = [...(cfg.gradleProperties || []).map(f => path.resolve(HOME, f)), path.join(HOME, 'gradle.properties')];
  const userHome = path.join(os.homedir(), '.gradle', 'gradle.properties');
  if (cfg.gradleHome && path.resolve(cfg.gradleHome) !== path.dirname(userHome)) files.push(userHome);
  return [...new Set(files)].filter(f => fs.existsSync(f));
}

function gradleProperties(cfg) {
  const { parseProperties } = require('./passport/extract');
  const { load, interpolate } = require('./config');
  const lookup = load().lookup();
  const props = {}, from = {};
  for (const f of gradleFiles(cfg)) {
    for (const [k, v] of Object.entries(parseProperties(fs.readFileSync(f, 'utf8')))) {
      if (k in props) continue;
      props[k] = String(interpolate(v, lookup));
      from[k] = f;
    }
  }
  return { props, from };
}

// { env, args, secrets } for one build run
function forBuild(cfg, tool) {
  const env = {}, args = [], secrets = [];
  for (const [k, v] of Object.entries(cfg.env || {})) { env[k] = String(v); secrets.push(String(v)); }
  const sources = [];
  if (tool === 'gradle') {
    const { props, from } = gradleProperties(cfg);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('systemProp.')) args.push(`-D${k.slice(11)}=${v}`);
      else if (k.startsWith('org.gradle.')) args.push(`-D${k}=${v}`);
      else env[`ORG_GRADLE_PROJECT_${k}`] = v;
      if (/pass|secret|token|key|user|cred|auth/i.test(k)) secrets.push(v);
    }
    sources.push(...new Set(Object.values(from)));
  }
  return { env, args, secrets: secrets.filter(s => s && s.length >= 3), sources };
}

const mask = (text, secrets) => {
  let t = String(text ?? '');
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) t = t.split(s).join('***');
  return t;
};

module.exports = { forBuild, gradleProperties, gradleFiles, mask };
