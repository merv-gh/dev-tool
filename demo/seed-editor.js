// Synthetic, self-contained editor/dependency demo. Set DT_HOME before requiring dt modules.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const files = {
  'README.md': '# Payments workspace\n\nSynthetic local fixture for the editor and Gradle upgrade walkthrough.\n',
  'settings.gradle.kts': 'rootProject.name = "payments-demo"\ninclude(":payments-api", ":payments-core")\n',
  'gradle.properties': '# One owner, two internal modules\nplatformVersion=1.4.0\n',
  'build.gradle': '// Synthetic dependency declarations; no external services are required.\nplugins { id "java" }\ndependencies {\n  implementation "com.acme:platform:${platformVersion}"\n  implementation libs.jackson.databind\n}\n',
  'payments-api/build.gradle.kts': 'dependencies {\n  api("com.acme:api:${platformVersion}")\n  implementation(libs.jackson.databind)\n  implementation(project(":payments-core"))\n}\n',
  'payments-core/build.gradle.kts': 'val junitVersion = "5.10.1"\ndependencies {\n  implementation("org.slf4j:slf4j-api:2.0.12")\n  testImplementation("org.junit.jupiter:junit-jupiter:$junitVersion")\n}\n',
  'gradle/libs.versions.toml': '[versions]\njackson = "2.16.0"\n\n[libraries]\njackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }\njackson-annotations = { module = "com.fasterxml.jackson.core:jackson-annotations", version.ref = "jackson" }\n',
  'payments-core/src/main/java/demo/Платёж.java': 'package demo;\n\n/** Synthetic payment value for the workspace demo. */\npublic record Платёж(String reference, long amount) {\n    public String description() {\n        return "Платёж " + reference + ": " + amount;\n    }\n}\n',
};
async function seed({ fresh = false } = {}) {
  const home = require('../lib/config').HOME, source = path.join(home, 'demo-editor', 'source');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'dev-tool demo', GIT_AUTHOR_EMAIL: 'demo@example.test', GIT_COMMITTER_NAME: 'dev-tool demo', GIT_COMMITTER_EMAIL: 'demo@example.test' };
  const git = (...args) => execFileSync('git', args, { cwd: source, env, stdio: 'pipe' }).toString().trim();
  fs.mkdirSync(source, { recursive: true });
  if (!fs.existsSync(path.join(source, '.git'))) {
    git('init', '-q', '-b', 'main');
    for (const [name, content] of Object.entries(files)) { const target = path.join(source, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
    git('add', '.'); git('commit', '-qm', 'Synthetic editor and dependency demo');
  }
  const workspace = await require('../lib/workspace').open({ project: 'DEMO', repo: 'payments-editor', ref: 'main', url: `file://${source}`, fresh });
  const inventory = await require('../lib/gradle-inventory').indexRepo({ project: 'DEMO', repo: 'payments-editor', ref: 'main', url: `file://${source}` }, { internalGroups: ['com.acme'] });
  return { synthetic: true, workspace: workspace.id, sha: workspace.sha, revision: inventory.revision, editor: '/editor?' + new URLSearchParams({ workspace: workspace.id, path: 'payments-core/src/main/java/demo/Платёж.java', story: require('../lib/access').owner().storyId }), dependency: 'com.fasterxml.jackson.core:jackson-databind', files: Object.keys(files), source };
}
if (require.main === module) seed().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { seed, files };
