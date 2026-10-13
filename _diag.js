/* Diagnóstico local: comprueba el contrato cliente<->servidor y reproduce el
   error "Respuesta inválida del servidor" (script temporal). */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO_JUEGO = 3000;
const PUERTO_ESTATICO = 5500;
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/* Igual que en grupo.js: así se interpreta la respuesta */
async function comoCliente(res) {
    const texto = await res.text();
    try { return { ok: true, datos: JSON.parse(texto) }; }
    catch (e) { return { ok: false, error: 'Respuesta inválida del servidor', http: res.status, tipo: res.headers.get('content-type'), cuerpo: texto.slice(0, 60).replace(/\s+/g, ' ') }; }
}

const post = (base, ruta, body) => fetch(base + ruta, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(comoCliente);

/* Servidor estático "ajeno" (como Live Server / XAMPP / python http.server) */
function servidorEstatico() {
    return http.createServer((req, res) => {
        const f = path.join(__dirname, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
        fs.readFile(f, (err, buf) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end('<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>');
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(buf);
        });
    });
}

(async () => {
    const juego = spawn(process.execPath, ['server.js', String(PUERTO_JUEGO)], { cwd: __dirname, stdio: 'ignore' });
    const ajeno = servidorEstatico();
    await new Promise(r => ajeno.listen(PUERTO_ESTATICO, r));
    await esperar(1200);

    const A = 'http://localhost:' + PUERTO_JUEGO;
    const B = 'http://localhost:' + PUERTO_ESTATICO;
    const linea = (t) => console.log('\n=== ' + t + ' ===');

    linea('1. Servidor del juego (node server.js) — APIs');
    const salud = await fetch(A + '/api/salud').then(r => r.json());
    console.log('/api/salud      ->', JSON.stringify(salud));
    const pagina = await fetch(A + '/grupo.html');
    console.log('GET /grupo.html ->', pagina.status, pagina.headers.get('content-type'));
    const js = await fetch(A + '/grupo.js');
    console.log('GET /grupo.js   ->', js.status, js.headers.get('content-type'));

    linea('2. POST /api/accion con el servidor correcto');
    console.log('unirse válido   ->', JSON.stringify(await post(A, '/api/accion', { tipo: 'unirse', codigo: 'DIAG', pid: 'A', alias: 'Ana' })));
    console.log('tipo inválido   ->', JSON.stringify(await post(A, '/api/accion', { tipo: 'nope', codigo: 'DIAG', pid: 'A' })));
    console.log('cantar (jugador)->', JSON.stringify(await post(A, '/api/accion', { tipo: 'cantar', codigo: 'DIAG', pid: 'A' })));

    linea('3. Mismo POST pero con un servidor estático ajeno (Live Server / XAMPP / npx serve)');
    const ajeno1 = await post(B, '/api/accion', { tipo: 'unirse', codigo: 'DIAG', pid: 'A', alias: 'Ana' });
    console.log('unirse          ->', JSON.stringify(ajeno1));

    linea('4. POST a una ruta que no existe en el servidor del juego');
    console.log('POST /api/nada  ->', JSON.stringify(await post(A, '/api/nada', {})));

    linea('5. Verificación de EventSource (SSE)');
    const ctrl = new AbortController();
    const sseRes = await fetch(A + '/api/eventos?sala=DIAG&pid=A', { signal: ctrl.signal });
    const lector = sseRes.body.getReader();
    const { value } = await lector.read();
    const primerBloque = new TextDecoder().decode(value || new Uint8Array()).split('\n\n')[0];
    console.log('SSE             ->', sseRes.status, sseRes.headers.get('content-type'));
    console.log('primer evento   ->', primerBloque.replace(/\n/g, ' ').slice(0, 120) + '…');
    ctrl.abort();

    linea('Resumen');
    console.log('El servidor del juego responde JSON siempre: en el caso 2 no debe aparecer');
    console.log('"Respuesta inválida del servidor". En el caso 3 (servidor estático ajeno) SÍ aparece,');
    console.log('porque devuelve un 404 en HTML: esa es la causa del error reportado.');

    juego.kill();
    ajeno.close();
    await esperar(200);
    process.exit(0);
})();
