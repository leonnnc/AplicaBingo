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

    // Tecla Espacio para sortear rápidamente
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            if (!isDrawing && !btnDraw.disabled) {
                drawRandomNumber();
            }
        }
    });

    // Inicializar el juego al cargar
    initGame();
});
