/**
 * Bombo Bingo en Grupo — Servidor sin dependencias (Node >= 18)
 * Uso:  node server.js [puerto]
 * Abre: http://localhost:3000/grupo.html
 *
 * El servidor es la AUTORIDAD: genera los cartones (únicos), canta,
 * valida las marcas y comprueba línea / apagón. Nadie puede hacer trampa.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PUERTO = parseInt(process.argv[2], 10) || 3000;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const LETRAS = { ABCDE: ['A', 'B', 'C', 'D', 'E'], BINGO: ['B', 'I', 'N', 'G', 'O'] };

/* Patrones de "línea" (fila, columna, diagonal) y de filas horizontales */
const PATRONES_LINEA = (() => {
    const l = [];
    for (let r = 0; r < 5; r++) l.push([0, 1, 2, 3, 4].map(c => r + '-' + c));
    for (let c = 0; c < 5; c++) l.push([0, 1, 2, 3, 4].map(r => r + '-' + c));
    l.push(['0-0', '1-1', '2-2', '3-3', '4-4']);
    l.push(['0-4', '1-3', '2-2', '3-1', '4-0']);
    return l;
})();
const PATRONES_FILA = [0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(c => r + '-' + c));

/** @type {Map<string, any>} */
const salas = new Map();
/** @type {Map<string, {codigo:string, res:any}>} */
const conexiones = new Map();

const ahora = () => new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
const uid = (n) => Math.random().toString(36).slice(2, 2 + (n || 10));
const codigoSala = () => uid(4).toUpperCase();
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

function getSala(codigo) {
    const k = String(codigo || '').toUpperCase().trim();
    if (!k) return null;
    if (!salas.has(k)) {
        salas.set(k, {
            codigo: k,
            creada: Date.now(),
            jugadores: [],
            cartones: [],          // todos los cartones de la sala: {id, serie, dueno, rows, marcadas:[], pagado}
            firmas: new Set(),     // evita cartones duplicados
            salidos: [],
            disponibles: Array.from({ length: 75 }, (_, i) => i + 1),
            actual: null,
            timer: null,
            tipoLinea: 'fila',           // 'fila' | 'cualquiera'
            cantarAutomatico: false,     // el sistema canta al completar (opcional)
            config: {
                abono: 2,
                moneda: 'S/',
                premioLineaPct: 70,
                autoIntervalo: 4,
                letras: 'ABCDE'
            },
            premioLinea: null,   // {alias, serie, id}
            premioApagon: null,
            mensajes: [],
            revision: 0
        });
    }
    return salas.get(k);
}

/* --------------------------- Cartones --------------------------- */

function generarCarton(sala, dueno) {
    for (let intento = 0; intento < 60; intento++) {
        const cols = [];
        for (let c = 0; c < 5; c++) {
            const pool = [];
            for (let i = 0; i < 15; i++) pool.push(c * 15 + i + 1);
            shuffle(pool);
            cols.push(pool.slice(0, 5).sort((a, b) => a - b));
        }
        const rows = [];
        for (let r = 0; r < 5; r++) rows.push(cols.map(col => col[r]));
        rows[2][2] = 'LIBRE';

        const firma = JSON.stringify(rows);
        if (sala.firmas.has(firma)) continue;
        sala.firmas.add(firma);

        const carton = {
            id: uid(8),
            serie: 'C-' + String(sala.cartones.length + 1).padStart(3, '0'),
            dueno,
            rows,
            marcadas: ['2-2'],
            pagado: 'pendiente',   // pendiente | declarado | pagado
            creada: Date.now()
        };
        sala.cartones.push(carton);
        return carton;
    }
    return null;
}

const carton = (sala, id) => sala.cartones.find(c => c.id === id) || null;
const cartonesDe = (sala, pid) => sala.cartones.filter(c => c.dueno === pid);

/** Línea: fila horizontal, o fila/columna/diagonal según la configuración de la mesa */
function tieneLinea(sala, c) {
    const set = new Set(c.marcadas);
    const patrones = sala.tipoLinea === 'fila' ? PATRONES_FILA : PATRONES_LINEA;
    return patrones.some(p => p.every(k => set.has(k)));
}

/** Apagón: las 25 casillas del cartón marcadas */
function tieneApagon(c) { return new Set(c.marcadas).size >= 25; }

/* --------------------------- Jugadores --------------------------- */

function buscarJugador(sala, pid, alias) {
    let j = sala.jugadores.find(x => x.pid === pid);
    if (!j && alias) j = sala.jugadores.find(x => x.alias.toLowerCase() === String(alias).toLowerCase().trim());
    return j || null;
}

function entrar(codigo, pid, alias) {
    const sala = getSala(codigo);
    if (!sala) return { error: 'Código de sala inválido' };
    const nombre = String(alias || '').trim().slice(0, 16);
    if (!nombre) return { error: 'Escribe tu alias o nombre' };

    let j = buscarJugador(sala, pid);
    if (!j) {
        if (sala.jugadores.length >= 40) return { error: 'La sala está llena (40 jugadores)' };
        j = {
            pid,
            alias: nombre,
            rol: null,
            conectado: true,
            auto: false,
            autoCanto: true,
            visto: Date.now(),
            desconexion: null
        };
        sala.jugadores.push(j);
        mensaje(sala, nombre + ' entró a la sala');
    } else {
        j.alias = nombre;
        j.conectado = true;
        j.visto = Date.now();
        if (j.desconexion) { clearTimeout(j.desconexion); j.desconexion = null; }
    }
    // El primero en entrar canta; si el cantador se va, pasa el bombo.
    if (!sala.jugadores.some(x => x.rol === 'cantador')) {
        j.rol = 'cantador';
        mensaje(sala, '🎤 ' + j.alias + ' es el cantador (controla el bombo)');
    }
    if (!j.rol) j.rol = 'jugador';
    return { sala, jugador: j };
}

function mensaje(sala, texto, tipo) {
    sala.mensajes.unshift({ texto, tipo: tipo || 'info', hora: ahora() });
    if (sala.mensajes.length > 40) sala.mensajes.pop();
}

function reasignarCantador(sala) {
    const actual = sala.jugadores.find(j => j.rol === 'cantador');
    if (actual && actual.conectado) return;
    const siguiente = sala.jugadores.find(j => j.conectado) ;
    if (siguiente) {
        if (actual) actual.rol = 'jugador';
        siguiente.rol = 'cantador';
        mensaje(sala, '🎤 El bombo pasa a ' + siguiente.alias, 'aviso');
    }
}

/* --------------------------- Sorteo --------------------------- */

function cantar(sala) {
    if (!sala.disponibles.length) { detenerAuto(sala); return null; }
    const i = Math.floor(Math.random() * sala.disponibles.length);
    const num = sala.disponibles.splice(i, 1)[0];
    sala.salidos.push(num);
    sala.actual = num;
    // Marcado automático para quien lo tenga activado
    sala.jugadores.forEach(j => {
        if (!j.auto || !j.conectado) return;
        cartonesDe(sala, j.pid).forEach(c => {
            aplicarAuto(sala, c);
        });
    });
    if (sala.cantarAutomatico) revisarCantosAutomaticos(sala);
    if (!sala.disponibles.length) detenerAuto(sala);
    return num;
}

function aplicarAuto(sala, c) {
    const set = new Set(c.marcadas);
    for (let r = 0; r < 5; r++) {
        for (let col = 0; col < 5; col++) {
            const v = c.rows[r][col];
            if (v !== 'LIBRE' && sala.salidos.includes(v)) set.add(r + '-' + col);
        }
    }
    c.marcadas = Array.from(set);
}

function revisarCantosAutomaticos(sala) {
    sala.jugadores.forEach(j => {
        if (!j.conectado || !j.autoCanto) return;
        cartonesDe(sala, j.pid).forEach(c => {
            if (!sala.premioLinea && tieneLinea(sala, c)) adjudicar(sala, 'linea', j, c, true);
            else if (!sala.premioApagon && tieneApagon(c)) adjudicar(sala, 'apagon', j, c, true);
        });
    });
}

function adjudicar(sala, premio, jugador, c, esAuto) {
    const reg = { alias: jugador.alias, serie: c.serie, id: c.id, auto: !!esAuto, hora: ahora() };
    if (premio === 'linea') sala.premioLinea = reg; else sala.premioApagon = reg;
    mensaje(sala, (premio === 'linea' ? '🏆 ¡LÍNEA!' : '🌟 ¡APAGÓN!') + ' ' + jugador.alias + ' — cartón ' + c.serie, 'premio');
}

function abrirRonda(sala) {
    sala.firmas = new Set(sala.cartones.map(c => JSON.stringify(c.rows)));
    sala.salidos = [];
    sala.disponibles = Array.from({ length: 75 }, (_, i) => i + 1);
    sala.actual = null;
    sala.premioLinea = null;
    sala.premioApagon = null;
    sala.cartones.forEach(c => { c.marcadas = ['2-2']; });
    detenerAuto(sala);
    mensaje(sala, '🔄 Nueva ronda abierta', 'aviso');
}

function iniciarAuto(sala) {
    if (sala.timer) return;
    cantar(sala);
    sala.timer = setInterval(() => {
        if (!sala.disponibles.length) { detenerAuto(sala); emitir(sala); return; }
        cantar(sala);
        emitir(sala);
    }, Math.max(2, sala.config.autoIntervalo) * 1000);
}
function detenerAuto(sala) {
    if (sala.timer) { clearInterval(sala.timer); sala.timer = null; }
}

/* --------------------------- Estado (envío) --------------------------- */

function estadoPara(sala, j) {
    const valorCarton = (c) => sala.config.abono;
    const recaudado = sala.cartones.filter(c => c.pagado === 'pagado').reduce((s, c) => s + valorCarton(c), 0);
    const porCobrar = sala.cartones.filter(c => c.pagado !== 'pagado').reduce((s, c) => s + valorCarton(c), 0);
    const pozo = recaudado;
    const pctLinea = Math.max(0, Math.min(100, sala.config.premioLineaPct));

    const misCartones = cartonesDe(sala, j.pid).map(c => ({
        id: c.id, serie: c.serie, rows: c.rows, marcadas: c.marcadas, pagado: c.pagado,
        linea: tieneLinea(sala, c), apagon: tieneApagon(c)
    }));

    const jugadores = sala.jugadores.map(x => {
        const mios = cartonesDe(sala, x.pid);
        return {
            pid: x.pid,
            alias: x.alias,
            rol: x.rol,
            conectado: x.conectado,
            cartones: mios.length,
            pedidos: mios.map(c => ({ id: c.id, serie: c.serie, pagado: c.pagado, linea: tieneLinea(sala, c), apagon: tieneApagon(c) })),
            debe: mios.filter(c => c.pagado !== 'pagado').length * sala.config.abono,
            auto: x.auto
        };
    });

    const totalCartones = sala.cartones.length;
    return {
        tipo: 'estado',
        sala: sala.codigo,
        revision: ++sala.revision,
        config: sala.config,
        tipoLinea: sala.tipoLinea,
        cantarAutomatico: sala.cantarAutomatico,
        sorteo: {
            actual: sala.actual,
            salidos: sala.salidos,
            total: 75,
            restantes: sala.disponibles.length,
            auto: !!sala.timer
        },
        dinero: {
            abono: sala.config.abono,
            moneda: sala.config.moneda,
            recaudado,
            porCobrar,
            pozo,
            premioLinea: Math.round(pozo * pctLinea / 100),
            premioApagon: pozo - Math.round(pozo * pctLinea / 100)
        },
        premioLinea: sala.premioLinea,
        premioApagon: sala.premioApagon,
        mensajes: sala.mensajes.slice(0, 15),
        jugadores,
        yo: {
            pid: j.pid,
            alias: j.alias,
            rol: j.rol,
            auto: j.auto,
            autoCanto: j.autoCanto,
            conectado: j.conectado,
            cartones: misCartones,
            debe: misCartones.filter(c => c.pagado !== 'pagado').length * sala.config.abono,
            total: misCartones.length * sala.config.abono,
            puedeLinea: misCartones.some(c => c.linea) || false,
            puedeApagon: misCartones.some(c => c.apagon) || false
        }
    };
}

function emitir(sala) {
    for (const [pid, cx] of conexiones) {
        if (cx.codigo !== sala.codigo) continue;
        const j = sala.jugadores.find(x => x.pid === pid);
        if (!j) continue;
        enviar(cx.res, estadoPara(sala, j));
    }
}

function enviar(res, obj) {
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* cliente caído */ }
}

function error(res, texto) { enviar(res, { tipo: 'error', texto }); }

/* --------------------------- Acciones --------------------------- */

function accion(payload) {
    const { tipo, codigo, pid } = payload;
    const sala = getSala(codigo);
    if (!sala) return { error: 'Sala no encontrada' };
    let j = sala.jugadores.find(x => x.pid === pid);
    if (!j && tipo !== 'unirse') return { error: 'No estás en la sala. Vuelve a entrar.' };

    const esCantador = () => j && j.rol === 'cantador';
    const numValido = (n) => Number.isInteger(n) && n >= 1 && n <= 75;

    switch (tipo) {
        case 'unirse': {
            const r = entrar(codigo, pid, payload.alias);
            if (r.error) return r;
            emitir(sala);
            return { ok: true, sala: sala.codigo };
        }

        case 'config': {
            if (!esCantador()) return { error: 'Solo el cantador configura la mesa' };
            const c = payload.config || {};
            if (c.abono !== undefined) sala.config.abono = Math.max(0, Math.min(10000, Number(c.abono) || 0));
            if (c.moneda) sala.config.moneda = String(c.moneda).slice(0, 4);
            if (c.premioLineaPct !== undefined) sala.config.premioLineaPct = Math.max(0, Math.min(100, Number(c.premioLineaPct) || 0));
            if (c.autoIntervalo !== undefined) sala.config.autoIntervalo = Math.max(2, Math.min(30, Number(c.autoIntervalo) || 4));
            if (c.letras && LETRAS[c.letras]) sala.config.letras = c.letras;
            if (payload.tipoLinea) sala.tipoLinea = payload.tipoLinea === 'cualquiera' ? 'cualquiera' : 'fila';
            if (payload.cantarAutomatico !== undefined) sala.cantarAutomatico = !!payload.cantarAutomatico;
            break;
        }

        case 'cartones': {
            const cantidad = Math.max(0, Math.min(10, Number(payload.cantidad) || 0));
            const MAX = Math.max(1, Math.min(10, Number(payload.max) || 6));
            let creados = 0;
            for (let i = 0; i < cantidad && cartonesDe(sala, j.pid).length < MAX; i++) {
                if (generarCarton(sala, j.pid)) creados++;
            }
            if (!creados) return { error: 'No se pudieron generar más cartones' };
            mensaje(sala, j.alias + ' recibió ' + creados + ' cartón(es)');
            break;
        }

        case 'quitarCarton': {
            const c = carton(sala, payload.cartonId);
            if (!c) return { error: 'Cartón no encontrado' };
            if (c.dueno !== j.pid && !esCantador()) return { error: 'Ese cartón no es tuyo' };
            if (c.pagado === 'pagado') return { error: 'El cartón ya está pagado' };
            sala.cartones = sala.cartones.filter(x => x.id !== c.id);
            break;
        }

        case 'pago': {
            const c = carton(sala, payload.cartonId);
            if (!c) return { error: 'Cartón no encontrado' };
            const propio = c.dueno === j.pid;
            if (!propio && !esCantador()) return { error: 'Solo el cantador confirma pagos de otros' };
            const nuevo = payload.estado;
            if (nuevo === 'pagado') {
                if (!esCantador() && c.pagado === 'pagado') return { error: 'Ya estaba pagado' };
                c.pagado = 'pagado';
                mensaje(sala, sala.config.moneda + ' ' + sala.config.abono + ' — ' + sala.config.moneda + ' confirmado para el cartón ' + c.serie, 'pago');
            } else if (nuevo === 'declarado') {
                if (c.pagado === 'pagado') return { error: 'El cantador ya confirmó este cartón' };
                c.pagado = 'declarado';
                mensaje(sala, '💸 ' + j.alias + ' declara el abono del cartón ' + c.serie + ' (' + sala.config.moneda + ' ' + sala.config.abono + ')', 'pago');
            } else {
                if (!esCantador()) return { error: 'Solo el cantador puede devolverlo a pendiente' };
                c.pagado = 'pendiente';
            }
            break;
        }

        case 'cantar': {
            if (!esCantador()) return { error: 'Solo el cantador puede sacar números' };
            if (!sala.disponibles.length) return { error: 'Ya salieron todos los números' };
            cantar(sala);
            break;
        }

        case 'auto': {
            if (!esCantador()) return { error: 'Solo el cantador controla el sorteo automático' };
            if (payload.activo) iniciarAuto(sala); else detenerAuto(sala);
            break;
        }

        case 'modo': {
            // Marcado automático / manual del jugador y canto automático
            if (payload.auto !== undefined) j.auto = !!payload.auto;
            if (payload.autoCanto !== undefined) j.autoCanto = !!payload.autoCanto;
            if (j.auto) cartonesDe(sala, j.pid).forEach(c => aplicarAuto(sala, c));
            if (sala.cantarAutomatico) revisarCantosAutomaticos(sala);
            mensaje(sala, j.alias + ' usa marcado ' + (j.auto ? 'AUTOMÁTICO' : 'MANUAL'), 'aviso');
            break;
        }

        case 'marcar': {
            const c = carton(sala, payload.cartonId);
            if (!c || c.dueno !== j.pid) return { error: 'Ese cartón no es tuyo' };
            const key = String(payload.key || '');
            const m = /^([0-4])-([0-4])$/.exec(key);
            if (!m) return { error: 'Casilla inválida' };
            const r = +m[1], col = +m[2];
            const valor = c.rows[r][col];
            if (valor === 'LIBRE') return { error: 'La casilla central es libre' };
            if (!sala.salidos.includes(valor)) return { error: 'Ese número aún no ha salido' };
            const set = new Set(c.marcadas);
            if (set.has(key)) set.delete(key); else set.add(key);
            c.marcadas = Array.from(set);
            break;
        }

        case 'cantarPremio': {
            const premio = payload.premio === 'apagon' ? 'apagon' : 'linea';
            if (premio === 'linea' && sala.premioLinea) return { error: 'La línea ya tiene ganador' };
            if (premio === 'apagon' && sala.premioApagon) return { error: 'El apagón ya tiene ganador' };
            const candidatos = payload.cartonId
                ? cartonesDe(sala, j.pid).filter(c => c.id === payload.cartonId)
                : cartonesDe(sala, j.pid);
            const valido = candidatos.find(c => premio === 'linea' ? tieneLinea(sala, c) : tieneApagon(c));
            if (!valido) return { error: premio === 'linea' ? 'Aún no completas ninguna línea' : 'Aún no llenas el cartón completo' };
            adjudicar(sala, premio, j, valido, false);
            break;
        }

        case 'reiniciar': {
            if (!esCantador()) return { error: 'Solo el cantador reinicia la ronda' };
            abrirRonda(sala);
            break;
        }

        case 'pasarBombo': {
            if (!esCantador()) return { error: 'Solo el cantador puede pasar el bombo' };
            const destino = sala.jugadores.find(x => x.pid === payload.pidDestino);
            if (!destino) return { error: 'Jugador no encontrado' };
            j.rol = 'jugador';
            destino.rol = 'cantador';
            mensaje(sala, '🎤 El bombo pasa a ' + destino.alias, 'aviso');
            break;
        }

        case 'expulsar': {
            if (!esCantador()) return { error: 'Solo el cantador puede quitar jugadores' };
            if (payload.pidDestino === j.pid) return { error: 'No puedes quitarte a ti mismo' };
            detenerAuto(sala);
            sala.cartones = sala.cartones.filter(c => c.dueno !== payload.pidDestino);
            sala.jugadores = sala.jugadores.filter(x => x.pid !== payload.pidDestino);
            break;
        }

        default:
            return { error: 'Acción desconocida' };
    }
    emitir(sala);
    return { ok: true };
}

/* --------------------------- HTTP --------------------------- */

function leerJSON(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    });
}

function estatico(req, res, url) {
    const rel = decodeURIComponent(url.pathname === '/' ? '/grupo.html' : url.pathname).replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Prohibido'); }
    fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(buf);
    });
}

const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const p = url.pathname;

    if (p === '/api/eventos') {
        const codigo = (url.searchParams.get('sala') || '').toUpperCase();
        const pid = url.searchParams.get('pid') || '';
        const sala = salas.get(codigo);
        if (!sala) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('sala'); }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.write('retry: 2000\n\n');
        conexiones.set(pid, { codigo, res });
        const j = sala.jugadores.find(x => x.pid === pid);
        if (j) { j.conectado = true; enviar(res, estadoPara(sala, j)); }
        else error(res, 'Vuelve a entrar para unirte a la sala');
        const beat = setInterval(() => { try { res.write(': latido\n\n'); } catch (e) {} }, 20000);
        req.on('close', () => {
            clearInterval(beat);
            if (conexiones.get(pid) && conexiones.get(pid).res === res) conexiones.delete(pid);
            const jug = sala.jugadores.find(x => x.pid === pid);
            if (jug) {
                jug.conectado = false;
                jug.desconexion = setTimeout(() => { reasignarCantador(sala); emitir(sala); }, 15000);
                mensaje(sala, jug.alias + ' se desconectó', 'aviso');
                emitir(sala);
            }
        });
        return;
    }

    if (p === '/api/accion' && req.method === 'POST') {
        const body = await leerJSON(req);
        let out;
        try { out = accion(body); } catch (e) { out = { error: 'Error interno: ' + e.message }; }
        res.writeHead(out.error ? 400 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(out));
    }

    if (p === '/api/salud') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, salas: Array.from(salas.keys()) }));
    }

    return estatico(req, res, url);
});

servidor.listen(PUERTO, '0.0.0.0', () => {
    const ips = [];
    const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach(k => (ifs[k] || []).forEach(i => {
        if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }));
    console.log('\n  🎱  Bingo en Grupo listo');
    console.log('  Cantador (PC):      http://localhost:' + PUERTO + '/grupo.html');
    ips.forEach(ip => console.log('  Jugadores (móvil):  http://' + ip + ':' + PUERTO + '/grupo.html'));
    console.log('  Bingo individual:   http://localhost:' + PUERTO + '/index.html');
    console.log('  (Ctrl+C para detener)\n');
});
