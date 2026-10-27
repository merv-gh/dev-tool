// A local SFTP server for the demo (user demo / password demo), serving a folder.
//   node demo/sftp.js <port> <folder>
const fs = require('fs');
const [port = 4922, root = 'demo/.home/sftp'] = process.argv.slice(2);
fs.mkdirSync(`${root}/upload`, { recursive: true });
require('../test/sftp-server').start({ root, user: 'demo', password: 'demo', port: Number(port) }).then(s => console.error(`demo sftp on :${s.port} (${root})`));
