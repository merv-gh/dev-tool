const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const files={'/':['index.html','text/html'],'/demo.js':['demo.js','text/javascript'],'/style.css':['style.css','text/css'],'/ui.css':['../../web/ui.css','text/css']};
const server=http.createServer((req,res)=>{const item=files[new URL(req.url,'http://localhost').pathname];if(!item){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',item[1]+'; charset=utf-8');res.setHeader('Cache-Control','no-store');fs.createReadStream(path.join(__dirname,item[0])).pipe(res);});
server.listen(Number(process.argv[2]||4089),'127.0.0.1',()=>console.log('Task chat prototype: http://127.0.0.1:'+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
