/**
 * Bombo Bingo Online Gratis
 * Lógica del Juego, Locución en Español (Web Speech API) y Efectos de Sonido (Web Audio API)
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- ESTADO DEL JUEGO ---
    const TOTAL_NUMBERS = 75;
    let drawnNumbers = []; // Historial de números sorteados
    let availableNumbers = []; // Números pendientes por salir
    let lastDrawn = null;
    let isDrawing = false;
    let autoIntervalId = null;
    let voiceEnabled = true;
    let selectedVoice = null;
    let namingScheme = 'ABCDE'; // 'ABCDE' o 'BINGO'

    // --- CARTONES DEL JUGADOR ---
    const MAX_CARDS = 6;   // Cantidad máxima de cartones permitidos
    let cards = [];        // Cartones generados por el jugador
    let cardSeq = 0;       // Secuencia para dar un ID único a cada cartón
    let autoDaub = false;  // Marcado automático (tacha solo al cantar)
    let bingoTimeoutId = null;

    // Letras por rango (1-15, 16-30, 31-45, 46-60, 61-75)
    const SCHEMES = {
        ABCDE: ['A', 'B', 'C', 'D', 'E'],
        BINGO: ['B', 'I', 'N', 'G', 'O']
    };

    // --- ELEMENTOS DEL DOM ---
    const cardLetter = document.getElementById('cardLetter');
    const cardTens = document.getElementById('cardTens');
    const cardUnits = document.getElementById('cardUnits');
    const valLetter = document.getElementById('valLetter');
    const valTens = document.getElementById('valTens');
    const valUnits = document.getElementById('valUnits');

    const btnDraw = document.getElementById('btnDraw');
    const btnAuto = document.getElementById('btnAuto');
    const autoState = document.getElementById('autoState');
    const btnVoiceToggle = document.getElementById('btnVoiceToggle');
    const voiceState = document.getElementById('voiceState');
    const voiceIcon = document.getElementById('voiceIcon');
    const btnRepeat = document.getElementById('btnRepeat');
    const btnReset = document.getElementById('btnReset');
    const btnSettings = document.getElementById('btnSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');

    const drawnCountEl = document.getElementById('drawnCount');
    const totalCountEl = document.getElementById('totalCount');
    const boardBody = document.getElementById('boardBody');
    const historyList = document.getElementById('historyList');

    const settingsModal = document.getElementById('settingsModal');
    const namingModeSelect = document.getElementById('namingMode');
    const voiceSelect = document.getElementById('voiceSelect');
    const speechRateInput = document.getElementById('speechRate');
    const rateVal = document.getElementById('rateVal');
    const autoSpeedInput = document.getElementById('autoSpeed');
    const autoSpeedVal = document.getElementById('autoSpeedVal');

    const confirmModal = document.getElementById('confirmModal');
    const btnCancelReset = document.getElementById('btnCancelReset');
    const btnConfirmReset = document.getElementById('btnConfirmReset');

    // Referencias del panel de cartones
    const cardsList = document.getElementById('cardsList');
    const emptyCards = document.getElementById('emptyCards');
    const cardCountEl = document.getElementById('cardCount');
    const btnAddCard = document.getElementById('btnAddCard');
    const btnAdd3 = document.getElementById('btnAdd3');
    const btnAdd6 = document.getElementById('btnAdd6');
    const btnClearCards = document.getElementById('btnClearCards');
    const autoDaubInput = document.getElementById('autoDaub');
    const bingoToast = document.getElementById('bingoToast');
    const bingoToastText = document.getElementById('bingoToastText');

    // --- SISTEMA DE AUDIO (Web Audio API para efectos realistas) ---
    let audioCtx = null;

    function initAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playDrumRollSound() {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(120, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.35);

            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + 0.35);
        } catch (e) {
            console.warn('Audio effect error:', e);
        }
    }

    function playDingSound() {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
            osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08); // A5

            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + 0.6);
        } catch (e) {
            console.warn('Audio effect error:', e);
        }
    }

    function playTickSound() {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(920, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.045, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.07);
        } catch (e) {
            console.warn('Audio effect error:', e);
        }
    }

    function playBingoSound() {
        if (!audioCtx) return;
        try {
            // Arpegio C5 - E5 - G5 - C6
            const notes = [523.25, 659.25, 783.99, 1046.5];
            notes.forEach((freq, index) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                const start = audioCtx.currentTime + index * 0.13;
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(start);
                osc.stop(start + 0.5);
            });
        } catch (e) {
            console.warn('Audio effect error:', e);
        }
    }

    // --- SISTEMA DE VOZ / LOCUCIÓN (Web Speech API) ---
    const NUMEROS_A_LETRAS_ES = {
        1: "uno", 2: "dos", 3: "tres", 4: "cuatro", 5: "cinco",
        6: "seis", 7: "siete", 8: "ocho", 9: "nueve", 10: "diez",
        11: "once", 12: "doce", 13: "trece", 14: "catorce", 15: "quince",
        16: "dieciséis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve", 20: "veinte",
        21: "veintiuno", 22: "veintidós", 23: "veintitrés", 24: "veinticuatro", 25: "veinticinco",
        26: "veintiséis", 27: "veintisiete", 28: "veintiocho", 29: "veintinueve", 30: "treinta",
        31: "treinta y uno", 32: "treinta y dos", 33: "treinta y tres", 34: "treinta y cuatro", 35: "treinta y cinco",
        36: "treinta y seis", 37: "treinta y siete", 38: "treinta y ocho", 39: "treinta y nueve", 40: "cuarenta",
        41: "cuarenta y uno", 42: "cuarenta y dos", 43: "cuarenta y tres", 44: "cuarenta y cuatro", 45: "cuarenta y cinco",
        46: "cuarenta y seis", 47: "cuarenta y siete", 48: "cuarenta y ocho", 49: "cuarenta y nueve", 50: "cincuenta",
        51: "cincuenta y uno", 52: "cincuenta y dos", 53: "cincuenta y tres", 54: "cincuenta y cuatro", 55: "cincuenta y cinco",
        56: "cincuenta y seis", 57: "cincuenta y siete", 58: "cincuenta y ocho", 59: "cincuenta y nueve", 60: "sesenta",
        61: "sesenta y uno", 62: "sesenta y dos", 63: "sesenta y tres", 64: "sesenta y cuatro", 65: "sesenta y seis",
        66: "sesenta y seis", 67: "sesenta y siete", 68: "sesenta y ocho", 69: "sesenta y nueve", 70: "setenta",
        71: "setenta y uno", 72: "setenta y dos", 73: "setenta y tres", 74: "setenta y cuatro", 75: "setenta y cinco"
    };

    function loadVoices() {
        if (!('speechSynthesis' in window)) {
            voiceSelect.innerHTML = '<option value="">Síntesis de voz no disponible</option>';
            return;
        }

        const voices = window.speechSynthesis.getVoices();
        const spanishVoices = voices.filter(v => v.lang.toLowerCase().startsWith('es'));

        voiceSelect.innerHTML = '';

        if (spanishVoices.length > 0) {
            spanishVoices.forEach((voice, index) => {
                const opt = document.createElement('option');
                opt.value = voice.name;
                opt.textContent = `${voice.name} (${voice.lang})`;
                if (index === 0) opt.selected = true;
                voiceSelect.appendChild(opt);
            });
            selectedVoice = spanishVoices[0];
        } else if (voices.length > 0) {
            voices.forEach((voice) => {
                const opt = document.createElement('option');
                opt.value = voice.name;
                opt.textContent = `${voice.name} (${voice.lang})`;
                voiceSelect.appendChild(opt);
            });
            selectedVoice = voices[0];
        } else {
            const opt = document.createElement('option');
            opt.textContent = 'Voz predeterminada del sistema';
            opt.value = '';
            voiceSelect.appendChild(opt);
        }
    }

    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
        loadVoices();
    }

    voiceSelect.addEventListener('change', () => {
        const voices = window.speechSynthesis.getVoices();
        selectedVoice = voices.find(v => v.name === voiceSelect.value) || null;
    });

    /**
     * Canta el número extraído con voz humana en español
     * Ejemplo: "A, diez" o "C, cuarenta"
     */
    function speakBall(letter, number) {
        if (!voiceEnabled || !('speechSynthesis' in window)) return;

        // Cancelar locuciones previas en cola
        window.speechSynthesis.cancel();

        const numText = NUMEROS_A_LETRAS_ES[number] || number.toString();
        // Frase a cantar: "A, diez"
        const phrase = `${letter}, ${numText}`;

        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = 'es-ES';
        utterance.rate = parseFloat(speechRateInput.value) || 1.0;
        utterance.pitch = 1.0;

        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }

        window.speechSynthesis.speak(utterance);
    }

    // --- INICIALIZACIÓN Y GENERACIÓN DEL TABLERO ---

    function getLetterForNumber(num) {
        const letters = SCHEMES[namingScheme];
        if (num <= 15) return letters[0];
        if (num <= 30) return letters[1];
        if (num <= 45) return letters[2];
        if (num <= 60) return letters[3];
        return letters[4];
    }

    function initGame() {
        availableNumbers = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1);
        drawnNumbers = [];
        lastDrawn = null;
        isDrawing = false;
        stopAutoDraw();

        // Valores iniciales en las tarjetas
        const letters = SCHEMES[namingScheme];
        valLetter.textContent = letters[0];
        valTens.textContent = '0';
        valUnits.textContent = '0';

        renderBoard();
        resetCards();
        updateStats();
        renderHistory();
        btnDraw.disabled = false;
        btnDraw.querySelector('.btn-text').textContent = 'Sortear números';
    }

    function renderBoard() {
        boardBody.innerHTML = '';
        const letters = SCHEMES[namingScheme];

        // 5 Filas: A (1-15), B (16-30), C (31-45), D (46-60), E (61-75)
        for (let row = 0; row < 5; row++) {
            const tr = document.createElement('tr');
            
            // Columna 0: Letra
            const th = document.createElement('th');
            th.className = 'header-cell';
            th.textContent = letters[row];
            tr.appendChild(th);

            // Columnas 1 a 15: Números
            const startNum = row * 15 + 1;
            for (let col = 0; col < 15; col++) {
                const num = startNum + col;
                const td = document.createElement('td');
                td.className = 'num-cell';
                td.id = `cell-${num}`;
                td.textContent = num;
                
                if (drawnNumbers.includes(num)) {
                    td.classList.add('marked');
                    if (lastDrawn === num) {
                        td.classList.add('last-called');
                    }
                }
                tr.appendChild(td);
            }

            boardBody.appendChild(tr);
        }
    }

    function updateStats() {
        drawnCountEl.textContent = drawnNumbers.length;
        totalCountEl.textContent = TOTAL_NUMBERS;
    }

    function renderHistory() {
        historyList.innerHTML = '';
        if (drawnNumbers.length === 0) {
            historyList.innerHTML = '<span class="empty-history">Ningún número extraído aún</span>';
            return;
        }

        // Mostrar los números en orden inverso (el más reciente primero)
        const reversed = [...drawnNumbers].reverse();
        reversed.forEach((num, index) => {
            const letter = getLetterForNumber(num);
            const chip = document.createElement('span');
            chip.className = `history-chip ${index === 0 ? 'latest' : ''}`;
            chip.textContent = `${letter}${num}`;
            historyList.appendChild(chip);
        });
    }

    // --- SORTEO AL AZAR Y ANIMACIÓN ---

    function drawRandomNumber() {
        if (isDrawing) return;
        if (availableNumbers.length === 0) {
            alert('¡Todos los números han sido sorteados!');
            stopAutoDraw();
            return;
        }

        initAudioContext();
        isDrawing = true;
        btnDraw.disabled = true;

        // Quitar resaltado de última bola anterior
        if (lastDrawn) {
            const prevCell = document.getElementById(`cell-${lastDrawn}`);
            if (prevCell) prevCell.classList.remove('last-called');
        }

        // Animación de giro en las tarjetas
        cardLetter.classList.add('rolling');
        cardTens.classList.add('rolling');
        cardUnits.classList.add('rolling');

        let rollCount = 0;
        const rollLimit = 12; // Número de giros visuales
        const letters = SCHEMES[namingScheme];

        const rollInterval = setInterval(() => {
            rollCount++;
            playDrumRollSound();

            // Valores aleatorios durante la animación
            const tempLetter = letters[Math.floor(Math.random() * letters.length)];
            const tempTens = Math.floor(Math.random() * 8);
            const tempUnits = Math.floor(Math.random() * 10);

            valLetter.textContent = tempLetter;
            valTens.textContent = tempTens;
            valUnits.textContent = tempUnits;

            if (rollCount >= rollLimit) {
                clearInterval(rollInterval);
                finishDraw();
            }
        }, 45);
    }

    function finishDraw() {
        // Elegir un número al azar de los disponibles
        const randomIndex = Math.floor(Math.random() * availableNumbers.length);
        const selectedNumber = availableNumbers.splice(randomIndex, 1)[0];
        
        drawnNumbers.push(selectedNumber);
        lastDrawn = selectedNumber;

        const letter = getLetterForNumber(selectedNumber);
        const tens = Math.floor(selectedNumber / 10);
        const units = selectedNumber % 10;

        // Detener animación de giro
        cardLetter.classList.remove('rolling');
        cardTens.classList.remove('rolling');
        cardUnits.classList.remove('rolling');

        // Asignar valores definitivos
        valLetter.textContent = letter;
        valTens.textContent = tens;
        valUnits.textContent = units;

        // Efecto pop de revelación
        cardLetter.classList.add('popping');
        cardTens.classList.add('popping');
        cardUnits.classList.add('popping');
        setTimeout(() => {
            cardLetter.classList.remove('popping');
            cardTens.classList.remove('popping');
            cardUnits.classList.remove('popping');
        }, 400);

        // Sonido de éxito
        playDingSound();

        // Marcar en el tablero
        const cell = document.getElementById(`cell-${selectedNumber}`);
        if (cell) {
            cell.classList.add('marked', 'last-called');
        }

        // Habilitar (y marcar, si procede) el número en los cartones del jugador
        markNumberOnCards(selectedNumber);

        // Actualizar estadísticas e historial
        updateStats();
        renderHistory();

        // Cantar el número por voz
        speakBall(letter, selectedNumber);

        isDrawing = false;
        btnDraw.disabled = false;

        if (availableNumbers.length === 0) {
            btnDraw.disabled = true;
            btnDraw.querySelector('.btn-text').textContent = '¡Bingo Completo!';
            stopAutoDraw();
        }
    }

    // --- MODO AUTOMÁTICO ---

    function toggleAutoDraw() {
        if (autoIntervalId) {
            stopAutoDraw();
        } else {
            startAutoDraw();
        }
    }

    function startAutoDraw() {
        if (availableNumbers.length === 0) return;
        const intervalSec = parseInt(autoSpeedInput.value) || 4;
        btnAuto.classList.add('active');
        autoState.textContent = 'ON';
        drawRandomNumber();

        autoIntervalId = setInterval(() => {
            if (availableNumbers.length > 0) {
                drawRandomNumber();
            } else {
                stopAutoDraw();
            }
        }, intervalSec * 1000);
    }

    function stopAutoDraw() {
        if (autoIntervalId) {
            clearInterval(autoIntervalId);
            autoIntervalId = null;
        }
        btnAuto.classList.remove('active');
        autoState.textContent = 'OFF';
    }

    // --- CARTONES DEL JUGADOR: GENERACIÓN Y MARCADO ---

    /**
     * Mezcla un array en su lugar (algoritmo Fisher-Yates)
     */
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    /**
     * Genera un cartón clásico de 5x5 con la casilla central LIBRE.
     * Columna 1: 1-15 | Columna 2: 16-30 | Columna 3: 31-45
     * Columna 4: 46-60 | Columna 5: 61-75
     */
    function generateCard() {
        const columns = [];
        for (let c = 0; c < 5; c++) {
            const pool = [];
            for (let i = 0; i < 15; i++) {
                pool.push(c * 15 + i + 1);
            }
            shuffleArray(pool);
            columns.push(pool.slice(0, 5));
        }

        const rows = [];
        for (let r = 0; r < 5; r++) {
            const row = [];
            for (let c = 0; c < 5; c++) {
                row.push(columns[c][r]);
            }
            rows.push(row);
        }

        // La casilla central va libre y cuenta como marcada
        rows[2][2] = 'FREE';

        return {
            id: ++cardSeq,
            rows: rows,
            marks: new Set(['2-2']),
            hasBingo: false
        };
    }

    function getCardById(id) {
        return cards.find(c => c.id === id) || null;
    }

    function getCardElement(id) {
        return cardsList.querySelector('.bingo-card[data-card-id="' + id + '"]');
    }

    /**
     * Crea cartones nuevos respetando el máximo de MAX_CARDS
     */
    function addCards(amount) {
        let added = 0;
        for (let i = 0; i < amount && cards.length < MAX_CARDS; i++) {
            cards.push(generateCard());
            added++;
        }
        if (added > 0) {
            renderCards();
        }
        return added;
    }

    function removeCard(id) {
        cards = cards.filter(c => c.id !== id);
        hideBingoToast();
        renderCards();
    }

    function clearCards() {
        cards = [];
        hideBingoToast();
        renderCards();
    }

    /**
     * Comprueba si el cartón tiene una línea completa
     * (fila, columna o diagonal).
     */
    function hasCompletedLine(card) {
        const lines = [];

        for (let r = 0; r < 5; r++) {
            lines.push([0, 1, 2, 3, 4].map(c => r + '-' + c));
        }
        for (let c = 0; c < 5; c++) {
            lines.push([0, 1, 2, 3, 4].map(r => r + '-' + c));
        }
        lines.push(['0-0', '1-1', '2-2', '3-3', '4-4']);
        lines.push(['0-4', '1-3', '2-2', '3-1', '4-0']);

        return lines.some(line => line.every(key => card.marks.has(key)));
    }

    /**
     * Construye el nodo DOM de un cartón.
     */
    function buildCardElement(card, position) {
        const wrap = document.createElement('div');
        wrap.className = 'bingo-card';
        wrap.dataset.cardId = String(card.id);

        const top = document.createElement('div');
        top.className = 'card-top';

        const name = document.createElement('span');
        name.className = 'card-name';
        name.textContent = 'Cartón ' + position;
        top.appendChild(name);

        const btnRemove = document.createElement('button');
        btnRemove.type = 'button';
        btnRemove.className = 'card-remove';
        btnRemove.title = 'Quitar este cartón';
        btnRemove.textContent = '✕';
        btnRemove.addEventListener('click', () => removeCard(card.id));
        top.appendChild(btnRemove);

        wrap.appendChild(top);

        const grid = document.createElement('div');
        grid.className = 'card-grid';

        SCHEMES[namingScheme].forEach(letter => {
            const head = document.createElement('div');
            head.className = 'card-head';
            head.textContent = letter;
            grid.appendChild(head);
        });

        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const value = card.rows[r][c];
                const key = r + '-' + c;

                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'card-cell';
                cell.dataset.key = key;

                if (value === 'FREE') {
                    cell.classList.add('free', 'marked');
                    cell.textContent = 'LIBRE';
                    cell.disabled = true;
                    grid.appendChild(cell);
                    continue;
                }

                cell.textContent = value;

                const alreadyCalled = drawnNumbers.includes(value);

                if (alreadyCalled) {
                    cell.classList.add('called');
                } else {
                    cell.classList.add('locked');
                    cell.disabled = true;
                }

                if (card.marks.has(key) || (autoDaub && alreadyCalled)) {
                    card.marks.add(key);
                    cell.classList.add('marked');
                }

                cell.addEventListener('click', () => toggleCardMark(card.id, key, cell));
                grid.appendChild(cell);
            }
        }

        wrap.appendChild(grid);

        const badge = document.createElement('div');
        badge.className = 'card-bingo-badge';
        badge.textContent = '¡BINGO!';
        wrap.appendChild(badge);

        if (card.hasBingo) {
            wrap.classList.add('bingo');
        }

        return wrap;
    }

    function renderCards() {
        cardsList.innerHTML = '';

        if (cards.length === 0) {
            cardsList.appendChild(emptyCards);
        } else {
            cards.forEach((card, index) => {
                cardsList.appendChild(buildCardElement(card, index + 1));
            });
        }

        updateCardsUI();
    }

    function updateCardsUI() {
        cardCountEl.textContent = cards.length;

        const isFull = cards.length >= MAX_CARDS;
        btnAddCard.disabled = isFull;
        btnAdd3.disabled = isFull;
        btnAdd6.disabled = isFull;
        btnClearCards.disabled = cards.length === 0;
    }

    /**
     * Al cantar una bola, habilita ese número en todos los cartones
     * y lo marca solo si el marcado automático está activo.
     */
    function markNumberOnCards(number) {
        let bingoCardNumber = null;

        cards.forEach(card => {
            const cardEl = getCardElement(card.id);

            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    if (card.rows[r][c] !== number) continue;

                    const key = r + '-' + c;
                    const cell = cardEl ? cardEl.querySelector('.card-cell[data-key="' + key + '"]') : null;

                    if (cell) {
                        cell.classList.remove('locked');
                        cell.classList.add('called');
                        cell.disabled = false;
                    }

                    if (autoDaub) {
                        card.marks.add(key);
                        if (cell) {
                            cell.classList.add('marked');
                        }
                    }
                }
            }

            if (autoDaub && !card.hasBingo && hasCompletedLine(card)) {
                card.hasBingo = true;
                if (cardEl) {
                    cardEl.classList.add('bingo');
                }
                bingoCardNumber = cards.indexOf(card) + 1;
            }
        });

        if (bingoCardNumber !== null) {
            triggerBingo(bingoCardNumber);
        }
    }

    /**
     * Selecciona / deselecciona un número del cartón (solo si ya salió).
     */
    function toggleCardMark(cardId, key, cellEl) {
        const card = getCardById(cardId);
        if (!card || cellEl.disabled) return;

        if (card.marks.has(key)) {
            card.marks.delete(key);
            cellEl.classList.remove('marked');
        } else {
            card.marks.add(key);
            cellEl.classList.add('marked');
            playTickSound();
        }

        if (!card.hasBingo && hasCompletedLine(card)) {
            card.hasBingo = true;
            const cardEl = getCardElement(cardId);
            if (cardEl) {
                cardEl.classList.add('bingo');
            }
            triggerBingo(cards.indexOf(card) + 1);
        }
    }

    /**
     * Reinicia las marcas de todos los cartones sin borrarlos.
     */
    function resetCards() {
        cards.forEach(card => {
            card.marks = new Set(['2-2']);
            card.hasBingo = false;
        });
        hideBingoToast();
        renderCards();
    }

    function triggerBingo(cardNumber) {
        playBingoSound();

        bingoToastText.textContent = '¡BINGO en el cartón ' + cardNumber + '!';
        bingoToast.classList.remove('hidden');

        if (bingoTimeoutId) {
            clearTimeout(bingoTimeoutId);
        }
        bingoTimeoutId = setTimeout(() => {
            bingoToast.classList.add('hidden');
        }, 6000);

        // Anunciar por voz después de que termine de cantar la bola
        setTimeout(() => {
            if (!voiceEnabled || !('speechSynthesis' in window)) return;
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance('Bingo, cartón número ' + cardNumber);
            utter.lang = 'es-ES';
            utter.rate = parseFloat(speechRateInput.value) || 1.0;
            utter.pitch = 1.05;
            if (selectedVoice) {
                utter.voice = selectedVoice;
            }
            window.speechSynthesis.speak(utter);
        }, 1200);
    }

    function hideBingoToast() {
        if (bingoTimeoutId) {
            clearTimeout(bingoTimeoutId);
            bingoTimeoutId = null;
        }
        bingoToast.classList.add('hidden');
    }

    // --- EVENT LISTENERS ---

    btnDraw.addEventListener('click', () => {
        drawRandomNumber();
    });

    btnAuto.addEventListener('click', toggleAutoDraw);

    btnVoiceToggle.addEventListener('click', () => {
        voiceEnabled = !voiceEnabled;
        if (voiceEnabled) {
            btnVoiceToggle.classList.add('active');
            voiceState.textContent = 'ON';
            voiceIcon.textContent = '🔊';
        } else {
            btnVoiceToggle.classList.remove('active');
            voiceState.textContent = 'OFF';
            voiceIcon.textContent = '🔇';
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        }
    });

    btnRepeat.addEventListener('click', () => {
        if (lastDrawn) {
            const letter = getLetterForNumber(lastDrawn);
            speakBall(letter, lastDrawn);
        }
    });

    // Modal de reinicio
    btnReset.addEventListener('click', () => {
        confirmModal.classList.remove('hidden');
    });

    btnCancelReset.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
    });

    btnConfirmReset.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        initGame();
    });

    // Configuración Drawer
    btnSettings.addEventListener('click', () => {
        settingsModal.classList.toggle('hidden');
    });

    btnCloseSettings.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    namingModeSelect.addEventListener('change', (e) => {
        namingScheme = e.target.value;
        if (lastDrawn) {
            valLetter.textContent = getLetterForNumber(lastDrawn);
        } else {
            valLetter.textContent = SCHEMES[namingScheme][0];
        }
        renderBoard();
        renderCards();
        renderHistory();
    });

    speechRateInput.addEventListener('input', (e) => {
        rateVal.textContent = `${e.target.value}x`;
    });

    autoSpeedInput.addEventListener('input', (e) => {
        autoSpeedVal.textContent = `${e.target.value}s`;
        if (autoIntervalId) {
            stopAutoDraw();
            startAutoDraw();
        }
    });

    // --- Eventos del panel de cartones ---

    btnAddCard.addEventListener('click', () => addCards(1));
    btnAdd3.addEventListener('click', () => addCards(3));
    btnAdd6.addEventListener('click', () => addCards(MAX_CARDS - cards.length));
    btnClearCards.addEventListener('click', clearCards);

    autoDaubInput.addEventListener('change', (e) => {
        autoDaub = e.target.checked;

        // Al activarlo, tachar de inmediato todo lo que ya ha salido
        cards.forEach(card => {
            card.marks = new Set(['2-2']);
            card.hasBingo = false;
        });
        if (autoDaub) {
            [...drawnNumbers].forEach(num => markNumberOnCards(num));
        }
        renderCards();
    });

    // Tecla Espacio para sortear rápidamente
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            if (!isDrawing && !btnDraw.disabled) {
                drawRandomNumber();
            }
        }
    });

    // --- Fondo de los cartones (se recuerda en este dispositivo) ---

    function pintarFondo(f) {
        const cuerpo = document.body;
        cuerpo.classList.remove('fondo-papel', 'fondo-tela', 'fondo-madera');
        cuerpo.style.removeProperty('--carton-foto');
        cuerpo.style.setProperty('--carton-opacidad', String(f && f.opacidad !== undefined ? f.opacidad : 0.4));
        if (!f || !f.tipo || f.tipo === 'ninguno') return;
        if (f.tipo === 'foto' && f.foto) cuerpo.style.setProperty('--carton-foto', 'url("' + f.foto + '")');
        else if (f.tipo === 'patron') cuerpo.classList.add('fondo-' + f.patron);
    }

    function leerFondo() {
        try { return JSON.parse(localStorage.getItem('ab_fondo') || 'null'); } catch (e) { return null; }
    }

    function guardarFondo(f) {
        try { localStorage.setItem('ab_fondo', JSON.stringify(f)); } catch (e) { /* sin espacio */ }
        pintarFondo(f);
    }

    (function iniciarFondos() {
        const botones = document.querySelectorAll('[data-fondo]');
        const rango = document.getElementById('fondoRango');
        const entrada = document.getElementById('fondoFoto');
        const intensidad = () => Number(rango ? rango.value : 40) / 100;

        botones.forEach((b) => b.addEventListener('click', () => {
            const v = b.dataset.fondo;
            guardarFondo(v === 'ninguno'
                ? { tipo: 'ninguno', opacidad: intensidad() }
                : { tipo: 'patron', patron: v, opacidad: intensidad() });
        }));

        if (rango) rango.addEventListener('change', () => {
            const f = leerFondo() || { tipo: 'ninguno' };
            f.opacidad = intensidad();
            guardarFondo(f);
        });

        const botonFoto = document.getElementById('btnFondoFoto');
        if (botonFoto && entrada) botonFoto.addEventListener('click', () => entrada.click());

        if (entrada) entrada.addEventListener('change', () => {
            const archivo = entrada.files && entrada.files[0];
            if (!archivo) return;
            const lector = new FileReader();
            lector.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const escala = Math.min(1, 1200 / Math.max(img.width, img.height));
                    const lienzo = document.createElement('canvas');
                    lienzo.width = Math.max(1, Math.round(img.width * escala));
                    lienzo.height = Math.max(1, Math.round(img.height * escala));
                    lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
                    guardarFondo({ tipo: 'foto', foto: lienzo.toDataURL('image/jpeg', 0.75), opacidad: intensidad() });
                };
                img.src = lector.result;
            };
            lector.readAsDataURL(archivo);
        });

        const guardado = leerFondo();
        if (guardado) {
            if (rango && guardado.opacidad !== undefined) rango.value = Math.round(guardado.opacidad * 100);
            pintarFondo(guardado);
        }
    })();

    // Inicializar el juego al cargar
    initGame();
});
