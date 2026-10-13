/**
 * AplicaBingo — Cliente de sala (cantador / jugadores / cotejo de premios)
 * El servidor (server.js) es la autoridad: sala, cantador, cartones, marcas y premios.
 */
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const LETRAS = { ABCDE: ['A', 'B', 'C', 'D', 'E'], BINGO: ['B', 'I', 'N', 'G', 'O'] };
    const params = new URLSearchParams(location.search);

    let pid = localStorage.getItem('bg_pid');
    if (!pid) {
        pid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2);
        localStorage.setItem('bg_pid', pid);
    }
    let codigo = (params.get('sala') || localStorage.getItem('bg_sala') || '').toUpperCase();
    let estado = null;
    let es = null;
    let vozOn = true;
    let vistoNumero = null;
    let vistoLinea = null;
    let vistoApagon = null;
    let vistoAviso = null;
    let rolPrevio = null;
    let fondoLocal = leerFondoLocal();
    let toastTimer = null;

    /* ------------------------- utilidades ------------------------- */

    function numEs(n) {
        const u = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
            'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
            'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
        if (n < 30) return u[n];
        const d = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta'];
        const dec = Math.floor(n / 10), uni = n % 10;
        return d[dec] + (uni ? ' y ' + u[uni] : '');
    }

    function letraDe(num, esquema) {
        const l = LETRAS[esquema] || LETRAS.ABCDE;
        if (num <= 15) return l[0];
        if (num <= 30) return l[1];
        if (num <= 45) return l[2];
        if (num <= 60) return l[3];
        return l[4];
    }

    const dinero = (n, moneda) => (moneda || 'S/') + ' ' + (Number(n) || 0).toFixed(2);

    const urlSala = () => location.origin + location.pathname.replace(/[^/]*$/, '') + 'grupo.html?sala=' + codigo;

    /* ---------- Fondo de los cartones: foto o patrón, propio o de la sala ---------- */

    function leerFondoLocal() {
        try {
            const f = JSON.parse(localStorage.getItem('bg_fondo') || 'null');
            return (f && typeof f === 'object') ? f : null;
        } catch (e) { return null; }
    }

    function guardarFondoLocal(f) {
        fondoLocal = f;
        try {
            if (f) localStorage.setItem('bg_fondo', JSON.stringify(f));
            else localStorage.removeItem('bg_fondo');
        } catch (e) { /* sin espacio: se aplica solo en esta pantalla */ }
        aplicarFondo();
    }

    /** Reduce la foto en el navegador para no saturar la red de la sala */
    function prepararFoto(archivo, maxLado, listo, fallo) {
        const lector = new FileReader();
        lector.onload = () => {
            const img = new Image();
            img.onload = () => {
                const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
                const lienzo = document.createElement('canvas');
                lienzo.width = Math.max(1, Math.round(img.width * escala));
                lienzo.height = Math.max(1, Math.round(img.height * escala));
                lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
                listo(lienzo.toDataURL('image/jpeg', 0.72));
            };
            img.onerror = () => fallo('No se pudo leer esa imagen');
            img.src = lector.result;
        };
        lector.onerror = () => fallo('No se pudo leer ese archivo');
        lector.readAsDataURL(archivo);
    }

    /** El fondo propio gana sobre el de la sala; solo cambia lo que se ve aquí */
    function aplicarFondo() {
        const deSala = (estado && estado.fondo && estado.fondo.tipo !== 'ninguno') ? estado.fondo : null;
        const mio = (fondoLocal && fondoLocal.tipo && fondoLocal.tipo !== 'ninguno') ? fondoLocal : null;
        const f = mio || deSala;
        const cuerpo = document.body;
        cuerpo.classList.remove('fondo-papel', 'fondo-tela', 'fondo-madera');
        cuerpo.style.removeProperty('--carton-foto');
        cuerpo.style.removeProperty('--carton-opacidad');
        if (!f) return;
        let op = f.opacidad;
        if (op === undefined || op === null) op = deSala ? deSala.opacidad : 0.35;
        cuerpo.style.setProperty('--carton-opacidad', String(op));
        if (f.tipo === 'foto') {
            const url = f.foto ? f.foto : (location.origin + '/api/fondo?sala=' + codigo + '&v=' + (deSala ? deSala.version : 0));
            cuerpo.style.setProperty('--carton-foto', 'url("' + url + '")');
        } else if (f.tipo === 'patron') {
            cuerpo.classList.add('fondo-' + (f.patron || 'papel'));
        }
    }

    function toast(texto, malo) {
        const t = $('toast');
        t.textContent = texto;
        t.classList.toggle('malo', !!malo);
        t.classList.remove('g-hidden');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.add('g-hidden'), malo ? 3500 : 6000);
    }

    function hablar(texto) {
        if (!vozOn || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = 'es-ES';
        u.rate = 1.0;
        window.speechSynthesis.speak(u);
    }

    /* -------- Diagnóstico: ¿la página la sirve el servidor del juego? -------- */
    function pistaServidor() {
        if (location.protocol === 'file:') {
            return 'Estás abriendo el archivo directamente (file://). Ejecuta «node server.js» en la carpeta del proyecto y entra por http://localhost:3000/grupo.html';
        }
        return 'Parece que esta página no la sirve el servidor del juego (estás en ' + location.origin + '). ' +
            'Ejecuta «node server.js» en la carpeta del proyecto y entra por http://localhost:3000/grupo.html. ' +
            'No uses Live Server, XAMPP, «npx serve» ni otro servidor estático: solo devuelven HTML y el juego necesita su API.';
    }

    function mostrarAviso(texto) {
        const el = $('avisoServidor');
        el.textContent = texto;
        el.classList.remove('g-hidden');
    }

    function ocultarAviso() { $('avisoServidor').classList.add('g-hidden'); }

    async function comprobarServidor() {
        if (location.protocol === 'file:') { mostrarAviso('⚠️ ' + pistaServidor()); return; }
        try {
            const r = await fetch('/api/salud', { cache: 'no-store' });
            const j = JSON.parse(await r.text());
            if (!j || j.ok !== true) throw new Error('respuesta inesperada');
            ocultarAviso();
        } catch (e) {
            mostrarAviso('⚠️ No se pudo comprobar el servidor del juego (¿está corriendo «node server.js»?). ' + pistaServidor());
        }
    }

    async function accion(tipo, datos) {
        const body = Object.assign({ tipo, codigo, pid }, datos || {});
        let r;
        try {
            r = await fetch('/api/accion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (e) {
            mostrarAviso('⚠️ No se pudo conectar con el servidor del juego. ' + pistaServidor());
            toast('Sin conexión con el servidor del juego', true);
            return { error: 'red' };
        }

        const texto = await r.text();
        let out = null;
        try { out = JSON.parse(texto); } catch (e) { out = null; }
        if (!out || typeof out !== 'object') {
            const tipoResp = (r.headers.get('content-type') || 'desconocido').split(';')[0];
            mostrarAviso('⚠️ El servidor respondió HTTP ' + r.status + ' (' + tipoResp + ') en lugar de JSON. ' + pistaServidor());
            toast('Respuesta inválida del servidor (HTTP ' + r.status + ')', true);
            return { error: 'invalida' };
        }
        if (out.error) toast(out.error, true);
        return out;
    }

    /* --------------------------- ingreso --------------------------- */

    async function entrar(alias, sala) {
        codigo = String(sala || '').toUpperCase().trim();
        const out = await accion('unirse', { alias });
        if (out.error) { $('inError').textContent = out.error; return; }
        localStorage.setItem('bg_alias', alias);
        localStorage.setItem('bg_sala', codigo);
        $('pantallaIngreso').classList.add('g-hidden');
        $('pantallaSala').classList.remove('g-hidden');
        $('hAlias').textContent = alias;
        conectar();
    }

    $('formIngreso').addEventListener('submit', (e) => {
        e.preventDefault();
        const alias = $('inAlias').value.trim();
        if (!alias) { $('inError').textContent = 'Escribe tu alias o nombre'; return; }
        const escrita = ($('inSala').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (escrita) codigo = escrita;
        // Sin código de sala, el primero en entrar crea la suya y canta.
        if (!codigo) codigo = Math.random().toString(36).slice(2, 6).toUpperCase();
        $('inError').textContent = '';
        entrar(alias, codigo);
    });

    $('inSala').addEventListener('input', () => {
        codigo = ($('inSala').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        actualizarDestino();
        revisarSala();
    });

    function actualizarDestino() {
        const el = $('inDestino');
        if (!el) return;
        if (codigo) {
            el.innerHTML = 'Entrarás a la sala <strong>' + codigo + '</strong>. El primero que entra canta y los demás esperan su canto.';
        } else {
            el.innerHTML = 'Sin código de sala: al entrar <strong>creas una sala nueva</strong> y serás el <strong>cantador</strong>. ' +
                'Después envía la invitación a los demás.';
        }
    }

    /** Muestra si la sala escrita ya existe y quién canta en ella */
    async function revisarSala() {
        const el = $('inDestino');
        if (!el || !codigo || location.protocol === 'file:') return;
        try {
            const r = await fetch('/api/sala?sala=' + encodeURIComponent(codigo), { cache: 'no-store' });
            const j = await r.json();
            if (!j || !j.existe) { actualizarDestino(); return; }
            el.innerHTML = 'La sala <strong>' + codigo + '</strong> ya está abierta' +
                (j.cantador ? ' · canta <strong>' + esc(j.cantador) + '</strong>' : '') +
                ' · ' + j.conectados + ' conectado(s). Entrarás como jugador.';
        } catch (e) { /* sin servidor: se avisa abajo */ }
    }

    /* --------------------------- conexión --------------------------- */

    let sseAbierto = false;

    function conectar() {
        if (es) es.close();
        sseAbierto = false;
        es = new EventSource('/api/eventos?sala=' + encodeURIComponent(codigo) + '&pid=' + encodeURIComponent(pid));
        es.onmessage = (ev) => {
            let d;
            try { d = JSON.parse(ev.data); } catch (e) { return; }
            if (d.tipo === 'estado') { estado = d; render(); }
            else if (d.tipo === 'error') toast(d.texto, true);
        };
        es.onopen = () => { sseAbierto = true; $('hOnline').classList.remove('off'); ocultarAviso(); };
        es.onerror = () => {
            $('hOnline').classList.add('off');
            if (!sseAbierto) mostrarAviso('⚠️ Sin conexión en vivo con la sala. ' + pistaServidor());
        };
    }

    /* --------------------------- render --------------------------- */

    function render() {
        if (!estado) return;
        $('hSala').textContent = estado.sala;
        $('hAlias').textContent = estado.yo.alias;
        const cant = estado.yo.rol === 'cantador';
        $('hRol').textContent = cant ? 'CANTADOR' : 'JUGADOR';
        $('hRol').classList.toggle('jugador', !cant);
        $('hOnline').classList.toggle('off', !estado.yo.conectado);
        $('vistaCantador').classList.toggle('g-hidden', !cant);
        $('vistaJugador').classList.toggle('g-hidden', cant);
        document.body.classList.toggle('soy-cantador', cant);

        // Si el bombo acaba de pasar a tus manos: avisar y ofrecer la invitación
        if (estado.aviso && estado.aviso.pid === estado.yo.pid && estado.aviso.hora !== vistoAviso) {
            vistoAviso = estado.aviso.hora;
            if (rolPrevio === 'jugador') {
                toast('🎤 Ahora cantas tú. Envía la invitación a los demás.');
                hablar('Ahora cantas tú. Envía la invitación.');
                abrirModalInvitacion(true);
            }
        }
        rolPrevio = estado.yo.rol;

        aplicarFondo();
        avisarPremios();
        if (cant) renderCantador(); else renderJugador();
    }

    function avisarPremios() {
        const l = estado.premioLinea, a = estado.premioApagon;
        const claveL = l ? l.serie + l.hora : null;
        const claveA = a ? a.serie + a.hora : null;
        if (claveL && claveL !== vistoLinea) {
            vistoLinea = claveL;
            toast('🏆 ¡LÍNEA! ' + l.alias + ' · cartón ' + l.serie + (l.estado === 'oficial' ? '' : ' · por cotejar'));
            hablar('Línea para ' + l.alias);
        }
        if (claveA && claveA !== vistoApagon) {
            vistoApagon = claveA;
            toast('🌟 ¡APAGÓN! ' + a.alias + ' · cartón ' + a.serie + (a.estado === 'oficial' ? '' : ' · por cotejar'));
            hablar('Apagón para ' + a.alias);
        }
    }

    /* --------------------------- cantador --------------------------- */

    function renderCantador() {
        const s = estado.sorteo;
        const esquema = estado.config.letras || 'ABCDE';
        const letras = LETRAS[esquema];

        if (s.actual) {
            $('dLetra').textContent = letraDe(s.actual, esquema);
            $('dDecenas').textContent = Math.floor(s.actual / 10);
            $('dUnidades').textContent = s.actual % 10;
        } else {
            $('dLetra').textContent = letras[0];
            $('dDecenas').textContent = '0';
            $('dUnidades').textContent = '0';
        }
        if (s.actual !== vistoNumero) {
            vistoNumero = s.actual;
            $('bombo').classList.add('popping');
            setTimeout(() => $('bombo').classList.remove('popping'), 400);
            if (s.actual) hablar(letraDe(s.actual, esquema) + ', ' + numEs(s.actual));
        }

        $('btnAuto').textContent = '⏱️ Auto: ' + (s.auto ? 'ON' : 'OFF');
        $('btnAuto').classList.toggle('peligro', !!s.auto);
        $('btnCantar').disabled = s.restantes === 0 || !!s.auto;
        $('btnCantar').textContent = s.restantes === 0 ? 'Todos los números salieron' : '▶ Cantar número';
        $('infoSorteo').textContent = 'Salieron ' + s.salidos.length + ' de ' + s.total + ' · faltan ' + s.restantes +
            ' · premio de línea: ' + (estado.tipoLinea === 'fila' ? 'fila horizontal' : 'fila, columna o diagonal') +
            (estado.cantarAutomatico ? ' · canto automático ON' : '');

        $('historial').innerHTML = s.salidos.slice(-14).reverse()
            .map((n, i) => '<span class="g-bola' + (i === 0 ? ' ultima' : '') + '">' + letraDe(n, esquema) + ' ' + String(n).padStart(2, '0') + '</span>')
            .join('') || '<span class="g-bola">Sin cantar todavía</span>';

        // Config (sin pisar lo que se está escribiendo)
        const campos = {
            cfAbono: estado.config.abono, cfMoneda: estado.config.moneda,
            cfPct: estado.config.premioLineaPct, cfIntervalo: estado.config.autoIntervalo
        };
        Object.keys(campos).forEach(id => {
            const el = $(id);
            if (document.activeElement !== el && String(campos[id]) !== el.value) el.value = campos[id];
        });
        if (document.activeElement !== $('cfTipoLinea')) $('cfTipoLinea').value = estado.tipoLinea;
        if (document.activeElement !== $('cfLetras')) $('cfLetras').value = estado.config.letras;
        $('cfCantoAuto').checked = !!estado.cantarAutomatico;
        $('cfExigirAbono').checked = !!estado.exigirAbono;
        $('enlaceSala').textContent = 'Enlace para jugadores: ' + urlSala() + '  (toca para copiar)';

        // Ronda: los jugadores abonan y esperan el canto del cantador
        const jugadores = estado.jugadores.filter(x => x.rol !== 'cantador');
        const abonados = jugadores.filter(x => x.pedidos.length && x.pedidos.every(c => c.pagado === 'pagado')).length;
        const conCartones = jugadores.filter(x => x.cartones > 0).length;
        $('btnIniciar').disabled = !!estado.iniciada;
        $('btnIniciar').textContent = estado.iniciada ? '▶ Ronda en curso' : '▶ Iniciar ronda';
        $('txtInicio').innerHTML = (estado.iniciada
            ? 'Ronda <strong>en curso</strong>. '
            : 'Ronda <strong>sin empezar</strong>: los jugadores están abonando y esperando tu canto. ') +
            'Jugadores: <strong>' + jugadores.length + '</strong> · con cartones: <strong>' + conCartones + '</strong>' +
            ' · con abono confirmado: <strong>' + abonados + '</strong>' +
            ' · cantados: <strong>' + estado.sorteo.salidos.length + '/75</strong>';

        renderCotejos();

        const d = estado.dinero;
        $('kpis').innerHTML =
            kpi('Abono por cartón', dinero(d.abono, d.moneda)) +
            kpi('Recaudado', dinero(d.recaudado, d.moneda)) +
            kpi('Por cobrar', dinero(d.porCobrar, d.moneda)) +
            kpi('Premio línea', dinero(d.premioLinea, d.moneda)) +
            kpi('Premio apagón', dinero(d.premioApagon, d.moneda));

        $('tablaJugadores').innerHTML = estado.jugadores.map(j => {
            const pagados = j.pedidos.filter(c => c.pagado === 'pagado').length;
            const badge = j.pedidos.length === 0 ? '<span class="g-badge pendiente">sin cartones</span>'
                : (pagados === j.pedidos.length ? '<span class="g-badge pagado">pagado</span>'
                    : '<span class="g-badge ' + (j.pedidos.some(c => c.pagado === 'declarado') ? 'declarado' : 'pendiente') + '">' +
                      (pagados > 0 ? pagados + '/' + j.pedidos.length + ' pagados' : 'pendiente') + '</span>');
            const acciones = [];
            if (j.cartones) acciones.push('<button class="g-btn mini dark" data-vista="' + j.pid + '" title="Ver sus cartones y aciertos">🔍 Ver</button>');
            if (j.pedidos.some(c => c.pagado !== 'pagado')) acciones.push('<button class="g-btn mini" data-acc="pagar" data-j="' + j.pid + '">Cobrar</button>');
            if (j.pedidos.some(c => c.pagado === 'pagado')) acciones.push('<button class="g-btn mini ghost" data-acc="devolver" data-j="' + j.pid + '">↩︎</button>');
            if (j.rol !== 'cantador') acciones.push('<button class="g-btn mini dark" data-acc="bombo" data-j="' + j.pid + '" title="Pasar el bombo">🎤</button>');
            if (j.rol !== 'cantador') acciones.push('<button class="g-btn mini peligro" data-acc="quitar" data-j="' + j.pid + '" title="Quitar de la sala">✕</button>');
            return '<tr><td>' + esc(j.alias) + (j.rol === 'cantador' ? ' 🎤' : '') +
                (j.conectado ? '' : ' <small style="color:#c53030">(desconectado)</small>') + '</td>' +
                '<td>' + j.cartones + (j.auto ? ' <small>· auto</small>' : ' <small>· manual</small>') + '</td>' +
                '<td>' + badge + '</td><td><div class="acciones">' + acciones.join('') + '</div></td></tr>';
        }).join('') || '<tr><td colspan="4">Nadie más ha entrado todavía</td></tr>';

        $('novedadesCantador').innerHTML = estado.mensajes.map(m =>
            '<li class="' + (m.tipo === 'premio' ? 'premio' : '') + '"><span class="hora">' + m.hora + '</span>' + esc(m.texto) + '</li>'
        ).join('') || '<li>Sin novedades</li>';
    }

    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const kpi = (t, v) => '<div class="g-kpi"><span>' + t + '</span><strong>' + v + '</strong></div>';

    /** Panel de cotejo: cada canto con su cartón congelado para verificar si ganó */
    function renderCotejos() {
        const cont = $('listaCotejos');
        if (!cont) return;
        const lista = estado.cotejos || [];
        if (!lista.length) {
            cont.innerHTML = '<p class="g-hint">Sin cantos todavía. Cuando alguien cante línea o apagón aparecerá aquí su cartón para cotejarlo.</p>';
            return;
        }
        cont.innerHTML = lista.map(co => {
            const e = co.evidencia || {};
            const a = e.analisis || {};
            const chip = co.estado === 'rechazado'
                ? '<span class="g-badge pendiente">rechazado</span>'
                : (co.anulado ? '<span class="g-badge pendiente">anulado</span>'
                    : (co.confirmado ? '<span class="g-badge pagado">dado por bueno</span>'
                        : '<span class="g-badge declarado">por cotejar</span>'));
            const botones = (co.estado === 'valido' && !co.confirmado && !co.anulado)
                ? '<button class="g-btn mini" data-cotejo="' + co.id + '" data-decision="confirmar">✔ Dar por bueno</button>' +
                  '<button class="g-btn mini peligro" data-cotejo="' + co.id + '" data-decision="anular">✘ Anular</button>'
                : '';
            return '<div class="g-cotejo">' +
                '<div class="g-cotejo-cab">' +
                '<strong>' + (co.premio === 'linea' ? '🏆 LÍNEA' : '🌟 APAGÓN') + ' · ' + esc(co.alias) + '</strong>' +
                '<span class="g-serie">cartón ' + esc(co.serie) + ' · ' + co.hora + '</span>' + chip + '</div>' +
                (co.motivo ? '<p class="g-hint">' + esc(co.motivo) + '</p>' : '') +
                miniCarton(e.rows || [], e.marcadas || [], e.salidos || [], e.letras) +
                '<p class="g-hint">' + resumenAciertos(a, e.letras, e.tipoLinea) +
                ' · números cantados al canto: ' + (e.salidos ? e.salidos.length : 0) + '/75</p>' +
                (botones ? '<div class="g-botones">' + botones + '</div>' : '') +
                '</div>';
        }).join('');
    }

    /* --------------------------- cotejo / verificación --------------------------- */

    function abrirModal(titulo, html) {
        $('modalTitulo').textContent = titulo;
        $('modalCuerpo').innerHTML = html;
        $('modal').classList.remove('g-hidden');
    }

    function cerrarModal() {
        $('modal').classList.add('g-hidden');
        $('modalCuerpo').innerHTML = '';
    }

    /** Cartón de solo lectura: sirve para cotejar (marcas + números cantados) */
    function miniCarton(rows, marcadas, salidos, esquema) {
        const L = LETRAS[esquema] || LETRAS.ABCDE;
        const marcas = new Set(marcadas || []);
        const sal = new Set(salidos || []);
        const filas = [0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(c => r + '-' + c).every(k => marcas.has(k)));
        let h = '<div class="g-mini"><div class="g-mini-grid">';
        L.forEach(l => { h += '<div class="g-mini-head">' + l + '</div>'; });
        h += '<div class="g-mini-head rail"></div>';
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const v = rows[r][c];
                const key = r + '-' + c;
                const marcada = v === 'LIBRE' || marcas.has(key);
                const salio = v !== 'LIBRE' && sal.has(v);
                h += '<div class="g-mini-cell' + (salio ? ' salio' : '') + (marcada ? ' marcado' : '') +
                    (filas[r] ? ' fila-ok' : '') + '">' + (v === 'LIBRE' ? '★' : v) + '</div>';
            }
            h += '<div class="g-mini-rail' + (filas[r] ? ' ok' : '') + '">' + (filas[r] ? '✓' : (r + 1)) + '</div>';
        }
        return h + '</div></div>';
    }

    /** Explica los aciertos por fila, columna y diagonal (lo que mira el ganador) */
    function resumenAciertos(a, esquema, tipoLinea) {
        const nombres = ['1ª', '2ª', '3ª', '4ª', '5ª'];
        const partes = [];
        const filas = [];
        (a.filas || []).forEach((ok, i) => { if (ok) filas.push(nombres[i]); });
        partes.push(filas.length ? '<span class="g-ok">Filas completas: ' + filas.join(', ') + '</span>'
            : 'Filas completas: ninguna');
        if (tipoLinea === 'cualquiera') {
            const cols = [];
            (a.columnas || []).forEach((ok, i) => { if (ok) cols.push((i + 1) + 'ª'); });
            const diag = [];
            (a.diagonales || []).forEach((ok, i) => { if (ok) diag.push(i === 0 ? '↘' : '↙'); });
            if (cols.length) partes.push('Columnas: ' + cols.join(', '));
            if (diag.length) partes.push('Diagonales: ' + diag.join(', '));
        }
        partes.push('Aciertos: <strong>' + (a.aciertos || 0) + '/' + (a.total || 24) + '</strong>' +
            (a.apagon ? ' · <span class="g-ok">cartón lleno</span>' : ''));
        return partes.join(' · ');
    }

    function textoInvitacion() {
        return '🎱 AplicaBingo — te invito a la sala ' + codigo + '.\n' +
            'Entra con tu alias: ' + urlSala() + '\n' +
            'Recibes tus cartones, abonas lo que te toca y esperas el canto.';
    }

    async function copiarEnlace() {
        const url = urlSala();
        try { await navigator.clipboard.writeText(url); toast('Enlace copiado: ' + url); }
        catch (e) { prompt('Comparte este enlace con los jugadores:', url); }
    }

    async function compartir() {
        const texto = textoInvitacion();
        if (navigator.share) {
            try { await navigator.share({ title: 'AplicaBingo · sala ' + codigo, text: texto, url: urlSala() }); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(texto); toast('Invitación copiada. Pégala en tu grupo.'); }
        catch (e) { prompt('Copia esta invitación:', texto); }
    }

    function abrirModalInvitacion(destacado) {
        const wa = 'https://wa.me/?text=' + encodeURIComponent(textoInvitacion());
        abrirModal('Invitar jugadores a la sala ' + codigo,
            (destacado ? '<p class="g-destacado">Ahora cantas tú: envía la invitación para que entren los jugadores.</p>' : '') +
            '<p class="g-enlace" id="enlaceModal">' + urlSala() + '</p>' +
            '<div class="g-botones">' +
            '<button class="g-btn" id="btnCompartir" type="button">📨 Compartir</button>' +
            '<button class="g-btn ghost" id="btnCopiar2" type="button">Copiar enlace</button>' +
            '<a class="g-btn ghost" href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>' +
            '</div>' +
            '<p class="g-hint">Quien abra ese enlace solo escribe su alias, recibe sus cartones, abona y espera tu canto.</p>');
        $('btnCompartir').addEventListener('click', compartir);
        $('btnCopiar2').addEventListener('click', copiarEnlace);
    }

    /** Fondo de los cartones: foto propia, foto para toda la sala o patrón */
    function abrirModalFondo() {
        const soyCantador = estado && estado.yo.rol === 'cantador';
        const deSala = (estado && estado.fondo) ? estado.fondo : { tipo: 'ninguno', patron: '', opacidad: 0.35 };
        const mio = fondoLocal || { tipo: 'ninguno', patron: '', opacidad: deSala.opacidad };
        const op = Math.round(((mio.opacidad === undefined || mio.opacidad === null) ? deSala.opacidad : mio.opacidad) * 100);
        abrirModal('Fondo de los cartones',
            '<p class="g-hint">Pon una foto o un patrón detrás de los números: los números siguen viéndose bien.</p>' +
            '<div class="g-botones">' +
            '<button class="g-btn ghost mini" data-fondo-mio="ninguno" type="button">Sin fondo</button>' +
            '<button class="g-btn ghost mini" data-fondo-mio="papel" type="button">Papel</button>' +
            '<button class="g-btn ghost mini" data-fondo-mio="tela" type="button">Tela</button>' +
            '<button class="g-btn ghost mini" data-fondo-mio="madera" type="button">Madera</button>' +
            '</div><div class="g-botones">' +
            '<button class="g-btn mini" id="btnFotoPropia" type="button">📷 Foto mía</button>' +
            (soyCantador ? '<button class="g-btn mini dark" id="btnFotoSala" type="button">📷 Foto para toda la sala</button>' : '') +
            '</div>' +
            '<label class="g-config-label" for="rangoFondo">Intensidad de la foto: <span id="fondoOpacidad">' + op + '%</span></label>' +
            '<input type="range" id="rangoFondo" min="5" max="95" step="5" value="' + op + '">' +
            '<input type="file" id="fotoPropia" accept="image/*" class="g-hidden">' +
            '<input type="file" id="fotoSala" accept="image/*" class="g-hidden">' +
            '<p class="g-hint">' + (soyCantador
                ? 'El fondo de la sala lo ven todos; «Foto mía» solo se ve en este dispositivo.'
                : 'Tu elección solo se ve en este dispositivo. El fondo de la sala lo decide el cantador.') + '</p>');

        $('rangoFondo').addEventListener('input', () => { $('fondoOpacidad').textContent = $('rangoFondo').value + '%'; });
        $('rangoFondo').addEventListener('change', () => {
            const valor = Number($('rangoFondo').value) / 100;
            if (soyCantador && deSala.tipo !== 'ninguno') {
                accion('fondo', { fondo: { tipo: deSala.tipo, patron: deSala.patron, opacidad: valor } });
            } else {
                const f = fondoLocal || { tipo: deSala.tipo, patron: deSala.patron, opacidad: valor };
                f.opacidad = valor;
                guardarFondoLocal(f);
            }
        });
        $('btnFotoPropia').addEventListener('click', () => $('fotoPropia').click());
        $('fotoPropia').addEventListener('change', () => {
            const f = $('fotoPropia').files[0];
            if (!f) return;
            prepararFoto(f, 1400, (dataUrl) => {
                guardarFondoLocal({ tipo: 'foto', foto: dataUrl, opacidad: Number($('rangoFondo').value) / 100 });
                toast('Fondo aplicado en este dispositivo');
                cerrarModal();
            }, (msg) => toast(msg, true));
        });
        if ($('btnFotoSala')) {
            $('btnFotoSala').addEventListener('click', () => $('fotoSala').click());
            $('fotoSala').addEventListener('change', () => {
                const f = $('fotoSala').files[0];
                if (!f) return;
                toast('Preparando la foto…');
                prepararFoto(f, 1400, async (dataUrl) => {
                    guardarFondoLocal(null);
                    const out = await accion('fondo', { fondo: { tipo: 'foto', opacidad: Number($('rangoFondo').value) / 100 }, foto: dataUrl });
                    if (out && !out.error) { toast('Foto aplicada a los cartones de toda la sala'); cerrarModal(); }
                }, (msg) => toast(msg, true));
            });
        }
    }

    /** Verificación del cantador: el cartón de un jugador, con sus aciertos */
    async function verCartonesDeJugador(pidDestino) {
        const j = (estado.jugadores || []).find(x => x.pid === pidDestino);
        if (!j) return;
        abrirModal('Cartones de ' + j.alias, '<p class="g-hint">Cargando cartones…</p>');
        const trozos = [];
        for (const c of j.pedidos) {
            const out = await accion('verCarton', { cartonId: c.id });
            if (!out || out.error) continue;
            const ca = out.carton;
            trozos.push('<div class="g-ver">' +
                '<div class="g-cotejo-cab"><strong>Cartón ' + esc(ca.serie) + '</strong>' +
                '<span class="g-badge ' + ca.pagado + '">' + (ca.pagado === 'pagado' ? 'abonado' : ca.pagado) + '</span></div>' +
                miniCarton(ca.rows, ca.marcadas, ca.salidos, ca.letras) +
                '<p class="g-hint">' + resumenAciertos(ca, ca.letras, ca.tipoLinea) + '</p></div>');
        }
        abrirModal('Cartones de ' + j.alias, trozos.join('') ||
            '<p class="g-hint">Ese jugador todavía no tiene cartones.</p>');
    }

    /** El ganador ve sus aciertos: filas completas, avance del apagón y lo que falta */
    function abrirMiCotejo() {
        if (!estado || !estado.yo.cartones.length) {
            abrirModal('Mi cotejo', '<p class="g-hint">Todavía no tienes cartones.</p>');
            return;
        }
        const esquema = estado.config.letras || 'ABCDE';
        const nombres = ['1ª', '2ª', '3ª', '4ª', '5ª'];
        const html = estado.yo.cartones.map((c, i) => {
            const marcas = new Set(c.marcadas);
            const faltan = [];
            for (let r = 0; r < 5; r++) {
                for (let k = 0; k < 5; k++) {
                    const v = c.rows[r][k];
                    if (v === 'LIBRE') continue;
                    if (!marcas.has(r + '-' + k)) faltan.push(letraDe(v, esquema) + ' ' + String(v).padStart(2, '0'));
                }
            }
            const filas = [];
            (c.filas || []).forEach((ok, r) => { if (ok) filas.push(nombres[r]); });
            return '<div class="g-ver">' +
                '<div class="g-cotejo-cab"><strong>Cartón ' + (i + 1) + ' · ' + esc(c.serie) + '</strong>' +
                '<span class="g-badge ' + c.pagado + '">' + (c.pagado === 'pagado' ? 'abonado' : c.pagado) + '</span></div>' +
                miniCarton(c.rows, c.marcadas, estado.sorteo.salidos, esquema) +
                '<p class="g-hint">' + resumenAciertos(c, esquema, estado.tipoLinea) +
                (filas.length ? ' · filas ganadas: <span class="g-ok">' + filas.join(', ') + '</span>' : '') +
                '<br>Te faltan ' + faltan.length + ' número(s): ' +
                esc(faltan.slice(0, 14).join(', ') || 'ninguno: ¡cartón completo!') + (faltan.length > 14 ? ' …' : '') + '</p></div>';
        }).join('');
        abrirModal('Mi cotejo — ' + estado.yo.alias, html +
            '<p class="g-hint">Al completar una fila o todo el cartón pulsa «🏆 ¡LÍNEA!» o «🌟 ¡APAGÓN!»: el cantador verá tu cartón y lo cotejará.</p>');
    }

    /* --------------------------- jugador --------------------------- */

    function cartonHTML(c, indice) {
        const esquema = estado.config.letras || 'ABCDE';
        const letras = LETRAS[esquema];
        const salidos = new Set(estado.sorteo.salidos);
        const marcas = new Set(c.marcadas);
        const clase = 'g-carton' + (c.apagon ? ' apagon' : (c.linea ? ' linea' : '')) + (c.pagado === 'pagado' ? '' : ' sin-pagar');

        let h = '<div class="' + clase + '">' +
            '<div class="g-carton-top"><span class="g-serie">Cartón ' + (indice + 1) + ' · ' + esc(c.serie) + '</span>' +
            '<span class="g-spacer"></span>' +
            '<span class="g-badge ' + c.pagado + '">' + (c.pagado === 'pagado' ? 'abonado' : c.pagado) + '</span>' +
            '<button class="g-x" data-quitar="' + c.id + '" title="Quitar cartón">✕</button></div><div class="g-grid">';

        letras.forEach(l => { h += '<div class="g-head">' + l + '</div>'; });
        h += '<div class="g-head rail">fila</div>';

        for (let r = 0; r < 5; r++) {
            for (let col = 0; col < 5; col++) {
                const v = c.rows[r][col];
                const key = r + '-' + col;
                if (v === 'LIBRE') { h += '<div class="g-cell libre marcado">★</div>'; continue; }
                const salio = salidos.has(v);
                const marcada = marcas.has(key);
                const cls = 'g-cell ' + (marcada ? 'marcado' : (salio ? 'cantado' : 'bloqueado')) +
                    ((c.filas && c.filas[r]) ? ' enlinea' : '') + (v === estado.sorteo.actual ? ' actual' : '');
                h += '<button class="' + cls + '" data-carton="' + c.id + '" data-key="' + key + '"' + (salio ? '' : ' disabled') + '>' + v + '</button>';
            }
            h += '<div class="g-rail' + ((c.filas && c.filas[r]) ? ' ok' : '') + '" title="Fila ' + (r + 1) + '">' +
                ((c.filas && c.filas[r]) ? '✓' : (r + 1)) + '</div>';
        }
        h += '</div>';

        const aciertos = c.aciertos || 0;
        const total = c.total || 24;
        const pct = Math.round(100 * aciertos / total);
        h += '<div class="g-progreso" title="Avance del cartón"><div class="g-progreso-barra" style="width:' + pct + '%"></div></div>' +
            '<div class="g-carton-pie">Aciertos <strong>' + aciertos + '/' + total + '</strong> · ' +
            (c.apagon ? '<span class="g-ok">CARTÓN COMPLETO</span>'
                : (c.linea ? '<span class="g-ok">línea completa</span>' : 'faltan ' + (total - aciertos))) +
            '</div>';
        return h + '</div>';
    }

    function renderJugador() {
        const s = estado.sorteo;
        const esquema = estado.config.letras || 'ABCDE';
        $('jActual').textContent = s.actual ? letraDe(s.actual, esquema) + ' ' + String(s.actual).padStart(2, '0') : '--';
        $('jRestantes').textContent = s.restantes;
        $('jPremioLinea').textContent = estado.premioLinea
            ? estado.premioLinea.alias + (estado.premioLinea.estado === 'oficial' ? '' : ' (por cotejar)') : 'en juego';
        $('jPremioApagon').textContent = estado.premioApagon
            ? estado.premioApagon.alias + (estado.premioApagon.estado === 'oficial' ? '' : ' (por cotejar)') : 'en juego';

        // Sala de espera: hasta que el cantador empiece, solo se abona
        const cantador = (estado.jugadores.find(x => x.rol === 'cantador') || {}).alias || 'el cantador';
        const espera = $('esperaJugador');
        if (estado.iniciada) {
            espera.classList.add('g-hidden');
        } else {
            espera.classList.remove('g-hidden');
            $('esperaTitulo').textContent = '⏳ Esperando a que ' + cantador + ' empiece a cantar';
            $('esperaTexto').textContent = estado.yo.cartones.length
                ? 'Ya tienes tus cartones: abona lo que te toca (el cantador lo confirma) y espera el primer número.'
                : 'Pide tus cartones con «＋ Cartón», abona y espera el primer número.';
        }

        $('cartonesJugador').innerHTML = estado.yo.cartones.length
            ? estado.yo.cartones.map(cartonHTML).join('')
            : '<div class="g-panel" style="text-align:center">Todavía no tienes cartones.<br>Pulsa «＋ Cartón» para recibir uno del sistema.</div>';

        const yo = estado.yo;
        const d = estado.dinero;
        $('jMonto').innerHTML = 'Abono: <strong>' + dinero(d.abono, d.moneda) + '</strong> por cartón · ' +
            yo.cartones.length + ' cartón(es) = <strong>' + dinero(yo.total, d.moneda) + '</strong>' +
            (yo.debe > 0 ? ' · debes <strong style="color:#c53030">' + dinero(yo.debe, d.moneda) + '</strong>' : ' · <strong style="color:#1f9d55">sin saldo pendiente</strong>') +
            ' · pozo actual ' + dinero(d.recaudado, d.moneda) + ' (línea ' + dinero(d.premioLinea, d.moneda) + ' / apagón ' + dinero(d.premioApagon, d.moneda) + ')';

        if (estado.exigirAbono) $('jMonto').innerHTML += ' · se exige abono confirmado para validar un premio';

        $('btnAbonar').disabled = yo.cartones.length === 0 || yo.debe === 0;
        $('btnPedir1').disabled = yo.cartones.length >= 10;
        $('btnPedir3').disabled = yo.cartones.length >= 10;

        const puedeL = !!yo.puedeLinea && !estado.premioLinea;
        const puedeA = !!yo.puedeApagon && !estado.premioApagon;
        $('btnLinea').classList.toggle('listo', puedeL);
        $('btnApagon').classList.toggle('listo', puedeA);
        $('btnLinea').disabled = !puedeL;
        $('btnApagon').disabled = !puedeA;

        $('jAuto').checked = !!yo.auto;
        $('jAutoCanto').checked = !!yo.autoCanto;
    }

    /* --------------------------- eventos --------------------------- */

    $('btnCantar').addEventListener('click', () => accion('cantar'));

    $('btnAuto').addEventListener('click', () => {
        if (!estado) return;
        accion('auto', { activo: !estado.sorteo.auto });
    });

    $('btnRepetir').addEventListener('click', () => {
        const n = estado && estado.sorteo.actual;
        if (n) hablar(letraDe(n, estado.config.letras) + ', ' + numEs(n));
    });

    $('btnVoz').addEventListener('click', () => {
        vozOn = !vozOn;
        $('btnVoz').textContent = vozOn ? '🔊 Voz: ON' : '🔇 Voz: OFF';
    });

    $('btnReiniciar').addEventListener('click', () => {
        if (confirm('¿Abrir una nueva ronda? Se limpian las bolas y las marcas (los cartones y los abonos se mantienen).')) {
            accion('reiniciar');
        }
    });

    // Configuración de la mesa
    [['cfAbono', 'abono'], ['cfMoneda', 'moneda'], ['cfPct', 'premioLineaPct'], ['cfIntervalo', 'autoIntervalo']].forEach(([id, campo]) => {
        $(id).addEventListener('change', () => {
            const cfg = {}; cfg[campo] = $(id).value;
            accion('config', { config: cfg });
        });
    });
    $('cfTipoLinea').addEventListener('change', () => accion('config', { tipoLinea: $('cfTipoLinea').value }));
    $('cfLetras').addEventListener('change', () => accion('config', { config: { letras: $('cfLetras').value } }));
    $('cfCantoAuto').addEventListener('change', () => accion('config', { cantarAutomatico: $('cfCantoAuto').checked }));
    $('cfExigirAbono').addEventListener('change', () => accion('config', { exigirAbono: $('cfExigirAbono').checked }));

    // Ronda y cotejo
    $('btnIniciar').addEventListener('click', async () => {
        const out = await accion('iniciar');
        if (!out.error) toast('▶ Ronda iniciada. ¡Canta el primer número!');
    });

    $('listaCotejos').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cotejo]');
        if (!b) return;
        accion('cotejo', { cotejoId: b.dataset.cotejo, decision: b.dataset.decision });
    });

    $('modalCuerpo').addEventListener('click', (e) => {
        const b = e.target.closest('[data-fondo-mio]');
        if (!b) return;
        const rango = $('rangoFondo');
        const op = rango ? Number(rango.value) / 100 : 0.35;
        const valor = b.dataset.fondoMio;
        if (valor === 'ninguno') guardarFondoLocal({ tipo: 'ninguno', opacidad: op });
        else guardarFondoLocal({ tipo: 'patron', patron: valor, opacidad: op });
        toast('Fondo aplicado en este dispositivo');
    });

    // Acciones sobre jugadores
    $('tablaJugadores').addEventListener('click', async (e) => {
        const ver = e.target.closest('[data-vista]');
        if (ver && estado) { verCartonesDeJugador(ver.dataset.vista); return; }
        const btn = e.target.closest('[data-acc]');
        if (!btn || !estado) return;
        const j = estado.jugadores.find(x => x.pid === btn.dataset.j);
        if (!j) return;
        const acc = btn.dataset.acc;
        if (acc === 'bombo') return accion('pasarBombo', { pidDestino: j.pid });
        if (acc === 'quitar') {
            if (confirm('¿Quitar a ' + j.alias + ' de la sala?')) accion('expulsar', { pidDestino: j.pid });
            return;
        }
        const nuevo = acc === 'pagar' ? 'pagado' : 'pendiente';
        for (const c of j.pedidos) {
            if (acc === 'pagar' && c.pagado === 'pagado') continue;
            if (acc === 'devolver' && c.pagado !== 'pagado') continue;
            await accion('pago', { cartonId: c.id, estado: nuevo });
        }
    });

    // Cartones del jugador
    $('cartonesJugador').addEventListener('click', (e) => {
        const quitar = e.target.closest('[data-quitar]');
        if (quitar) return accion('quitarCarton', { cartonId: quitar.dataset.quitar });
        const celda = e.target.closest('[data-carton][data-key]');
        if (celda) accion('marcar', { cartonId: celda.dataset.carton, key: celda.dataset.key });
    });

    $('btnPedir1').addEventListener('click', () => accion('cartones', { cantidad: 1, max: 6 }));
    $('btnPedir3').addEventListener('click', () => accion('cartones', { cantidad: 3, max: 6 }));

    $('btnAbonar').addEventListener('click', async () => {
        if (!estado) return;
        const pendientes = estado.yo.cartones.filter(c => c.pagado === 'pendiente');
        if (!pendientes.length) { toast('No tienes abonos pendientes', true); return; }
        for (const c of pendientes) await accion('pago', { cartonId: c.id, estado: 'declarado' });
        toast('Abono declarado. El cantador lo confirmará.');
    });

    $('jAuto').addEventListener('change', () => {
        accion('modo', { auto: $('jAuto').checked });
        toast($('jAuto').checked ? 'Marcado automático activado' : 'Marcado manual: pulsa tus números cantados');
    });
    $('jAutoCanto').addEventListener('change', () => accion('modo', { autoCanto: $('jAutoCanto').checked }));

    $('btnLinea').addEventListener('click', async () => {
        const out = await accion('cantarPremio', { premio: 'linea' });
        if (!out.error) toast('🏆 ¡Línea cantada! El cantador la cotejará.');
    });
    $('btnApagon').addEventListener('click', async () => {
        const out = await accion('cantarPremio', { premio: 'apagon' });
        if (!out.error) toast('🌟 ¡Apagón cantado! El cantador lo cotejará.');
    });
    $('btnMiCotejo').addEventListener('click', abrirMiCotejo);

    // Cabecera, invitación, fondo y salida
    $('btnCopiar').addEventListener('click', copiarEnlace);
    $('enlaceSala').addEventListener('click', copiarEnlace);
    $('btnRecargar').addEventListener('click', () => location.reload());
    $('btnInvitar').addEventListener('click', () => abrirModalInvitacion(false));
    $('btnInvitar2').addEventListener('click', () => abrirModalInvitacion(false));
    $('btnFondo').addEventListener('click', abrirModalFondo);
    $('modalCerrar').addEventListener('click', cerrarModal);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) cerrarModal(); });
    $('btnSalir').addEventListener('click', async () => {
        if (!confirm('¿Salir de la sala? Si eras el cantador, el bombo pasa al siguiente jugador.')) return;
        await accion('salir');
        localStorage.removeItem('bg_sala');
        cerrarModal();
        location.href = 'index.html';
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && estado && estado.yo.rol === 'cantador' && !estado.sorteo.auto && estado.sorteo.restantes > 0
            && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
            e.preventDefault();
            accion('cantar');
        }
    });

    /* --------------------------- arranque --------------------------- */

    $('inAlias').value = localStorage.getItem('bg_alias') || '';
    $('inSala').value = params.get('sala') ? codigo : '';
    codigo = ($('inSala').value || '').toUpperCase();
    actualizarDestino();
    comprobarServidor();
    revisarSala();

    // Con enlace de invitación (?sala=XXXX) y alias ya guardado se entra directo
    if (params.get('sala') && codigo && localStorage.getItem('bg_alias')) {
        entrar(localStorage.getItem('bg_alias'), codigo);
    }
})();
