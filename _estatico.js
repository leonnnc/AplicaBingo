/* Servidor SOLO estático (simula Live Server / XAMPP) para la prueba en localhost. Temporal. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PUERTO = 5500;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0] === '/' ? '/grupo.html' : req.url.split('?')[0]).replace(/^\/+/, '');
    const f = path.join(__dirname, rel);
    fs.readFile(f, (err, buf) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end('<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>Este servidor estatico no tiene la API del juego</p></body></html>');
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
    });
}).listen(PUERTO, () => console.log('estatico en ' + PUERTO));
