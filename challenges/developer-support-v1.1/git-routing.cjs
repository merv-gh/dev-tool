const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const dest=path.resolve(process.argv[2]||'');
const s=require(path.join(dest,'setup.json'));
const config=require(path.join(s.home,'config.json'));
if(!config.bitbucket?.url)throw new Error('start the public fake Bitbucket server first');
const file=path.join(dest,'git-routing.conf');fs.writeFileSync(file,'# Task-local routing to public local challenge remotes\n');
for(const[key,dir]of Object.entries(s.repos)){
 const [project,repo]=key.split('/');
 execFileSync('git',['config','--file',file,`url.file://${dir}.insteadOf`,`${config.bitbucket.url}/scm/${project.toLowerCase()}/${repo}.git`]);
}
console.log(JSON.stringify({GIT_CONFIG_GLOBAL:file,refs:'main; C03 library also v2.4.1',note:'Set GIT_CONFIG_GLOBAL for each dt process, including tool invocations.'},null,2));
