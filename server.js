/**
 * AplicaBingo — Servidor sin dependencias (Node >= 18)
 * Uso:  node server.js [puerto]
 * Abre: http://localhost:3000/            (entrada: alias + sala)
 *       http://localhost:3000/grupo.html?sala=XXXX
 *
 * El servidor es la AUTORIDAD: el primero que entra crea la sala y canta;
 * si el cantador sale, el bombo pasa al siguiente. Genera los cartones
 * (únicos), canta, valida las marcas y coteja línea / apagón.
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
            iniciada: false,             // el cantador ya empezó a cantar
            exigirAbono: false,          // exige abono confirmado para cantar premio
            aviso: null,                 // {pid, hora}: "ahora cantas tú" (invita a los demás)
            fondo: null,                 // {tipo, patron, opacidad, version} para los cartones
            fondoUrl: null,              // data URL de la foto de fondo (no se emite por SSE)
            cotejos: [],                 // jugadas cantadas con su evidencia congelada
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

const PATRONES_COLUMNA = [0, 1, 2, 3, 4].map(c => [0, 1, 2, 3, 4].map(r => r + '-' + c));
const PATRONES_DIAGONAL = [['0-0', '1-1', '2-2', '3-3', '4-4'], ['0-4', '1-3', '2-2', '3-1', '4-0']];

/**
 * Cotejo de un cartón: qué filas, columnas y diagonales están completas y
 * cuántos aciertos tiene. Se usa igual para la partida en vivo y para la
 * evidencia congelada de un premio cantado.
 */
function analizar(rows, marcadas, salidos, tipoLinea) {
    const set = new Set(marcadas);
    const sal = new Set(salidos);
    let aciertos = 0, validas = 0, total = 0;
    for (let r = 0; r < 5; r++) {
        for (let k = 0; k < 5; k++) {
            const v = rows[r][k];
            if (v === 'LIBRE') continue;
            total++;
            const key = r + '-' + k;
            if (set.has(key)) { aciertos++; if (sal.has(v)) validas++; }
        }
    }
    const hecha = (p) => p.every(k => set.has(k));
    const filas = PATRONES_FILA.map(hecha);
    const columnas = PATRONES_COLUMNA.map(hecha);
    const diagonales = PATRONES_DIAGONAL.map(hecha);
    const hayLinea = tipoLinea === 'fila'
        ? filas.some(Boolean)
        : (filas.some(Boolean) || columnas.some(Boolean) || diagonales.some(Boolean));
    return { aciertos, validas, total, filas, columnas, diagonales, linea: hayLinea, apagon: aciertos >= total };
}

/** Datos de un cartón para el cliente, con su cotejo ya calculado */
function infoCarton(sala, c) {
    const a = analizar(c.rows, c.marcadas, sala.salidos, sala.tipoLinea);
    return {
        id: c.id, serie: c.serie, rows: c.rows, marcadas: c.marcadas, pagado: c.pagado,
        aciertos: a.aciertos, validas: a.validas, total: a.total,
        filas: a.filas, columnas: a.columnas, diagonales: a.diagonales,
        linea: a.linea, apagon: a.apagon
    };
}

/* --------------------------- Jugadores --------------------------- */

function buscarJugador(sala, pid, alias) {
    let j = sala.jugadores.find(x => x.pid === pid);
    if (!j && alias) j = sala.jugadores.find(x => x.alias.toLowerCase() === String(alias).toLowerCase().trim());
    return j || null;
}

/** Pasa el bombo a un jugador y deja el aviso para que invite a los demás */
function tomarBombo(sala, j, texto) {
    const previo = sala.jugadores.find(x => x.rol === 'cantador' && x.pid !== j.pid);
    if (previo) previo.rol = 'jugador';
    j.rol = 'cantador';
    sala.aviso = { pid: j.pid, hora: ahora() };
    mensaje(sala, '🎤 ' + j.alias + ' ' + texto, 'aviso');
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
            entrada: Date.now(),
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
    // El primero que entra canta. Si el cantador ya no está (salió o se
    // desconectó), el bombo pasa al siguiente que entra.
    const cantador = sala.jugadores.find(x => x.rol === 'cantador');
    if (!cantador) {
        tomarBombo(sala, j, 'es el cantador (controla el bombo y canta)');
    } else if (cantador.pid !== j.pid && !cantador.conectado) {
        tomarBombo(sala, j, 'toma el bombo porque ' + cantador.alias + ' salió de la sala');
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
    // "El siguiente": el que lleva más tiempo conectado en la sala.
    const siguiente = sala.jugadores
        .filter(j => j.conectado)
        .sort((a, b) => (a.entrada || 0) - (b.entrada || 0))[0];
    if (siguiente) tomarBombo(sala, siguiente, 'toma el bombo');
}

/* --------------------------- Sorteo --------------------------- */

function cantar(sala) {
    if (!sala.disponibles.length) { detenerAuto(sala); return null; }
    if (!sala.iniciada) {
        sala.iniciada = true;
        mensaje(sala, '▶ ¡Empieza el canto! Ya pueden marcar sus cartones', 'aviso');
    }
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

/** Congela la evidencia de una jugada para que el cantador pueda cotejarla */
function registrarCotejo(sala, d) {
    const a = analizar(d.c.rows, d.c.marcadas, sala.salidos, sala.tipoLinea);
    const reg = {
        id: uid(6),
        premio: d.premio === 'apagon' ? 'apagon' : 'linea',
        alias: d.jugador.alias,
        pid: d.jugador.pid,
        cartonId: d.c.id,
        serie: d.c.serie,
        estado: d.estado,               // 'valido' | 'rechazado'
        motivo: d.motivo || '',
        auto: !!d.esAuto,
        hora: ahora(),
        confirmado: false,
        anulado: false,
        evidencia: {
            rows: d.c.rows.map(r => r.slice()),
            marcadas: d.c.marcadas.slice(),
            salidos: sala.salidos.slice(),
            letras: sala.config.letras,
            tipoLinea: sala.tipoLinea,
            analisis: a
        }
    };
    sala.cotejos.unshift(reg);
    if (sala.cotejos.length > 20) sala.cotejos.pop();
    return reg;
}

function adjudicar(sala, premio, jugador, c, esAuto) {
    const reg = {
        alias: jugador.alias, serie: c.serie, id: c.id, pid: jugador.pid,
        auto: !!esAuto, hora: ahora(), estado: 'pendiente'
    };
    if (premio === 'linea') sala.premioLinea = reg; else sala.premioApagon = reg;
    registrarCotejo(sala, { premio, jugador, c, estado: 'valido', esAuto });
    mensaje(sala, (premio === 'linea' ? '🏆 ¡LÍNEA!' : '🌟 ¡APAGÓN!') + ' ' + jugador.alias +
        ' — cartón ' + c.serie + ' · el cantador debe cotejarlo', 'premio');
}

function abrirRonda(sala) {
    sala.firmas = new Set(sala.cartones.map(c => JSON.stringify(c.rows)));
    sala.salidos = [];
    sala.disponibles = Array.from({ length: 75 }, (_, i) => i + 1);
    sala.actual = null;
    sala.premioLinea = null;
    sala.premioApagon = null;
    sala.cotejos = [];
    sala.iniciada = false;
    sala.aviso = null;
    sala.cartones.forEach(c => { c.marcadas = ['2-2']; });
    detenerAuto(sala);
    mensaje(sala, '🔄 Nueva ronda: abonen sus cartones y esperen el canto', 'aviso');
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

    const misCartones = cartonesDe(sala, j.pid).map(c => infoCarton(sala, c));
    const soyCantador = j.rol === 'cantador';

    const jugadores = sala.jugadores.map(x => {
        const mios = cartonesDe(sala, x.pid);
        return {
            pid: x.pid,
            alias: x.alias,
            rol: x.rol,
            conectado: x.conectado,
            cartones: mios.length,
            pedidos: mios.map(c => {
                const a = analizar(c.rows, c.marcadas, sala.salidos, sala.tipoLinea);
                return {
                    id: c.id, serie: c.serie, pagado: c.pagado,
                    linea: a.linea, apagon: a.apagon,
                    aciertos: a.aciertos, total: a.total, filas: a.filas
                };
            }),
            debe: mios.filter(c => c.pagado !== 'pagado').length * sala.config.abono,
            auto: x.auto
        };
    });

    const totalCartones = sala.cartones.length;
    return {
        tipo: 'estado',
        sala: sala.codigo,
        revision: ++sala.revision,
        iniciada: !!sala.iniciada,
        exigirAbono: !!sala.exigirAbono,
        aviso: sala.aviso,
        fondo: {
            tipo: sala.fondo ? sala.fondo.tipo : 'ninguno',
            patron: sala.fondo ? sala.fondo.patron : '',
            opacidad: sala.fondo ? sala.fondo.opacidad : 0.35,
            version: sala.fondo ? sala.fondo.version : 0
        },
        cotejos: soyCantador ? sala.cotejos.slice(0, 8) : [],
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
            if (payload.exigirAbono !== undefined) sala.exigirAbono = !!payload.exigirAbono;
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
                // El jugador solo declara; dar el abono por bueno es cosa del cantador.
                if (!esCantador()) return { error: 'Solo el cantador confirma el abono (tú puedes declararlo)' };
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

        case 'iniciar': {
            if (!esCantador()) return { error: 'Solo el cantador inicia la ronda' };
            sala.iniciada = true;
            mensaje(sala, '▶ ' + j.alias + ' inició la ronda. ¡A cantar!', 'aviso');
            break;
        }

        case 'fondo': {
            if (!esCantador()) return { error: 'Solo el cantador cambia el fondo de los cartones' };
            const f = payload.fondo || {};
            const tipo = f.tipo === 'foto' ? 'foto' : (f.tipo === 'patron' ? 'patron' : 'ninguno');
            let opacidad = Number(f.opacidad);
            if (isNaN(opacidad)) opacidad = 0.35;
            opacidad = Math.max(0.05, Math.min(0.95, opacidad));
            if (tipo === 'foto') {
                const foto = String(payload.foto || '');
                if (!/^data:image\/(png|jpe?g|webp);base64,/.test(foto)) return { error: 'La foto debe ser PNG, JPG o WEBP' };
                if (foto.length > 3.5e6) return { error: 'La foto es muy pesada. Prueba con una más liviana.' };
                sala.fondoUrl = foto;
            } else if (tipo === 'ninguno') {
                sala.fondoUrl = null;
            }
            sala.fondo = {
                tipo,
                patron: tipo === 'patron' ? (['papel', 'tela', 'madera'].indexOf(f.patron) >= 0 ? f.patron : 'papel') : '',
                opacidad,
                version: (sala.fondo ? sala.fondo.version : 0) + (tipo === 'foto' ? 1 : 0)
            };
            mensaje(sala, tipo === 'ninguno' ? '🎨 El cantador quitó el fondo de los cartones'
                : '🎨 El cantador cambió el fondo de los cartones', 'aviso');
            break;
        }

        case 'cotejo': {
            if (!esCantador()) return { error: 'Solo el cantador coteja los premios' };
            const co = sala.cotejos.find(x => x.id === payload.cotejoId);
            if (!co) return { error: 'Ese cotejo ya no está disponible' };
            if (co.estado !== 'valido') return { error: 'Ese canto fue rechazado automáticamente' };
            const que = co.premio === 'linea' ? 'premio de línea' : 'apagón';
            if (payload.decision === 'anular') {
                co.anulado = true;
                co.confirmado = false;
                const reg = co.premio === 'linea' ? sala.premioLinea : sala.premioApagon;
                if (reg && reg.id === co.cartonId) {
                    if (co.premio === 'linea') sala.premioLinea = null; else sala.premioApagon = null;
                }
                mensaje(sala, '✘ El cantador anuló el ' + que + ' de ' + co.alias, 'aviso');
            } else {
                co.confirmado = true;
                co.anulado = false;
                const reg = co.premio === 'linea' ? sala.premioLinea : sala.premioApagon;
                if (reg && reg.id === co.cartonId) reg.estado = 'oficial';
                mensaje(sala, '✔ El cantador dio por bueno el ' + que + ' de ' + co.alias, 'premio');
            }
            break;
        }

        case 'verCarton': {
            const c = carton(sala, payload.cartonId);
            if (!c) return { error: 'Cartón no encontrado' };
            if (c.dueno !== j.pid && !esCantador()) return { error: 'Ese cartón no es tuyo' };
            const dueno = sala.jugadores.find(x => x.pid === c.dueno);
            return {
                ok: true,
                carton: Object.assign(infoCarton(sala, c), {
                    alias: dueno ? dueno.alias : '—',
                    salidos: sala.salidos.slice(),
                    letras: sala.config.letras,
                    tipoLinea: sala.tipoLinea
                })
            };
        }

        case 'salir': {
            detenerAuto(sala);
            sala.cartones = sala.cartones.filter(c => c.dueno !== j.pid);
            sala.jugadores = sala.jugadores.filter(x => x.pid !== j.pid);
            mensaje(sala, j.alias + ' salió de la sala', 'aviso');
            reasignarCantador(sala);
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
            if (!valido) {
                // El intento también se coteja: el cantador ve el cartón y por qué no gana
                const motivo = premio === 'linea' ? 'Aún no completas ninguna línea' : 'Aún no llenas el cartón completo';
                const intento = candidatos.slice().sort((a, b) =>
                    analizar(b.rows, b.marcadas, sala.salidos, sala.tipoLinea).aciertos -
                    analizar(a.rows, a.marcadas, sala.salidos, sala.tipoLinea).aciertos)[0];
                if (intento) {
                    const a = analizar(intento.rows, intento.marcadas, sala.salidos, sala.tipoLinea);
                    registrarCotejo(sala, {
                        premio, jugador: j, c: intento, estado: 'rechazado',
                        motivo: motivo + ' (' + a.aciertos + ' de ' + a.total + ' casillas)'
                    });
                    mensaje(sala, '⚠️ ' + j.alias + ' cantó ' + (premio === 'linea' ? 'línea' : 'apagón') + ' sin completarlo', 'aviso');
                    emitir(sala);
                }
                return { error: motivo };
            }
            if (sala.exigirAbono && valido.pagado !== 'pagado') {
                return { error: 'El cartón ' + valido.serie + ' no tiene el abono confirmado' };
            }
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
            tomarBombo(sala, destino, 'recibe el bombo de ' + j.alias);
            break;
        }

        case 'expulsar': {
            if (!esCantador()) return { error: 'Solo el cantador puede quitar jugadores' };
            if (payload.pidDestino === j.pid) return { error: 'No puedes quitarte a ti mismo' };
            detenerAuto(sala);
            sala.cartones = sala.cartones.filter(c => c.dueno !== payload.pidDestino);
            sala.jugadores = sala.jugadores.filter(x => x.pid !== payload.pidDestino);
            reasignarCantador(sala);
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
        req.on('data', c => { data += c; if (data.length > 4e6) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    });
}

function estatico(req, res, url) {
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
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
                jug.desconexion = setTimeout(() => { reasignarCantador(sala); emitir(sala); }, 12000);
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

    if (p === '/api/sala') {
        const codigo = (url.searchParams.get('sala') || '').toUpperCase().trim();
        const s = salas.get(codigo);
        const cant = s ? s.jugadores.find(x => x.rol === 'cantador') : null;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({
            ok: true,
            codigo,
            existe: !!s,
            conectados: s ? s.jugadores.filter(x => x.conectado).length : 0,
            cantador: cant ? cant.alias : '',
            iniciada: s ? !!s.iniciada : false
        }));
    }

    if (p === '/api/fondo') {
        const codigo = (url.searchParams.get('sala') || '').toUpperCase().trim();
        const s = salas.get(codigo);
        const m = s && s.fondoUrl ? /^data:([^;]+);base64,(.*)$/.exec(s.fondoUrl) : null;
        if (!m) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('sin fondo'); }
        const buf = Buffer.from(m[2], 'base64');
        res.writeHead(200, {
            'Content-Type': m[1],
            'Content-Length': buf.length,
            'Cache-Control': 'public, max-age=31536000, immutable'
        });
        return res.end(buf);
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
    console.log('\n  🎱  AplicaBingo listo');
    console.log('  Entrada para todos: http://localhost:' + PUERTO + '/');
    ips.forEach(ip => console.log('  Desde el móvil:     http://' + ip + ':' + PUERTO + '/'));
    console.log('  Sala directa:       http://localhost:' + PUERTO + '/grupo.html');
    console.log('  Modo local (1 PC):  http://localhost:' + PUERTO + '/solo.html');
    console.log('  (Ctrl+C para detener)\n');
});
