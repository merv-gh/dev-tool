const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function files(root){return ['server.js','cli.js',...['lib','web'].flatMap(dir=>fs.readdirSync(path.join(root,dir),{recursive:true}).map(file=>dir+'/'+file.split(path.sep).join('/')).filter(file=>/\.(js|html|css)$/.test(file)&&!file.startsWith('web/vendor/')))].sort();}
function digest(root=path.join(__dirname,'..')){if(typeof __DT_SOURCE_DIGEST__!=='undefined')return __DT_SOURCE_DIGEST__;const h=crypto.createHash('sha256');for(const file of files(root)){h.update(file).update('\0').update(fs.readFileSync(path.join(root,file))).update('\0');}return h.digest('hex');}
module.exports={files,digest};
