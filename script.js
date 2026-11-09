const keyboard = document.getElementById("keyboard");
const statusText = document.getElementById("status");

const firstMidi = 48;
const lastMidi = 95;

const noteNames = [
  "DO", "DO♯", "RE", "RE♯", "MI", "FA",
  "FA♯", "SOL", "SOL♯", "LA", "LA♯", "SI"
];

let audio = null;
let master = null;
let dryGain = null;
let reverbSend = null;
let wetGains = [];
let compressor = null;

let voices = new Map();
let demoRunning = false;
let demoToken = 0;

const keyElements = {};
const whiteNotes = [];
const pressedKeys = new Set();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function noteName(midi) {
  return noteNames[midi % 12] + (Math.floor(midi / 12) - 1);
}

function isWhite(midi) {
  return [0, 2, 4, 5, 7, 9, 11].includes(midi % 12);
}

function frequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ======================================
// MOTOR DE AUDIO
// ======================================

function initAudio() {
  if (audio) {
    if (audio.state === "suspended") {
      audio.resume();
    }
    return;
  }

  audio = new (window.AudioContext || window.webkitAudioContext)();

  master = audio.createGain();
  dryGain = audio.createGain();
  reverbSend = audio.createGain();

  compressor = audio.createDynamicsCompressor();

  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.25;

  master.gain.value = Number(
    document.getElementById("volume").value
  );

  dryGain.gain.value = 0.88;
  reverbSend.gain.value = 0.12;

  dryGain.connect(master);

  // Reverberación
  const delays = [0.105, 0.18, 0.265];
  const levels = [0.20, 0.12, 0.07];

  delays.forEach((time, index) => {
    const delay = audio.createDelay(1);
    const filter = audio.createBiquadFilter();
    const wet = audio.createGain();

    delay.delayTime.value = time;

    filter.type = "lowpass";
    filter.frequency.value = 2600 - index * 400;

    wet.gain.value =
      Number(document.getElementById("reverb").value) *
      levels[index];

    reverbSend.connect(delay);
    delay.connect(filter);
    filter.connect(wet);
    wet.connect(master);

    wetGains.push(wet);
  });

  master.connect(compressor);
  compressor.connect(audio.destination);
}

// ======================================
// VOLUMEN
// ======================================

document.getElementById("volume").addEventListener("input", e => {
  if (!master) return;

  master.gain.setTargetAtTime(
    Number(e.target.value),
    audio.currentTime,
    0.04
  );
});

// ======================================
// REVERBERACIÓN
// ======================================

document.getElementById("reverb").addEventListener("input", e => {
  if (!audio) return;

  const value = Number(e.target.value);
  const levels = [0.20, 0.12, 0.07];

  wetGains.forEach((gain, index) => {
    gain.gain.setTargetAtTime(
      value * levels[index],
      audio.currentTime,
      0.05
    );
  });
});

// ======================================
// CONSTRUIR TECLADO
// ======================================

function buildKeyboard() {
  keyboard.innerHTML = "";
  whiteNotes.length = 0;

  for (const midi in keyElements) {
    delete keyElements[midi];
  }

  for (let midi = firstMidi; midi <= lastMidi; midi++) {
    if (!isWhite(midi)) continue;

    whiteNotes.push(midi);

    const key = document.createElement("div");
    key.className = "white-key";
    key.dataset.midi = midi;

    const label = document.createElement("div");
    label.className = "key-label";
    label.textContent = noteName(midi);

    key.appendChild(label);
    keyboard.appendChild(key);

    keyElements[midi] = key;

    addTouchEvents(key, midi);
  }

  for (let midi = firstMidi; midi <= lastMidi; midi++) {
    if (isWhite(midi)) continue;

    const previousWhites = whiteNotes.filter(n => n < midi).length;

    const key = document.createElement("div");
    key.className = "black-key";
    key.dataset.midi = midi;

    key.style.left = (previousWhites / 28 * 100) + "%";

    keyboard.appendChild(key);

    keyElements[midi] = key;

    addTouchEvents(key, midi);
  }
}

// ======================================
// EVENTOS DE LAS TECLAS
// ======================================

function addTouchEvents(key, midi) {
  key.addEventListener("pointerdown", e => {
    e.preventDefault();

    initAudio();

    const id = "pointer-" + midi + "-" + e.pointerId;

    key.setPointerCapture(e.pointerId);
    playNote(midi, id);
  });

  function release(e) {
    noteOff("pointer-" + midi + "-" + e.pointerId);
  }

  key.addEventListener("pointerup", release);
  key.addEventListener("pointercancel", release);
  key.addEventListener("lostpointercapture", release);
}

// ======================================
// SONIDO DE PIANO
// ======================================

function playNote(midi, id) {
  initAudio();

  if (audio.state === "suspended") {
    audio.resume();
  }

  if (voices.has(id)) return;

  const now = audio.currentTime;
  const freq = frequency(midi);

  const voiceGain = audio.createGain();
  const filter = audio.createBiquadFilter();

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(
    Math.min(8500, 6000 + freq * 2),
    now
  );
  filter.Q.value = 0.45;

  voiceGain.gain.setValueAtTime(0.0001, now);

  voiceGain.gain.exponentialRampToValueAtTime(
    0.25,
    now + 0.018
  );

  voiceGain.gain.exponentialRampToValueAtTime(
    0.105,
    now + 0.75
  );

  filter.connect(voiceGain);

  voiceGain.connect(dryGain);
  voiceGain.connect(reverbSend);

  // Armónicos
  const harmonics = [
    { multiple: 1, level: 0.78 },
    { multiple: 2, level: 0.29 },
    { multiple: 3, level: 0.13 },
    { multiple: 4, level: 0.065 },
    { multiple: 5, level: 0.030 },
    { multiple: 6, level: 0.014 }
  ];

  const oscillators = [];

  harmonics.forEach((partial, index) => {
    const osc = audio.createOscillator();
    const partialGain = audio.createGain();

    osc.type = "sine";

    osc.frequency.setValueAtTime(
      freq * partial.multiple,
      now
    );

    partialGain.gain.setValueAtTime(partial.level, now);

    partialGain.gain.exponentialRampToValueAtTime(
      Math.max(
        0.0001,
        partial.level * (index === 0 ? 0.72 : 0.35)
      ),
      now + (index === 0 ? 2.5 : 0.9)
    );

    osc.connect(partialGain);
    partialGain.connect(filter);

    osc.start(now);
    oscillators.push(osc);
  });

  // Ataque del martillo
  const attackOsc = audio.createOscillator();
  const attackGain = audio.createGain();

  attackOsc.type = "triangle";
  attackOsc.frequency.value = freq * 3;

  attackGain.gain.setValueAtTime(0.018, now);
  attackGain.gain.exponentialRampToValueAtTime(
    0.0001,
    now + 0.035
  );

  attackOsc.connect(attackGain);
  attackGain.connect(filter);

  attackOsc.start(now);
  attackOsc.stop(now + 0.045);

  oscillators.push(attackOsc);

  // Evita errores con notas fuera del teclado visible
  if (keyElements[midi]) {
    keyElements[midi].classList.add("active");
  }

  voices.set(id, {
    midi,
    oscillators,
    gain: voiceGain,
    filter,
    held: true,
    released: false
  });
}

// ======================================
// LIBERAR NOTAS
// ======================================

function releaseVoice(id) {
  const voice = voices.get(id);

  if (!voice || voice.released) return;

  voice.released = true;

  const now = audio.currentTime;

  try {
    voice.gain.gain.cancelScheduledValues(now);

    voice.gain.gain.setTargetAtTime(
      0.0001,
      now,
      0.22
    );

    voice.oscillators.forEach(osc => {
      try {
        osc.stop(now + 1.6);
      } catch (e) {}
    });

    setTimeout(() => {
      voice.oscillators.forEach(osc => {
        try {
          osc.disconnect();
        } catch (e) {}
      });

      try {
        voice.gain.disconnect();
        voice.filter.disconnect();
      } catch (e) {}

    }, 1800);

  } catch (error) {}

  voices.delete(id);

  const stillPlaying = [...voices.values()].some(
    v => v.midi === voice.midi
  );

  if (!stillPlaying && keyElements[voice.midi]) {
    keyElements[voice.midi].classList.remove("active");
  }
}

function noteOff(id) {
  const voice = voices.get(id);

  if (!voice) return;

  voice.held = false;

  if (!document.getElementById("sustain").checked) {
    releaseVoice(id);
  }
}

// ======================================
// SUSTAIN
// ======================================

document.getElementById("sustain").addEventListener("change", e => {
  if (!e.target.checked) {
    for (const [id, voice] of [...voices]) {
      if (!voice.held) {
        releaseVoice(id);
      }
    }
  }
});

// ======================================
// TECLADO DE COMPUTADORA
// ======================================

const computerKeys = {
  "a": 48, "w": 49, "s": 50, "e": 51,
  "d": 52, "f": 53, "t": 54, "g": 55,
  "y": 56, "h": 57, "u": 58, "j": 59,
  "k": 60, "o": 61, "l": 62, "p": 63,
  ";": 64, "z": 65, "1": 66, "x": 67,
  "2": 68, "c": 69, "v": 71, "b": 72,
  "n": 74, "5": 75, "m": 76
};

window.addEventListener("keydown", e => {
  if (e.repeat) return;

  const key = e.key.toLowerCase();
  const midi = computerKeys[key];

  if (midi === undefined) return;

  e.preventDefault();

  initAudio();

  pressedKeys.add(key);
  playNote(midi, "computer-" + key);
});

window.addEventListener("keyup", e => {
  const key = e.key.toLowerCase();

  if (!pressedKeys.has(key)) return;

  pressedKeys.delete(key);
  noteOff("computer-" + key);
});

// ======================================
// DEMOSTRACIÓN
// ======================================

const demo = [
  { chord: [48, 52, 55], melody: [60, 64, 67, 64] },
  { chord: [43, 47, 50], melody: [67, 69, 67, 64] },
  { chord: [45, 48, 52], melody: [64, 67, 72, 69] },
  { chord: [41, 45, 48], melody: [69, 67, 64, 60] },

  { chord: [48, 52, 55], melody: [60, 62, 64, 67] },
  { chord: [43, 47, 50], melody: [67, 69, 72, 71] },
  { chord: [45, 48, 52], melody: [72, 71, 69, 67] },
  { chord: [41, 45, 48], melody: [64, 60, 64, 60] },

  { chord: [48, 52, 55], melody: [60, 64, 67, 72] },
  { chord: [43, 47, 50], melody: [71, 69, 67, 64] },
  { chord: [45, 48, 52], melody: [69, 72, 76, 72] },
  { chord: [41, 45, 48], melody: [72, 69, 67, 64, 60] }
];

async function startDemo() {
  stopSong();
  stopDemo();

  initAudio();

  document.getElementById("sustain").checked = false;

  demoRunning = true;
  const token = ++demoToken;

  statusText.textContent = "PLAYING";

  const beat = 500;

  for (let i = 0; i < demo.length; i++) {
    if (!demoRunning || token !== demoToken) return;

    const part = demo[i];

    part.chord.forEach((midi, index) => {
      const id = "demo-chord-" + i + "-" + index;

      playNote(midi, id);
      setTimeout(() => noteOff(id), beat * 3.5);
    });

    const interval = beat * 4 / part.melody.length;

    for (let j = 0; j < part.melody.length; j++) {
      if (!demoRunning || token !== demoToken) return;

      const midi = part.melody[j];
      const id = "demo-melody-" + i + "-" + j;

      playNote(midi, id);

      await sleep(interval * 0.85);
      noteOff(id);

      await sleep(interval * 0.15);
    }

    await sleep(100);
  }

  if (token === demoToken) {
    demoRunning = false;
    statusText.textContent = "READY";
  }
}

function stopDemo() {
  demoRunning = false;
  demoToken++;

  for (const id of [...voices.keys()]) {
    if (id.startsWith("demo-")) {
      releaseVoice(id);
    }
  }

  statusText.textContent = "STOPPED";
}

// ======================================
// CANCIÓN: LA BONDAD DE DIOS
// ======================================

let songRunning = false;
let songToken = 0;
let songSequence = 0;

const songBeat = 620;

const songChords = {
  C:     [48, 52, 55, 60],
  F:     [53, 57, 60, 65],
  G:     [55, 59, 62, 67],
  Am:    [57, 60, 64, 69],
  Am7:   [57, 60, 64, 67],
  Em:    [52, 55, 59, 64],
  "C/E": [52, 55, 60, 64],
  Fsus2: [53, 55, 60, 65]
};

const songIntro = [60, 64, 59, 57, 57, 60, 65, 64];

function songPlayNote(midi, token, duration) {
  if (!songRunning || token !== songToken) return;

  const id = "song-" + token + "-" + (++songSequence);

  playNote(midi, id);

  setTimeout(() => {
    noteOff(id);
  }, duration);
}

async function playSongIntro(token) {
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const midi of songIntro) {
      if (!songRunning || token !== songToken) return;

      songPlayNote(midi, token, songBeat * 0.8);
      songPlayNote(midi + 12, token, songBeat * 0.8);

      await sleep(songBeat);
    }
  }
}

async function playSongChord(name, token) {
  if (!songRunning || token !== songToken) return;

  const chord = songChords[name];

  if (!chord) return;

  songPlayNote(chord[0], token, songBeat * 3.5);

  const pattern = [1, 2, 3, 2, 1, 2, 3, 2];

  for (const index of pattern) {
    if (!songRunning || token !== songToken) return;

    songPlayNote(chord[index], token, songBeat * 0.42);

    await sleep(songBeat / 2);
  }
}

async function playSongSection(chords, token) {
  for (const chord of chords) {
    if (!songRunning || token !== songToken) return;

    await playSongChord(chord, token);
  }
}

async function startSong() {
  stopDemo();
  stopSong();

  initAudio();

  document.getElementById("sustain").checked = false;

  songRunning = true;
  const token = ++songToken;

  statusText.textContent = "LA BONDAD DE DIOS ♫";

  try {
    await playSongIntro(token);

    await playSongSection([
      "C", "F", "C",
      "G", "Am", "F", "G",
      "Am", "F", "C", "G", "Am",
      "G", "F", "G", "C"
    ], token);

    await playSongSection([
      "F", "C", "G", "Am", "F",
      "F", "C", "G", "Am7", "F",
      "F", "C", "G", "Am",
      "G", "F", "G", "C"
    ], token);

    await playSongIntro(token);

    await playSongSection([
      "C", "F", "C",
      "G", "Am", "F", "G",
      "Am", "F", "C", "G", "Am7",
      "G", "F", "G", "C"
    ], token);

    await playSongSection([
      "F", "C", "G", "Am", "F",
      "F", "C", "G", "Am7", "F",
      "F", "C", "G", "Am",
      "G", "F", "G", "C"
    ], token);

    await playSongSection([
      "C/E", "Fsus2", "G", "C",
      "C/E", "Fsus2", "G", "C"
    ], token);

    await playSongSection([
      "C/E", "Fsus2", "G", "C",
      "C/E", "Fsus2", "G", "C",
      "C/E", "Fsus2", "Am",
      "C/E", "Fsus2", "G", "C"
    ], token);

    await playSongIntro(token);

    await playSongSection([
      "F", "C", "G", "Am", "F",
      "F", "C", "G", "Am", "F",
      "F", "C", "G", "Am",
      "G", "F", "G", "C"
    ], token);

    await playSongChord("G", token);

    if (token === songToken) {
      songRunning = false;
      statusText.textContent = "FIN DE LA CANCIÓN";
    }

  } catch (error) {
    console.error("Error reproduciendo canción:", error);
    songRunning = false;
    statusText.textContent = "ERROR DE AUDIO";
  }
}

function stopSong() {
  songRunning = false;
  songToken++;

  for (const id of [...voices.keys()]) {
    if (id.startsWith("song-")) {
      releaseVoice(id);
    }
  }
}

// ======================================
// BOTONES DE DEMOSTRACIÓN Y CANCIÓN
// ======================================

document.getElementById("demoBtn").addEventListener("click", startDemo);
document.getElementById("songBtn").addEventListener("click", startSong);

// ======================================
// METRÓNOMO
// ======================================

let metroAudio = null;
let metroTimer = null;
let metroBeat = 0;
let metroRunning = false;

const metroBtn = document.getElementById("metroBtn");
const bpmSlider = document.getElementById("bpm");
const bpmValue = document.getElementById("bpmValue");
const metroLights = document.querySelectorAll(".metro-light");

function metroClick(accent = false) {
  if (!metroAudio) return;

  const now = metroAudio.currentTime;

  const osc = metroAudio.createOscillator();
  const gain = metroAudio.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(accent ? 1500 : 1000, now);

  gain.gain.setValueAtTime(0.0001, now);

  gain.gain.exponentialRampToValueAtTime(
    accent ? 0.45 : 0.25,
    now + 0.004
  );

  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    now + 0.065
  );

  osc.connect(gain);
  gain.connect(metroAudio.destination);

  osc.start(now);
  osc.stop(now + 0.075);

  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function metroPulse() {
  const beatPosition = metroBeat % 4;

  metroLights.forEach((light, index) => {
    light.classList.toggle("active", index === beatPosition);
  });

  metroClick(beatPosition === 0);

  metroBeat++;
}

function startMetronome() {
  if (metroRunning) return;

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!metroAudio) {
    metroAudio = new AudioContextClass();
  }

  metroAudio.resume();

  metroRunning = true;
  metroBeat = 0;

  metroBtn.textContent = "■ DETENER";

  metroPulse();

  const bpm = Number(bpmSlider.value);
  const interval = 60000 / bpm;

  metroTimer = setInterval(() => {
    metroPulse();
  }, interval);
}

function stopMetronome() {
  metroRunning = false;

  if (metroTimer) {
    clearInterval(metroTimer);
    metroTimer = null;
  }

  metroBtn.textContent = "▶ INICIAR";

  metroLights.forEach(light => {
    light.classList.remove("active");
  });

  metroBeat = 0;
}

function updateMetronomeTempo() {
  const bpm = Number(bpmSlider.value);

  bpmValue.textContent = bpm + " BPM";

  if (metroRunning) {
    stopMetronome();
    startMetronome();
  }
}

metroBtn.addEventListener("click", () => {
  if (metroRunning) {
    stopMetronome();
  } else {
    startMetronome();
  }
});

bpmSlider.addEventListener("input", updateMetronomeTempo);

// ======================================
// CLASES DE TECLADO - SIETE ACORDES MAYORES
// ======================================

const chordLessons = {
  C: {
    name: "DO MAYOR",
    left: [48, 55, 60],
    right: [72, 76, 79],
    leftFingers: "5 - 2 - 1",
    rightFingers: "1 - 3 - 5"
  },

  D: {
    name: "RE MAYOR",
    left: [50, 57, 62],
    right: [74, 78, 81],
    leftFingers: "5 - 2 - 1",
    rightFingers: "1 - 3 - 5"
  },

  E: {
    name: "MI MAYOR",
    left: [52, 59, 64],
    right: [76, 80, 83],
    leftFingers: "5 - 2 - 1",
    rightFingers: "1 - 3 - 5"
  },

  F: {
    name: "FA MAYOR",
    left: [53, 60, 65],
    right: [77, 81, 84],
    leftFingers: "5 - 2 - 1",
    rightFingers: "1 - 3 - 5"
  },

  G: {
    name: "SOL MAYOR",
    left: [55, 62, 67],
    right: [79, 83, 86],
    leftFingers: "5 - 2 - 1",
    rightFingers: "1 - 3 - 5"
  },

  A: {
    name: "LA MAYOR",
    left: [57, 64, 69],
    right: [81, 85, 88],
    leftFingers: "5 - 2 - 1",
    rightFingers: "1 - 3 - 5"
  },

  B: {
    name: "SI MAYOR",
    left: [59, 66, 71],
    right: [83, 87, 90],
    leftFingers: "5 - 2 - 1",
    rightFingers: "1 - 3 - 5"
  }
};

// ======================================
// ELEMENTOS DE LAS CLASES
// ======================================

const chordSelect = document.getElementById("chordSelect");
const chordName = document.getElementById("chordName");
const chordNotes = document.getElementById("chordNotes");
const fingerInfo = document.getElementById("fingerInfo");

const listenChordBtn = document.getElementById("listenChord");
const stopChordBtn = document.getElementById("stopChord");

let selectedHand = "right";
let lessonVoices = [];
let lessonTimers = [];

// ======================================
// OBTENER NOTAS DEL ACORDE
// ======================================

function getChordNotes() {
  const chord = chordLessons[chordSelect.value];

  if (!chord) return [];

  if (selectedHand === "left") {
    return chord.left;
  }

  if (selectedHand === "right") {
    return chord.right;
  }

  return [...new Set([...chord.left, ...chord.right])];
}

// ======================================
// ACTUALIZAR INFORMACIÓN DE LA CLASE
// ======================================

function updateChordLesson() {
  const chord = chordLessons[chordSelect.value];

  if (!chord) return;

  chordName.textContent = chord.name;

  const notes = getChordNotes();

  const names = notes.map(midi => {
    return noteNames[midi % 12];
  });

  chordNotes.textContent = names.join(" - ");

  if (selectedHand === "left") {
    fingerInfo.textContent =
      "MANO IZQUIERDA | Dedos: " + chord.leftFingers;

  } else if (selectedHand === "right") {
    fingerInfo.textContent =
      "MANO DERECHA | Dedos: " + chord.rightFingers;

  } else {
    fingerInfo.textContent =
      "IZQUIERDA: " + chord.leftFingers +
      " | DERECHA: " + chord.rightFingers;
  }

  highlightChordKeys();
}

// ======================================
// ILUMINAR LAS TECLAS DEL ACORDE
// ======================================

function highlightChordKeys() {
  document.querySelectorAll(".white-key, .black-key")
    .forEach(key => {
      key.classList.remove("lesson-highlight");
    });

  const notes = getChordNotes();

  notes.forEach(midi => {
    const key = document.querySelector(
      `[data-midi="${midi}"]`
    );

    if (key) {
      key.classList.add("lesson-highlight");
    }
  });
}

// ======================================
// DETENER ACORDE DE LA CLASE
// ======================================

function stopLessonChord() {
  lessonTimers.forEach(timer => clearTimeout(timer));
  lessonTimers = [];

  lessonVoices.forEach(id => noteOff(id));
  lessonVoices = [];
}

// ======================================
// ESCUCHAR ACORDE
// ======================================

function playLessonChord() {
  stopLessonChord();

  initAudio();

  const notes = getChordNotes();

  notes.forEach((midi, index) => {
    const id = "lesson-chord-" + Date.now() + "-" + index;

    lessonVoices.push(id);

    playNote(midi, id);

    const timer = setTimeout(() => {
      noteOff(id);
    }, 2000);

    lessonTimers.push(timer);
  });

  statusText.textContent =
    "ACORDE: " + chordLessons[chordSelect.value].name;
}

// ======================================
// CAMBIAR ACORDE
// ======================================

chordSelect.addEventListener("change", () => {
  stopLessonChord();
  updateChordLesson();
});

// ======================================
// CAMBIAR MANO
// ======================================

document.querySelectorAll(".hand-btn").forEach(button => {
  button.addEventListener("click", () => {
    stopLessonChord();

    document.querySelectorAll(".hand-btn")
      .forEach(btn => btn.classList.remove("active"));

    button.classList.add("active");

    selectedHand = button.dataset.hand;

    updateChordLesson();
  });
});

// ======================================
// BOTONES DE LAS CLASES
// ======================================

listenChordBtn.addEventListener("click", playLessonChord);

stopChordBtn.addEventListener("click", () => {
  stopLessonChord();
  statusText.textContent = "ACORDE DETENIDO";
});

// ======================================
// BOTÓN STOP GENERAL
// ======================================

document.getElementById("stopBtn").addEventListener("click", () => {
  stopDemo();
  stopSong();
  stopMetronome();
  stopLessonChord();

  statusText.textContent = "TODO DETENIDO";
});

// ======================================
// EVITAR NOTAS PEGADAS AL CAMBIAR DE VENTANA
// ======================================

window.addEventListener("blur", () => {
  for (const key of pressedKeys) {
    noteOff("computer-" + key);
  }

  pressedKeys.clear();
});

// ======================================
// INICIAR TECLADO Y CLASES
// ======================================

buildKeyboard();
updateChordLesson();