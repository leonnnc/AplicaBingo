/**
 * Bingo en Grupo — Cliente de sala (cantador / jugadores)
 * El servidor (server.js) es la autoridad: cartones, cantadas, marcas y premios.
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
        // Sin enlace de sala, el primero en entrar crea la suya y canta.
        if (!codigo) codigo = Math.random().toString(36).slice(2, 6).toUpperCase();
        $('inError').textContent = '';
        entrar(alias, codigo);
    });

    function actualizarDestino() {
        const el = $('inDestino');
        if (!el) return;
        if (codigo) {
            el.innerHTML = 'Entrarás a la sala <strong>' + codigo + '</strong>. El primero que entra canta; los demás juegan con sus cartones.';
        } else {
            el.innerHTML = 'Abriste el juego sin enlace de sala: al entrar <strong>crearás una sala nueva</strong> y serás el <strong>cantador</strong>. ' +
                'Después comparte el enlace con los jugadores.';
        }
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

        avisarPremios();
        if (cant) renderCantador(); else renderJugador();
    }

    function avisarPremios() {
        const l = estado.premioLinea, a = estado.premioApagon;
        const claveL = l ? l.serie + l.hora : null;
        const claveA = a ? a.serie + a.hora : null;
        if (claveL && claveL !== vistoLinea) { vistoLinea = claveL; toast('🏆 ¡LÍNEA! ' + l.alias + ' · cartón ' + l.serie); hablar('Línea para ' + l.alias); }
        if (claveA && claveA !== vistoApagon) { vistoApagon = claveA; toast('🌟 ¡APAGÓN! ' + a.alias + ' · cartón ' + a.serie); hablar('Apagón para ' + a.alias); }
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
        $('enlaceSala').textContent = 'Enlace para jugadores: ' + urlSala() + '  (toca para copiar)';

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

    /* --------------------------- jugador --------------------------- */

    function cartonHTML(c, indice) {
        const esquema = estado.config.letras || 'ABCDE';
        const letras = LETRAS[esquema];
        const salidos = new Set(estado.sorteo.salidos);
        const marcas = new Set(c.marcadas);
        const clase = 'g-carton' + (c.apagon ? ' apagon' : (c.linea ? ' linea' : ''));

        let h = '<div class="' + clase + '">' +
            '<div class="g-carton-top"><span class="g-serie">Cartón ' + (indice + 1) + ' · ' + c.serie + '</span>' +
            '<span class="g-spacer"></span>' +
            '<span class="g-badge ' + c.pagado + '">' + (c.pagado === 'pagado' ? 'abonado' : c.pagado) + '</span>' +
            '<button class="g-x" data-quitar="' + c.id + '" title="Quitar cartón">✕</button></div><div class="g-grid">';

        letras.forEach(l => { h += '<div class="g-head">' + l + '</div>'; });

        for (let r = 0; r < 5; r++) {
            for (let col = 0; col < 5; col++) {
                const v = c.rows[r][col];
                const key = r + '-' + col;
                if (v === 'LIBRE') { h += '<div class="g-cell libre marcado">LIBRE</div>'; continue; }
                const salio = salidos.has(v);
                const marcada = marcas.has(key);
                const cls = 'g-cell ' + (marcada ? 'marcado' : (salio ? 'cantado' : 'bloqueado')) + (v === estado.sorteo.actual ? ' actual' : '');
                h += '<button class="' + cls + '" data-carton="' + c.id + '" data-key="' + key + '"' + (salio ? '' : ' disabled') + '>' + v + '</button>';
            }
        }
        return h + '</div></div>';
    }

    function renderJugador() {
        const s = estado.sorteo;
        const esquema = estado.config.letras || 'ABCDE';
        $('jActual').textContent = s.actual ? letraDe(s.actual, esquema) + ' ' + String(s.actual).padStart(2, '0') : '--';
        $('jRestantes').textContent = s.restantes;
        $('jPremioLinea').textContent = estado.premioLinea ? estado.premioLinea.alias : 'en juego';
        $('jPremioApagon').textContent = estado.premioApagon ? estado.premioApagon.alias : 'en juego';

        $('cartonesJugador').innerHTML = estado.yo.cartones.length
            ? estado.yo.cartones.map(cartonHTML).join('')
            : '<div class="g-panel" style="text-align:center">Todavía no tienes cartones.<br>Pulsa «＋ Cartón» para recibir uno del sistema.</div>';

        const yo = estado.yo;
        const d = estado.dinero;
        $('jMonto').innerHTML = 'Abono: <strong>' + dinero(d.abono, d.moneda) + '</strong> por cartón · ' +
            yo.cartones.length + ' cartón(es) = <strong>' + dinero(yo.total, d.moneda) + '</strong>' +
            (yo.debe > 0 ? ' · debes <strong style="color:#c53030">' + dinero(yo.debe, d.moneda) + '</strong>' : ' · <strong style="color:#1f9d55">sin saldo pendiente</strong>') +
            ' · pozo actual ' + dinero(d.recaudado, d.moneda) + ' (línea ' + dinero(d.premioLinea, d.moneda) + ' / apagón ' + dinero(d.premioApagon, d.moneda) + ')';

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

    // Acciones sobre jugadores
    $('tablaJugadores').addEventListener('click', async (e) => {
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
        if (!out.error) toast('🏆 ¡Línea cantada!');
    });
    $('btnApagon').addEventListener('click', async () => {
        const out = await accion('cantarPremio', { premio: 'apagon' });
        if (!out.error) toast('🌟 ¡Apagón cantado!');
    });

    // Cabecera
    const urlSala = () => location.origin + '/grupo.html?sala=' + codigo;
    async function copiarEnlace() {
        const url = urlSala();
        try { await navigator.clipboard.writeText(url); toast('Enlace copiado: ' + url); }
        catch (e) { prompt('Comparte este enlace con los jugadores:', url); }
    }
    $('btnCopiar').addEventListener('click', copiarEnlace);
    $('enlaceSala').addEventListener('click', copiarEnlace);
    $('btnRecargar').addEventListener('click', () => location.reload());

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && estado && estado.yo.rol === 'cantador' && !estado.sorteo.auto && estado.sorteo.restantes > 0
            && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
            e.preventDefault();
            accion('cantar');
        }
    });

    /* --------------------------- arranque --------------------------- */

    $('inAlias').value = localStorage.getItem('bg_alias') || '';
    actualizarDestino();
    comprobarServidor();

    if (codigo && localStorage.getItem('bg_alias')) {
        entrar(localStorage.getItem('bg_alias'), codigo);
    }
})();
