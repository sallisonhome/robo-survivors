// ============================================================================
// ROBO SURVIVORS — Twin-Stick Shooter Roguelike
// Pure vanilla JS + HTML5 Canvas + Web Audio API + Gamepad API
// ============================================================================

'use strict';

// ============================================================================
// 1. CONSTANTS & CONFIGURATION
// ============================================================================

const WORLD_W = 2400;
const WORLD_H = 2400;
const GRID_SIZE = 64;
const TICK_RATE = 1000 / 60;
const PLAYER_SPEED = 280;
const PLAYER_SIZE = 14;
const PLAYER_MAX_HP = 100;
const PLAYER_IFRAMES = 1.0; // seconds of invincibility after damage
const LASER_SPEED = 800;
const LASER_COOLDOWN = 0.08; // seconds between shots
const LASER_DAMAGE = 1;
const LASER_LENGTH = 8;
const LASER_WIDTH = 3;
const XP_MAGNET_RADIUS = 80;
const XP_MAGNET_SPEED = 400;
const DEADZONE = 0.2;

// Gem XP values
const GEM_SMALL = 1;
const GEM_MED = 5;
const GEM_LARGE = 25;
const GEM_GOLD = 50;

// Colors
const C = {
  bg: '#000000',
  grid: '#111111',
  border: '#00ffff',
  player: '#00e5ff',
  playerDark: '#007a8a',
  laser: '#ffffff',
  laserGlow: '#00e5ff',
  grunt: '#ff2266',
  gruntDark: '#aa1144',
  hulk: '#22cc44',
  hulkArm: '#cccc22',
  spheroid: '#4488ff',
  enforcer: '#00ccff',
  enforcerSpark: '#ff6622',
  quark: '#ff4400',
  tank: '#228833',
  tankShell: '#ffff44',
  brain: '#cc44cc',
  brainGlow: '#ffaaff',
  prog: '#882222',
  electrode: '#ff4444',
  electrodePulse: '#ffff44',
  mommy: '#ff6699',
  daddy: '#4488cc',
  mikey: '#cccc44',
  gemSmall: '#4488ff',
  gemMed: '#44cc66',
  gemLarge: '#ff4444',
  gemGold: '#ffcc00',
  xpBar: '#00ccff',
  hpBar: '#44ff44',
  hpBarDmg: '#ff4444',
  textWhite: '#ffffff',
  textYellow: '#ffcc00',
  textCyan: '#00e5ff',
};

// ============================================================================
// 2. UTILITY FUNCTIONS
// ============================================================================

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const angle = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
const randF = (lo, hi) => Math.random() * (hi - lo) + lo;
const randI = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const randSign = () => Math.random() < 0.5 ? -1 : 1;

function applyDeadzone(x, y, threshold) {
  const mag = Math.hypot(x, y);
  if (mag < threshold) return { x: 0, y: 0 };
  const norm = (mag - threshold) / (1 - threshold);
  return { x: (x / mag) * norm, y: (y / mag) * norm };
}

// ============================================================================
// 3. SPATIAL GRID (collision acceleration)
// ============================================================================

class SpatialGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  clear() { this.cells.clear(); }
  _key(x, y) {
    return ((Math.floor(x / this.cellSize)) * 73856093) ^ ((Math.floor(y / this.cellSize)) * 19349663);
  }
  insert(entity) {
    const k = this._key(entity.x, entity.y);
    let cell = this.cells.get(k);
    if (!cell) { cell = []; this.cells.set(k, cell); }
    cell.push(entity);
  }
  query(x, y, radius) {
    const results = [];
    const cs = this.cellSize;
    const minCX = Math.floor((x - radius) / cs);
    const maxCX = Math.floor((x + radius) / cs);
    const minCY = Math.floor((y - radius) / cs);
    const maxCY = Math.floor((y + radius) / cs);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const k = (cx * 73856093) ^ (cy * 19349663);
        const cell = this.cells.get(k);
        if (cell) {
          for (let i = 0; i < cell.length; i++) results.push(cell[i]);
        }
      }
    }
    return results;
  }
}

// ============================================================================
// 4. OBJECT POOLS
// ============================================================================

class Pool {
  constructor(createFn, size) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const item = createFn();
      item.active = false;
      this.items.push(item);
    }
  }
  get() {
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].active) { this.items[i].active = true; return this.items[i]; }
    }
    return null;
  }
  forEach(fn) {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].active) fn(this.items[i]);
    }
  }
  countActive() {
    let c = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].active) c++;
    return c;
  }
}

// ============================================================================
// 5. INPUT SYSTEM
// ============================================================================

const Input = {
  keys: {},
  justPressed: {},
  gamepad: null,
  gpButtons: new Array(17).fill(false),
  gpButtonsJust: new Array(17).fill(false),
  moveX: 0, moveY: 0,
  aimX: 0, aimY: 0,
  
  init() {
    document.addEventListener('keydown', e => {
      if (!this.keys[e.code]) this.justPressed[e.code] = true;
      this.keys[e.code] = true;
      e.preventDefault();
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('gamepadconnected', e => {
      console.log('Gamepad connected:', e.gamepad.id);
    });
  },

  update() {
    // Reset just-pressed
    this.gpButtonsJust.fill(false);
    
    // Gamepad polling
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.gamepad = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].mapping === 'standard') {
        this.gamepad = gamepads[i];
        break;
      }
    }

    let mx = 0, my = 0, ax = 0, ay = 0;

    if (this.gamepad) {
      const gp = this.gamepad;
      // Sticks
      const left = applyDeadzone(gp.axes[0], gp.axes[1], DEADZONE);
      const right = applyDeadzone(gp.axes[2], gp.axes[3], DEADZONE);
      mx = left.x; my = left.y;
      ax = right.x; ay = right.y;
      
      // Buttons
      for (let i = 0; i < Math.min(gp.buttons.length, 17); i++) {
        const pressed = gp.buttons[i].pressed;
        if (pressed && !this.gpButtons[i]) this.gpButtonsJust[i] = true;
        this.gpButtons[i] = pressed;
      }
    }

    // Keyboard movement (WASD)
    if (this.keys['KeyW'] || this.keys['ArrowUp'] && !this.gamepad) my = -1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'] && !this.gamepad) my = 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'] && !this.gamepad) mx = -1;
    if (this.keys['KeyD'] || this.keys['ArrowRight'] && !this.gamepad) mx = 1;

    // WASD for movement only when gamepad not active
    if (!this.gamepad) {
      mx = 0; my = 0;
      if (this.keys['KeyW']) my -= 1;
      if (this.keys['KeyS']) my += 1;
      if (this.keys['KeyA']) mx -= 1;
      if (this.keys['KeyD']) mx += 1;
      // Normalize diagonal
      const mMag = Math.hypot(mx, my);
      if (mMag > 1) { mx /= mMag; my /= mMag; }

      // Arrow keys for aiming
      ax = 0; ay = 0;
      if (this.keys['ArrowLeft']) ax -= 1;
      if (this.keys['ArrowRight']) ax += 1;
      if (this.keys['ArrowUp']) ay -= 1;
      if (this.keys['ArrowDown']) ay += 1;
      const aMag = Math.hypot(ax, ay);
      if (aMag > 1) { ax /= aMag; ay /= aMag; }
    }

    this.moveX = mx;
    this.moveY = my;
    this.aimX = ax;
    this.aimY = ay;
  },

  endFrame() { this.justPressed = {}; },
  isDown(code) { return !!this.keys[code]; },
  wasPressed(code) { return !!this.justPressed[code]; },
  gpJust(index) { return this.gpButtonsJust[index]; },
  gpDown(index) { return this.gpButtons[index]; },
  startPressed() { return this.gpJust(9) || this.wasPressed('Enter') || this.wasPressed('Space'); },
  confirmPressed() { return this.gpJust(0) || this.wasPressed('Enter') || this.wasPressed('Space'); },
  backPressed() { return this.gpJust(1) || this.wasPressed('Backspace') || this.wasPressed('Escape'); },
};

// ============================================================================
// 6. AUDIO SYSTEM (Procedural Web Audio)
// ============================================================================

let audioCtx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioCtx.destination);
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 1.0;
  sfxGain.connect(masterGain);
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.3;
  musicGain.connect(masterGain);
}

function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// Sound priority system
let activeSounds = 0;
const MAX_CONCURRENT_SFX = 12;
const recentSounds = {};

function playTone(freq, duration, type, volume, pitchEnd, delay) {
  if (!audioCtx || activeSounds >= MAX_CONCURRENT_SFX) return;
  
  // Dedup identical sounds within 30ms
  const key = `${Math.round(freq)}_${type}`;
  const now = audioCtx.currentTime;
  if (recentSounds[key] && now - recentSounds[key] < 0.03) return;
  recentSounds[key] = now;
  
  activeSounds++;
  const startTime = now + (delay || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, startTime);
  if (pitchEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(pitchEnd, 20), startTime + duration);
  gain.gain.setValueAtTime(volume || 0.15, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(sfxGain);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
  osc.onended = () => { activeSounds--; };
}

function playNoise(duration, volume, delay) {
  if (!audioCtx || activeSounds >= MAX_CONCURRENT_SFX) return;
  activeSounds++;
  const startTime = audioCtx.currentTime + (delay || 0);
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume || 0.1, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  src.connect(gain).connect(sfxGain);
  src.start(startTime);
  src.onended = () => { activeSounds--; };
}

// Named sound effects
const SFX = {
  playerLaser() {
    // Robotron-style rapid zap — raw, aggressive, arcade
    const f = 1100 + randF(-60, 60);
    playTone(f, 0.04, 'square', 0.18, 400);
    playTone(f * 0.5, 0.025, 'sawtooth', 0.08, f * 0.2, 0.008);
  },
  playerDamage() {
    playNoise(0.08, 0.2);
    playTone(200, 0.08, 'sawtooth', 0.15, 100);
  },
  playerDeath() {
    playTone(800, 0.6, 'sawtooth', 0.25, 50, 0.1);
    playNoise(0.4, 0.2);
  },
  robotExplode() {
    playNoise(0.04, 0.12);
    playTone(400, 0.05, 'square', 0.1, 100);
  },
  humanRescue(rescueCount) {
    const baseNote = 523 + rescueCount * 60; // C5 + offset per rescue
    playTone(baseNote, 0.06, 'sine', 0.15);
    playTone(baseNote * 1.25, 0.06, 'sine', 0.15, null, 0.06);
    playTone(baseNote * 1.5, 0.06, 'sine', 0.15, null, 0.12);
  },
  humanDeath() {
    playTone(500, 0.15, 'sine', 0.08, 200);
  },
  xpGem() {
    playTone(1400 + randF(-100, 100), 0.025, 'sine', 0.06);
  },
  waveStart() {
    playTone(100, 0.3, 'sawtooth', 0.15, 600);
  },
  waveClear() {
    playTone(523, 0.08, 'square', 0.12);
    playTone(659, 0.08, 'square', 0.12, null, 0.05);
    playTone(784, 0.08, 'square', 0.12, null, 0.1);
    playTone(1047, 0.12, 'square', 0.12, null, 0.15);
  },
  levelUp() {
    const notes = [262, 330, 392, 523, 659];
    notes.forEach((n, i) => playTone(n, 0.08, 'square', 0.12, null, i * 0.06));
  },
  menuNav() {
    playTone(1000, 0.015, 'square', 0.08);
  },
  menuConfirm() {
    playTone(523, 0.05, 'square', 0.1);
    playTone(784, 0.05, 'square', 0.1, null, 0.05);
  },
  hulkThud() {
    playTone(80, 0.1, 'sine', 0.15);
    playNoise(0.05, 0.08);
  },
  // Enemy-specific firing sounds
  enforcerFire() {
    // Sharp electric zap — distinct from player laser
    playTone(1400, 0.035, 'square', 0.2, 700);
    playTone(800, 0.025, 'sawtooth', 0.1, 400, 0.015);
  },
  tankFire() {
    // Heavy cannon boom
    playTone(120, 0.1, 'square', 0.25, 40);
    playNoise(0.08, 0.15);
  },
  tankBounce() {
    // Metallic ricochet ping
    playTone(2200, 0.025, 'sine', 0.15, 1000);
  },
  brainMissileLaunch() {
    // Ominous rising tone — danger incoming
    playTone(120, 0.25, 'sawtooth', 0.2, 600);
    playTone(200, 0.15, 'square', 0.08, 400, 0.1);
  },
  brainAmbient() {
    // Eerie warble — two detuned tones beating
    playTone(250, 0.4, 'sine', 0.06);
    playTone(253, 0.4, 'sine', 0.06);
  },
  spheroidSpawn() {
    // Birthing pop
    playTone(300, 0.1, 'sine', 0.15, 700);
    playTone(500, 0.08, 'sine', 0.1, 900, 0.04);
  },
  quarkSpawn() {
    // Distorted crunch
    playTone(400, 0.08, 'square', 0.15, 150);
    playNoise(0.05, 0.1);
  },
  // Human death — ominous Midway-style cue
  humanDeathOminous() {
    // Descending doom chord — like Defender losing a humanoid
    playTone(440, 0.3, 'sawtooth', 0.2, 180);
    playTone(349, 0.35, 'square', 0.15, 140, 0.05);
    playTone(220, 0.4, 'sawtooth', 0.12, 80, 0.12);
    playNoise(0.2, 0.08, 0.05);
  },
  // Brain captures human — sinister
  brainCapture() {
    playTone(600, 0.3, 'sawtooth', 0.12, 200);
    playTone(400, 0.2, 'square', 0.06, 100, 0.1);
  },
  // Grunt march (low rumble when many grunts)
  gruntMarch() {
    playTone(60, 0.08, 'square', 0.04);
  },
  // Game transitions — Midway style
  gameStart() {
    // Robotron-style dramatic ascending fanfare
    const notes = [196, 262, 330, 392, 523, 659, 784];
    notes.forEach((n, i) => playTone(n, 0.1, 'square', 0.2, null, i * 0.06));
    playNoise(0.12, 0.1, 0.42);
    playTone(784, 0.2, 'sawtooth', 0.15, 1568, 0.48);
  },
  gameOverDramatic() {
    // Defender/Robotron total death — gut-punch descending doom
    playTone(800, 0.2, 'sawtooth', 0.3, 200);
    playTone(500, 0.25, 'square', 0.25, 80, 0.15);
    playTone(250, 0.5, 'sawtooth', 0.2, 40, 0.35);
    playNoise(0.6, 0.12, 0.1);
    // Final low thud of doom
    playTone(40, 0.4, 'sine', 0.25, 20, 0.85);
  },
  waveTransition() {
    // Robotron wave-start battle cry — ascending sweep + impact
    playTone(80, 0.25, 'sawtooth', 0.18, 1000);
    playNoise(0.08, 0.1, 0.2);
    playTone(1000, 0.12, 'square', 0.2, 500, 0.22);
  },
  // ---- WEAPON EFFECT SOUNDS ----
  orbitalHit() {
    // Crystalline chime when orb hits
    playTone(1800 + randF(-100, 100), 0.03, 'sine', 0.06, 1200);
  },
  missilelaunch() {
    // Whoosh + ignition
    playTone(600, 0.05, 'sawtooth', 0.08, 400);
    playNoise(0.03, 0.04);
  },
  shockwaveBlast() {
    // Deep concussive boom — feel it in your chest
    playTone(60, 0.18, 'sine', 0.25, 25);
    playTone(120, 0.15, 'square', 0.15, 40, 0.02);
    playNoise(0.12, 0.1, 0.04);
  },
  lightningCrackle() {
    // Electric crackling arc — aggressive sizzle, multiple fast pops
    playTone(2400 + randF(-200, 200), 0.025, 'square', 0.2, 1600);
    playTone(1800 + randF(-200, 200), 0.02, 'square', 0.15, 1000, 0.012);
    playTone(3000 + randF(-300, 300), 0.015, 'square', 0.1, 2000, 0.022);
    playNoise(0.04, 0.08, 0.008);
  },
  flameWhoosh() {
    // Rushing fire sound
    playNoise(0.06, 0.05);
    playTone(200, 0.04, 'sawtooth', 0.03, 100);
  },
  spreadBlast() {
    // Shotgun scatter
    playTone(700, 0.03, 'square', 0.08, 400);
    playNoise(0.025, 0.06);
  },
  mineArm() {
    // Click-beep when mine arms
    playTone(1500, 0.01, 'square', 0.06);
    playTone(2000, 0.01, 'square', 0.04, null, 0.02);
  },
  mineExplode() {
    // Heavy detonation — satisfying kaboom
    playTone(80, 0.18, 'square', 0.28, 25);
    playNoise(0.15, 0.2);
    playTone(50, 0.12, 'sine', 0.15, 20, 0.08);
  },
  plasmaFire() {
    // Energy beam charge + release
    playTone(200, 0.08, 'sawtooth', 0.1, 800);
    playTone(400, 0.06, 'sine', 0.06, 1200, 0.04);
  },
  stompyTransform() {
    // Massive powering-up sound
    playTone(80, 0.3, 'sawtooth', 0.2, 400);
    playTone(200, 0.25, 'square', 0.12, 800, 0.1);
    playNoise(0.2, 0.08, 0.05);
    playTone(600, 0.15, 'sine', 0.1, 1200, 0.25);
  },
  stompyCrush() {
    // Heavy stomp impact
    playTone(50, 0.08, 'sine', 0.12, 25);
    playNoise(0.04, 0.06);
  },
  // ---- DISTINCT ENEMY DEATH SOUNDS ----
  gruntDeath() {
    playNoise(0.03, 0.1);
    playTone(400, 0.04, 'square', 0.08, 100);
  },
  hulkKnockback() {
    playTone(60, 0.12, 'sine', 0.12);
    playNoise(0.04, 0.06);
  },
  spheroidPop() {
    // Bubble burst
    playTone(300, 0.04, 'sine', 0.1, 800);
    playTone(600, 0.03, 'sine', 0.06, 1200, 0.02);
  },
  enforcerShatter() {
    // Glass-like shatter
    playTone(1500, 0.03, 'square', 0.08, 600);
    playNoise(0.03, 0.06);
  },
  quarkExplode() {
    // Spinning-up then pop
    playTone(300, 0.06, 'sawtooth', 0.08, 1200);
    playNoise(0.04, 0.06, 0.04);
  },
  tankDestroy() {
    // Metallic crunch
    playTone(200, 0.08, 'square', 0.12, 60);
    playNoise(0.06, 0.08);
    playTone(100, 0.06, 'sawtooth', 0.06, 40, 0.06);
  },
  brainDeath() {
    // Satisfying multi-stage: crack then warble
    playTone(800, 0.04, 'square', 0.12, 200);
    playTone(400, 0.15, 'sine', 0.08, 100, 0.05);
    playNoise(0.06, 0.06, 0.02);
  },
  progDeath() {
    // Glitchy dissolution
    playTone(600, 0.03, 'square', 0.06, 200);
    playTone(900, 0.02, 'square', 0.04, 300, 0.02);
  },
  electrodeFry() {
    // Electric sizzle
    playTone(100, 0.04, 'sawtooth', 0.06, 50);
    playNoise(0.03, 0.04);
  },
};

// ============================================================================
// 6b. HEARTBEAT TENSION SYSTEM
// ============================================================================

// Heartbeat speeds up as enemies kill more humans (NOT when player rescues them)
let heartbeatTimer = 0;
let heartbeatRate = 1.2; // seconds between beats (slower = calmer)
let heartbeatActive = false;

function updateHeartbeat(dt) {
  if (!audioCtx || game.state !== 'playing' || game.betweenWaves) {
    heartbeatActive = false;
    return;
  }
  
  const totalHumans = game.waveHumansStart;
  const lost = game.waveHumansLost;
  const alive = game.humans.length;
  
  if (totalHumans <= 0 || alive <= 0) { heartbeatActive = false; return; }
  
  // Heartbeat activates when enemies start killing humans
  const lossRatio = lost / totalHumans; // 0 = none lost, 1 = all lost
  
  if (lost === 0) {
    heartbeatActive = false;
    return;
  }
  
  heartbeatActive = true;
  
  // Rate: faster as more humans die to enemies
  // 1.2s between beats when first human dies -> 0.3s when almost all dead
  heartbeatRate = lerp(1.2, 0.3, Math.min(1, lossRatio * 2));
  
  // Even faster when very few remain
  if (alive <= 3) heartbeatRate = Math.min(heartbeatRate, 0.25);
  if (alive <= 1) heartbeatRate = 0.18;
  
  heartbeatTimer -= dt;
  if (heartbeatTimer <= 0) {
    heartbeatTimer = heartbeatRate;
    
    // Volume increases with urgency
    const vol = lerp(0.04, 0.12, lossRatio);
    
    // Double-beat pattern: thump-thump... thump-thump...
    // First beat (heavier)
    playTone(45, 0.08, 'sine', vol, 30);
    playTone(55, 0.06, 'sine', vol * 0.6, 35, 0.02);
    // Second beat (lighter, quick follow-up)
    playTone(50, 0.06, 'sine', vol * 0.7, 35, heartbeatRate * 0.3);
    playTone(60, 0.04, 'sine', vol * 0.4, 40, heartbeatRate * 0.3 + 0.02);
  }
}

// ============================================================================
// 7. PARTICLE SYSTEM
// ============================================================================

const particles = new Pool(() => ({
  active: false, x: 0, y: 0, vx: 0, vy: 0,
  life: 0, maxLife: 0, color: '#fff', size: 3,
}), 600);

function emitParticles(x, y, count, color, spread, speed, life, size) {
  for (let i = 0; i < count; i++) {
    const p = particles.get();
    if (!p) break;
    const a = randF(0, Math.PI * 2);
    const s = randF(speed * 0.3, speed);
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * s + randF(-spread, spread);
    p.vy = Math.sin(a) * s + randF(-spread, spread);
    p.life = life + randF(0, life * 0.5);
    p.maxLife = p.life;
    p.color = color;
    p.size = size || 3;
  }
}

function emitDirectionalParticles(x, y, count, color, dirX, dirY, spread, speed, life, size) {
  for (let i = 0; i < count; i++) {
    const p = particles.get();
    if (!p) break;
    p.x = x; p.y = y;
    p.vx = dirX * speed + randF(-spread, spread);
    p.vy = dirY * speed + randF(-spread, spread);
    p.life = life + randF(0, life * 0.3);
    p.maxLife = p.life;
    p.color = color;
    p.size = size || 3;
  }
}

// ============================================================================
// 8. FLOATING TEXT
// ============================================================================

const floatingTexts = [];

function spawnFloatingText(x, y, text, color, size) {
  floatingTexts.push({
    x, y, text, color: color || C.textYellow,
    size: size || 12, life: 1.0, maxLife: 1.0,
    vy: -60,
  });
}

// ============================================================================
// 9. GAME STATE
// ============================================================================

const game = {
  state: 'title', // 'title', 'playing', 'paused', 'levelup', 'gameover', 'attract_demo', 'attract_scores'
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  time: 0,
  
  // Camera
  camX: 0, camY: 0,
  camTargetX: 0, camTargetY: 0,
  camZoom: 1.0,
  
  // Player
  player: {
    x: WORLD_W / 2, y: WORLD_H / 2,
    vx: 0, vy: 0,
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
    speed: PLAYER_SPEED,
    iframes: 0,
    fireCooldown: 0,
    alive: true,
    animFrame: 0,
    animTimer: 0,
    facing: 0, // angle
    // Leveling
    xp: 0, level: 1, xpToNext: 5,
    // Scoring
    score: 0,
    rescueCount: 0, // resets per wave
    totalRescues: 0,
    totalKills: 0,
    // Weapons & passives
    weapons: [], // { id, level }
    passives: [], // { id, level }
    // Upgrades from passives
    damageMulti: 1.0,
    speedMulti: 1.0,
    cooldownMulti: 1.0,
    pickupRadiusMulti: 1.0,
    projSpeedMulti: 1.0,
    durationMulti: 1.0,
    aoeMulti: 1.0,
    armorFlat: 0,
    regenPerSec: 0,
    xpMulti: 1.0,
    critChance: 0,
    maxHpMulti: 1.0,
  },
  
  // Wave
  wave: 0,
  waveTimer: 0,
  waveEnemiesRemaining: 0,
  waveEnemiesTotal: 0,
  waveSpawnBudget: 0,
  waveSpawnTimer: 0,
  waveAnnounce: 0,
  waveClearTimer: 0,
  betweenWaves: false,
  waveHumansStart: 0, // humans at wave start
  waveHumansLost: 0,  // humans killed this wave
  gameOverReason: '', // 'death' or 'humans_lost'
  humanDeathPopTimer: 0,
  humanDeathPopCount: 0,
  cycleSurvivorCount: 0, // tracks survivors across the 5-wave cycle
  
  // Enemies
  enemies: [],
  
  // Humans
  humans: [],
  
  // Projectiles
  playerBullets: new Pool(() => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, prevX: 0, prevY: 0, _type: 'laser',
  }), 500),
  
  enemyBullets: new Pool(() => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 10, type: 'spark',
    bounces: 0, maxBounces: 0,
  }), 100),
  
  // XP Gems
  gems: new Pool(() => ({
    active: false, x: 0, y: 0, value: 1, color: C.gemSmall, size: 4,
    magnetized: false,
  }), 500),
  
  // Spatial grids
  enemyGrid: new SpatialGrid(128),
  
  // High scores (in-memory for sandbox, localStorage on Droplet)
  highScores: [],
  
  // Attract mode cycle: title(60s) -> demo(30s) -> scores(30s) -> repeat
  attractPhase: 0, // 0=title, 1=demo, 2=scores
  attractTimer: 0,
  attractReturnTimer: 30, // gameover returns to attract after this
  attractScoreTab: 0, // 0=daily, 1=weekly, 2=alltime
  attractScoreTabTimer: 0,
  
  // Power score (adaptive difficulty)
  powerScore: 0,
  
  // Score milestones
  nextHpRestore: 25000,
  
  // Session high
  sessionHigh: 0,
  
  // Time tracking
  runTime: 0,
};

// ============================================================================
// 10. CAMERA SYSTEM
// ============================================================================

function updateCamera(dt) {
  const p = game.player;
  // Look-ahead: offset camera toward movement direction
  const lookAhead = 100;
  const tx = p.x + Input.moveX * lookAhead - game.width / (2 * game.camZoom);
  const ty = p.y + Input.moveY * lookAhead - game.height / (2 * game.camZoom);
  
  game.camX = lerp(game.camX, tx, 0.08);
  game.camY = lerp(game.camY, ty, 0.08);
  
  // Clamp to world bounds
  game.camX = clamp(game.camX, 0, WORLD_W - game.width / game.camZoom);
  game.camY = clamp(game.camY, 0, WORLD_H - game.height / game.camZoom);
}

// ============================================================================
// 11. PLAYER
// ============================================================================

function updatePlayer(dt) {
  const p = game.player;
  if (!p.alive) return;
  
  // Movement
  const spd = p.speed * p.speedMulti;
  p.x += Input.moveX * spd * dt;
  p.y += Input.moveY * spd * dt;
  
  // Clamp to world
  p.x = clamp(p.x, PLAYER_SIZE, WORLD_W - PLAYER_SIZE);
  p.y = clamp(p.y, PLAYER_SIZE, WORLD_H - PLAYER_SIZE);
  
  // Facing
  if (Math.abs(Input.aimX) > 0.01 || Math.abs(Input.aimY) > 0.01) {
    p.facing = Math.atan2(Input.aimY, Input.aimX);
  } else if (Math.abs(Input.moveX) > 0.01 || Math.abs(Input.moveY) > 0.01) {
    p.facing = Math.atan2(Input.moveY, Input.moveX);
  }
  
  // Animation
  p.animTimer += dt;
  if (Math.abs(Input.moveX) > 0.01 || Math.abs(Input.moveY) > 0.01) {
    if (p.animTimer > 0.15) { p.animFrame = (p.animFrame + 1) % 4; p.animTimer = 0; }
  } else {
    p.animFrame = 0;
  }
  
  // Invincibility frames
  if (p.iframes > 0) p.iframes -= dt;
  
  // HP regen from passives
  if (p.regenPerSec > 0) {
    p.hp = Math.min(p.hp + p.regenPerSec * dt, p.maxHp);
  }
  
  // Fire laser
  p.fireCooldown -= dt;
  if ((Math.abs(Input.aimX) > 0.01 || Math.abs(Input.aimY) > 0.01) && p.fireCooldown <= 0) {
    fireLaser(p.x, p.y, Input.aimX, Input.aimY);
    p.fireCooldown = LASER_COOLDOWN * p.cooldownMulti;
  }
  
  // Score milestone HP restore
  if (p.score >= game.nextHpRestore) {
    p.hp = Math.min(p.hp + 25, p.maxHp);
    spawnFloatingText(p.x, p.y - 20, '+25 HP', '#44ff44', 14);
    game.nextHpRestore += 25000;
  }
}

function fireLaser(x, y, aimX, aimY) {
  const b = game.playerBullets.get();
  if (!b) return;
  const a = Math.atan2(aimY, aimX);
  const spd = LASER_SPEED * game.player.projSpeedMulti;
  b.x = x; b.y = y;
  b.prevX = x; b.prevY = y;
  b.vx = Math.cos(a) * spd;
  b.vy = Math.sin(a) * spd;
  b.dmg = LASER_DAMAGE * game.player.damageMulti;
  b._type = 'laser';
  b._target = null;
  b._homingStr = 0;
  b._life = 0;
  SFX.playerLaser();
}

function damagePlayer(amount) {
  const p = game.player;
  if (p.iframes > 0 || !p.alive) return;
  const dmg = Math.max(1, amount - p.armorFlat);
  p.hp -= dmg;
  p.iframes = PLAYER_IFRAMES;
  emitParticles(p.x, p.y, 6, '#ff4444', 30, 120, 0.4, 2);
  SFX.playerDamage();
  // Screen shake
  game.shakeTimer = 0.2;
  game.shakeIntensity = 4;
  
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    game.gameOverReason = 'death';
    emitParticles(p.x, p.y, 30, C.player, 20, 200, 1.0, 4);
    emitParticles(p.x, p.y, 20, '#ffffff', 15, 150, 0.8, 3);
    SFX.gameOverDramatic();
    game.shakeTimer = 0.4;
    game.shakeIntensity = 8;
    setTimeout(() => { triggerGameEnd(); }, 1500);
  }
}

function triggerGameEnd() {
  // Check if score qualifies for any leaderboard
  const qualifies = checkScoreQualifies(game.player.score);
  if (qualifies) {
    startHighScoreEntry();
  } else {
    if (game.player.score > game.sessionHigh) game.sessionHigh = game.player.score;
    game.state = 'gameover';
    game.attractReturnTimer = 30; // return to attract after 30s idle
  }
}

function checkScoreQualifies(score) {
  if (score <= 0) return false;
  // Always qualifies if fewer than 10 all-time scores
  if (game.highScores.length < 10) return true;
  // Qualifies if better than the worst all-time score
  const worst = game.highScores[game.highScores.length - 1];
  if (score > worst.score) return true;
  // Also qualifies for daily/weekly if it would make those top 10
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); weekStart.setHours(0,0,0,0);
  const dailyScores = game.highScores.filter(s => s.timestamp >= todayStart.getTime()).sort((a,b) => b.score - a.score);
  const weeklyScores = game.highScores.filter(s => s.timestamp >= weekStart.getTime()).sort((a,b) => b.score - a.score);
  if (dailyScores.length < 10 || score > dailyScores[dailyScores.length - 1].score) return true;
  if (weeklyScores.length < 10 || score > weeklyScores[weeklyScores.length - 1].score) return true;
  return false;
}

function drawPlayer(ctx) {
  const p = game.player;
  if (!p.alive) return;
  
  ctx.save();
  ctx.translate(p.x, p.y);
  
  // === ALWAYS-VISIBLE GLOW AURA (drawn even during iframes) ===
  // Pulsing cyan ring that's visible in the densest chaos
  const glowPulse = 0.35 + Math.sin(game.time * 5) * 0.15;
  const glowSize = PLAYER_SIZE * 2.5 + Math.sin(game.time * 3) * 4;
  // Outer glow ring
  ctx.strokeStyle = C.player;
  ctx.lineWidth = 2;
  ctx.globalAlpha = glowPulse * 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, glowSize, 0, Math.PI * 2);
  ctx.stroke();
  // Inner bright circle
  ctx.fillStyle = C.player;
  ctx.globalAlpha = glowPulse * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, glowSize * 0.7, 0, Math.PI * 2);
  ctx.fill();
  // Directional indicator line extending from glow ring
  ctx.strokeStyle = C.laserGlow;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(Math.cos(p.facing) * PLAYER_SIZE, Math.sin(p.facing) * PLAYER_SIZE);
  ctx.lineTo(Math.cos(p.facing) * glowSize, Math.sin(p.facing) * glowSize);
  ctx.stroke();
  ctx.globalAlpha = 1;
  
  // Invincibility flicker (skip drawing the sprite but glow stays)
  if (p.iframes > 0 && Math.floor(p.iframes * 10) % 2 === 0) {
    ctx.restore();
    return;
  }
  
  // Character sprite
  const s = PLAYER_SIZE;
  
  // Body
  ctx.fillStyle = C.player;
  ctx.fillRect(-s * 0.4, -s * 0.6, s * 0.8, s * 0.8);
  
  // Head
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-s * 0.3, -s * 1.0, s * 0.6, s * 0.45);
  
  // Eyes
  ctx.fillStyle = '#000';
  ctx.fillRect(-s * 0.15, -s * 0.85, s * 0.1, s * 0.1);
  ctx.fillRect(s * 0.05, -s * 0.85, s * 0.1, s * 0.1);
  
  // Legs (animated)
  const legOffset = Math.sin(p.animFrame * Math.PI / 2) * s * 0.2;
  ctx.fillStyle = C.playerDark;
  ctx.fillRect(-s * 0.35, s * 0.2, s * 0.3, s * 0.5 + legOffset);
  ctx.fillRect(s * 0.05, s * 0.2, s * 0.3, s * 0.5 - legOffset);
  
  ctx.restore();
}

// ============================================================================
// 12. ENEMIES
// ============================================================================

function createEnemy(type, x, y) {
  const e = {
    type, x, y, vx: 0, vy: 0,
    hp: 1, maxHp: 1, speed: 80,
    size: 10, color: C.grunt,
    active: true, alive: true,
    points: 100, gemType: 'small',
    animTimer: 0, animFrame: 0,
    spawnTimer: 0, // for materialization
    special: {}, // type-specific data
  };
  
  switch (type) {
    case 'grunt':
      e.hp = 1; e.speed = 80 + randF(-10, 10);
      e.size = 16; e.color = C.grunt;
      e.points = 100; e.gemType = 'small';
      break;
    case 'hulk':
      e.hp = 9999; e.maxHp = 9999; e.speed = 40;
      e.size = 28; e.color = C.hulk;
      e.points = 0; e.gemType = 'none';
      e.special.invincible = true;
      break;
    case 'electrode':
      e.hp = 1; e.speed = 0;
      e.size = 12; e.color = C.electrode;
      e.points = 25; e.gemType = 'small';
      e.special.static = true;
      e.special.colorTimer = 0;
      break;
    case 'spheroid':
      e.hp = 2; e.speed = 60;
      e.size = 20; e.color = C.spheroid;
      e.points = 1000; e.gemType = 'large';
      e.special.spawnTimer = randF(3, 6);
      e.special.pulseTimer = 0;
      break;
    case 'enforcer':
      e.hp = 1; e.speed = 100;
      e.size = 14; e.color = C.enforcer;
      e.points = 150; e.gemType = 'small';
      e.special.fireTimer = randF(1, 3);
      e.special.jitterX = 0; e.special.jitterY = 0;
      break;
    case 'quark':
      e.hp = 2; e.speed = 70;
      e.size = 18; e.color = C.quark;
      e.points = 1000; e.gemType = 'large';
      e.special.spawnTimer = randF(3, 6);
      e.special.spinAngle = 0;
      break;
    case 'tank':
      e.hp = 2; e.speed = 50;
      e.size = 22; e.color = C.tank;
      e.points = 200; e.gemType = 'med';
      e.special.fireTimer = randF(2, 4);
      e.special.turretAngle = 0;
      break;
    case 'brain':
      e.hp = 3; e.speed = 65;
      e.size = 20; e.color = C.brain;
      e.points = 500; e.gemType = 'large';
      e.special.fireTimer = randF(2, 4);
      e.special.shimmerTimer = 0;
      e.special.targetHuman = null;
      break;
    case 'prog':
      e.hp = 1; e.speed = 110;
      e.size = 10; e.color = C.prog;
      e.points = 100; e.gemType = 'small';
      e.special.glitchTimer = 0;
      break;
  }
  
  e.spawnTimer = 0.6; // materialization time
  return e;
}

function spawnEnemyAtEdge(type) {
  const p = game.player;
  // Spawn just off the visible screen edge
  const margin = 100;
  let x, y;
  const side = randI(0, 3);
  const camL = game.camX - margin;
  const camR = game.camX + game.width / game.camZoom + margin;
  const camT = game.camY - margin;
  const camB = game.camY + game.height / game.camZoom + margin;
  
  switch (side) {
    case 0: x = randF(camL, camR); y = camT; break; // top
    case 1: x = randF(camL, camR); y = camB; break; // bottom
    case 2: x = camL; y = randF(camT, camB); break; // left
    case 3: x = camR; y = randF(camT, camB); break; // right
  }
  
  x = clamp(x, 50, WORLD_W - 50);
  y = clamp(y, 50, WORLD_H - 50);
  
  const e = createEnemy(type, x, y);
  game.enemies.push(e);
  return e;
}

function spawnEnemyRandom(type) {
  const x = randF(100, WORLD_W - 100);
  const y = randF(100, WORLD_H - 100);
  // Don't spawn too close to player
  if (dist(x, y, game.player.x, game.player.y) < 300) {
    return spawnEnemyAtEdge(type);
  }
  const e = createEnemy(type, x, y);
  game.enemies.push(e);
  return e;
}

function updateEnemies(dt) {
  const p = game.player;
  
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    if (!e.active) { game.enemies.splice(i, 1); continue; }
    
    // Materialization
    if (e.spawnTimer > 0) {
      e.spawnTimer -= dt;
      continue; // Can't act or be hit during materialization
    }
    
    e.animTimer += dt;
    
    // Type-specific AI
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    
    switch (e.type) {
      case 'grunt': {
        // Grunts: relentless direct chase toward player, slight weaving
        // They also trample humans on contact (like Robotron)
        e.special._weaveT = (e.special._weaveT || 0) + dt;
        const weave = Math.sin(e.special._weaveT * 3 + e.x * 0.01) * 15;
        if (d > 0) {
          const perpX = -dy / d, perpY = dx / d;
          e.vx = (dx / d) * e.speed + perpX * weave;
          e.vy = (dy / d) * e.speed + perpY * weave;
        }
        // Speed up when closer to player (Robotron urgency)
        if (d < 200) {
          e.vx *= 1.3;
          e.vy *= 1.3;
        }
        break;
      }
      case 'hulk': {
        // Hulk: lumbering, ALWAYS hunts nearest human first (primary threat to humans)
        // Only chases player if no humans nearby
        let tx = p.x, ty = p.y;
        let nearestHumanDist = Infinity;
        for (const h of game.humans) {
          const hd = dist(e.x, e.y, h.x, h.y);
          if (hd < nearestHumanDist) { nearestHumanDist = hd; tx = h.x; ty = h.y; }
        }
        // Hulks always prefer humans within 600px, otherwise drift toward player
        if (nearestHumanDist > 600) { tx = p.x; ty = p.y; }
        const hdx = tx - e.x, hdy = ty - e.y;
        const hd2 = Math.hypot(hdx, hdy);
        if (hd2 > 0) {
          e.vx = (hdx / hd2) * e.speed;
          e.vy = (hdy / hd2) * e.speed;
        }
        // Pulsing movement: slow/fast cycle for menacing feel
        const hulkPulse = 0.7 + Math.sin(game.time * 1.5 + e.x * 0.005) * 0.3;
        e.vx *= hulkPulse;
        e.vy *= hulkPulse;
        break;
      }
      case 'electrode': {
        // Static hazard — no movement, just visual pulsing
        e.special.colorTimer += dt;
        e.vx = 0; e.vy = 0;
        break;
      }
      case 'spheroid': {
        // Spheroid: floats in lazy figure-8 / sine patterns, not random
        // This gives them the distinctive drifting feel from Robotron
        e.special.pulseTimer += dt;
        e.special._pathT = (e.special._pathT || randF(0, 100)) + dt;
        const pt = e.special._pathT;
        e.vx = Math.sin(pt * 0.8) * e.speed * 0.9;
        e.vy = Math.cos(pt * 1.1) * e.speed * 0.7;
        // Drift toward player slowly
        if (d > 0) { e.vx += (dx / d) * 12; e.vy += (dy / d) * 12; }
        // Spawn enforcers — pulse larger before spawning
        e.special.spawnTimer -= dt;
        if (e.special.spawnTimer <= 0) {
          const enf = createEnemy('enforcer', e.x + randF(-30, 30), e.y + randF(-30, 30));
          enf.spawnTimer = 0.3;
          game.enemies.push(enf);
          e.special.spawnTimer = randF(3, 6);
          game.waveEnemiesTotal++;
          emitParticles(e.x, e.y, 4, C.spheroid, 10, 60, 0.3, 3);
          SFX.spheroidSpawn();
        }
        break;
      }
      case 'enforcer': {
        // Enforcer: erratic strafing movement, jitters, fires sparks at player
        // Diagonal preference like in Robotron — they don't chase directly
        e.special.jitterX += randF(-800, 800) * dt;
        e.special.jitterY += randF(-800, 800) * dt;
        e.special.jitterX *= 0.92;
        e.special.jitterY *= 0.92;
        // Strafe around player at medium distance rather than direct chase
        const perpX = -dy / (d || 1), perpY = dx / (d || 1);
        const strafeDir = Math.sin(e.animTimer * 2 + e.y * 0.01) > 0 ? 1 : -1;
        e.vx = perpX * e.speed * 0.6 * strafeDir + (dx / (d || 1)) * e.speed * 0.25 + e.special.jitterX;
        e.vy = perpY * e.speed * 0.6 * strafeDir + (dy / (d || 1)) * e.speed * 0.25 + e.special.jitterY;
        // Fire sparks — more aggressive
        e.special.fireTimer -= dt;
        if (e.special.fireTimer <= 0 && d < 500) {
          fireEnemyBullet(e.x, e.y, p.x, p.y, 320, 10, 'spark');
          e.special.fireTimer = randF(0.8, 2.0);
          emitParticles(e.x, e.y, 2, C.enforcerSpark, 5, 40, 0.15, 2);
          SFX.enforcerFire();
        }
        break;
      }
      case 'quark': {
        // Quark: chaotic spiraling movement — fast, unpredictable, hard to hit
        // Distinctive swirling pattern that's very different from straight-line enemies
        e.special.spinAngle += dt * (3 + Math.sin(game.time + e.x) * 2);
        const spiralR = 40 + Math.sin(e.special.spinAngle * 0.5) * 30;
        e.vx = Math.cos(e.special.spinAngle) * e.speed * 1.2 + (dx / (d || 1)) * 25;
        e.vy = Math.sin(e.special.spinAngle) * e.speed * 1.2 + (dy / (d || 1)) * 25;
        // Sudden direction reversals (makes them hard to predict)
        if (Math.random() < 0.005) { e.vx *= -1; e.vy *= -1; }
        // Spawn tanks — shudder before spawning
        e.special.spawnTimer -= dt;
        if (e.special.spawnTimer <= 0) {
          const t = createEnemy('tank', e.x + randF(-40, 40), e.y + randF(-40, 40));
          t.spawnTimer = 0.5;
          game.enemies.push(t);
          e.special.spawnTimer = randF(4, 7);
          game.waveEnemiesTotal++;
          emitParticles(e.x, e.y, 5, C.quark, 12, 80, 0.3, 3);
          SFX.quarkSpawn();
        }
        break;
      }
      case 'tank': {
        // Tank: slow, deliberate, stops to aim before firing
        // Turret tracks player smoothly — visible aiming behavior
        const targetAngle = Math.atan2(dy, dx);
        // Smooth turret rotation
        let angleDiff = targetAngle - e.special.turretAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        e.special.turretAngle += angleDiff * 2.5 * dt;
        // Move toward player but stop at medium range to fire
        if (d > 250) {
          e.vx = (dx / d) * e.speed;
          e.vy = (dy / d) * e.speed;
        } else if (d < 150) {
          // Back away slightly if too close
          e.vx = -(dx / d) * e.speed * 0.5;
          e.vy = -(dy / d) * e.speed * 0.5;
        } else {
          // Hold position, strafe slightly
          const tp = -dy / d, tq = dx / d;
          e.vx = tp * e.speed * 0.3 * Math.sin(game.time + e.x);
          e.vy = tq * e.speed * 0.3 * Math.sin(game.time + e.x);
        }
        // Fire bouncing shells
        e.special.fireTimer -= dt;
        if (e.special.fireTimer <= 0 && d < 600) {
          const b = fireEnemyBullet(e.x, e.y, 
            e.x + Math.cos(e.special.turretAngle) * 100,
            e.y + Math.sin(e.special.turretAngle) * 100, 280, 12, 'shell');
          if (b) { b.maxBounces = 2; b.bounces = 0; }
          e.special.fireTimer = randF(1.8, 3.5);
          SFX.tankFire();
          // Recoil
          e.vx -= Math.cos(e.special.turretAngle) * 30;
          e.vy -= Math.sin(e.special.turretAngle) * 30;
          emitParticles(e.x + Math.cos(e.special.turretAngle) * e.size, 
            e.y + Math.sin(e.special.turretAngle) * e.size, 3, '#ffff44', 8, 60, 0.15, 2);
        }
        break;
      }
      case 'brain': {
        // Brain: the most dangerous — actively hunts humans to convert them to Progs
        // When no humans nearby, chases player and fires cruise missiles
        e.special.shimmerTimer += dt;
        let target = null;
        let nearDist = Infinity;
        for (const h of game.humans) {
          const bd = dist(e.x, e.y, h.x, h.y);
          if (bd < nearDist) { nearDist = bd; target = h; }
        }
        if (target && nearDist < 800) {
          // Beeline for human — faster than normal when hunting
          const bdx = target.x - e.x, bdy = target.y - e.y;
          const bd = Math.hypot(bdx, bdy);
          e.vx = (bdx / bd) * e.speed * 1.3;
          e.vy = (bdy / bd) * e.speed * 1.3;
          // Capture human on contact — convert to Prog!
          if (nearDist < e.size + (target.size || 20)) {
            convertHumanToProg(target);
            SFX.brainCapture();
            // Brief pause after capture
            e.vx *= 0.1; e.vy *= 0.1;
          }
        } else {
          // Chase player with slight wobble
          if (d > 0) {
            const wobble = Math.sin(e.special.shimmerTimer * 3) * 20;
            e.vx = (dx / d) * e.speed + (-dy / d) * wobble;
            e.vy = (dy / d) * e.speed + (dx / d) * wobble;
          }
        }
        // Fire cruise missiles — more aggressively
        e.special.fireTimer -= dt;
        if (e.special.fireTimer <= 0 && d < 700) {
          fireEnemyBullet(e.x, e.y, p.x, p.y, 200, 15, 'cruise');
          e.special.fireTimer = randF(2, 4);
          emitParticles(e.x, e.y, 3, '#ff4466', 8, 50, 0.2, 2);
          SFX.brainMissileLaunch();
        }
        break;
      }
      case 'prog': {
        // Prog: reprogrammed human — faster than grunts, very aggressive
        // Zigzags toward player with glitchy movement
        e.special.glitchTimer += dt;
        if (d > 0) {
          const zigzag = Math.sin(e.special.glitchTimer * 8) * 40;
          const perpX2 = -dy / d, perpY2 = dx / d;
          e.vx = (dx / d) * e.speed + perpX2 * zigzag;
          e.vy = (dy / d) * e.speed + perpY2 * zigzag;
        }
        // Occasional glitch teleport (short hop, 2-3px)
        if (Math.random() < 0.02) { e.x += randF(-8, 8); e.y += randF(-8, 8); }
        break;
      }
    }
    
    // Apply velocity
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    
    // Clamp to world
    e.x = clamp(e.x, e.size, WORLD_W - e.size);
    e.y = clamp(e.y, e.size, WORLD_H - e.size);
    
    // Contact damage to player
    if (p.alive && e.spawnTimer <= 0) {
      const contactDist = e.size + PLAYER_SIZE;
      if (dist(e.x, e.y, p.x, p.y) < contactDist) {
        if (e.special.static) {
          damagePlayer(30); // Electrodes: big damage
        } else if (e.special.invincible) {
          damagePlayer(15); // Hulk
        } else {
          damagePlayer(10);
        }
      }
    }
    
    // ALL enemies kill humans on contact (not just Hulks)
    // Grunts trample, Hulks crush, Enforcers/Tanks/Progs collide
    // Only Brains convert (handled above), Electrodes are static
    if (e.type !== 'brain' && e.type !== 'electrode' && e.spawnTimer <= 0) {
      for (let j = game.humans.length - 1; j >= 0; j--) {
        const h = game.humans[j];
        if (dist(e.x, e.y, h.x, h.y) < e.size + h.size) {
          killHuman(h, j);
        }
      }
    }
  }
}

function killEnemy(e, index) {
  if (!e.alive) return;
  e.alive = false;
  e.active = false;
  
  // Particles
  emitParticles(e.x, e.y, 10, e.color, 15, 150, 0.5, 3);
  
  // Score
  game.player.score += e.points;
  game.player.totalKills++;
  if (e.points > 0) spawnFloatingText(e.x, e.y, `${e.points}`, C.textWhite, 10);
  
  // Drop XP gem
  if (e.gemType !== 'none') {
    const g = game.gems.get();
    if (g) {
      g.x = e.x; g.y = e.y;
      g.magnetized = false;
      switch (e.gemType) {
        case 'small': g.value = GEM_SMALL; g.color = C.gemSmall; g.size = 4; break;
        case 'med': g.value = GEM_MED; g.color = C.gemMed; g.size = 5; break;
        case 'large': g.value = GEM_LARGE; g.color = C.gemLarge; g.size = 6; break;
        case 'gold': g.value = GEM_GOLD; g.color = C.gemGold; g.size = 7; break;
      }
    }
  }
  
  // Type-specific death sound
  switch (e.type) {
    case 'grunt': SFX.gruntDeath(); break;
    case 'spheroid': SFX.spheroidPop(); break;
    case 'enforcer': SFX.enforcerShatter(); break;
    case 'quark': SFX.quarkExplode(); break;
    case 'tank': SFX.tankDestroy(); break;
    case 'brain': SFX.brainDeath(); break;
    case 'prog': SFX.progDeath(); break;
    case 'electrode': SFX.electrodeFry(); break;
    default: SFX.robotExplode();
  }
  game.waveEnemiesRemaining--;
}

function damageEnemy(e, dmg) {
  if (e.spawnTimer > 0) return; // Can't damage during materialization
  if (e.special.invincible) {
    // Hulk knockback
    const dx = e.x - game.player.x;
    const dy = e.y - game.player.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      e.x += (dx / d) * 8;
      e.y += (dy / d) * 8;
    }
    emitParticles(e.x, e.y, 3, '#ffffff', 10, 80, 0.2, 2);
    SFX.hulkThud();
    return;
  }
  e.hp -= dmg;
  // Flash white briefly
  e.special._flashTimer = 0.05;
  if (e.hp <= 0) {
    const idx = game.enemies.indexOf(e);
    if (idx >= 0) killEnemy(e, idx);
  }
}

function fireEnemyBullet(fromX, fromY, toX, toY, speed, dmg, type) {
  const b = game.enemyBullets.get();
  if (!b) return null;
  const a = Math.atan2(toY - fromY, toX - fromX);
  b.x = fromX; b.y = fromY;
  b.vx = Math.cos(a) * speed;
  b.vy = Math.sin(a) * speed;
  b.dmg = dmg;
  b.type = type;
  b.bounces = 0;
  b.maxBounces = 0;
  return b;
}

function drawEnemies(ctx) {
  for (const e of game.enemies) {
    if (!e.active) continue;
    
    ctx.save();
    ctx.translate(e.x, e.y);
    
    // Materialization effect
    if (e.spawnTimer > 0) {
      const prog = 1 - (e.spawnTimer / 0.6);
      ctx.globalAlpha = prog * 0.7;
      for (let i = 0; i < 10; i++) {
        const a2 = (i / 10) * Math.PI * 2 + game.time * 5;
        const d2 = e.size * (1 - prog) * 2.5;
        ctx.fillStyle = e.color;
        ctx.fillRect(Math.cos(a2) * d2 - 2, Math.sin(a2) * d2 - 2, 4, 4);
      }
      ctx.restore();
      continue;
    }
    
    const flash = e.special._flashTimer > 0;
    if (flash) e.special._flashTimer -= 1/60;
    const s = e.size;
    
    switch (e.type) {
      case 'grunt': {
        // GRUNT: Humanoid robot foot soldier — box head, antenna, legs
        const col = flash ? '#ffffff' : C.grunt;
        const dark = flash ? '#cccccc' : C.gruntDark;
        const leg = Math.sin(e.animTimer * 8) * s * 0.15;
        // Legs
        ctx.fillStyle = dark;
        ctx.fillRect(-s * 0.35, s * 0.1, s * 0.25, s * 0.5 + leg);
        ctx.fillRect(s * 0.1, s * 0.1, s * 0.25, s * 0.5 - leg);
        // Body (torso)
        ctx.fillStyle = col;
        ctx.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.6);
        // Chest detail
        ctx.fillStyle = dark;
        ctx.fillRect(-s * 0.15, -s * 0.25, s * 0.3, s * 0.2);
        // Head (box with visor)
        ctx.fillStyle = col;
        ctx.fillRect(-s * 0.3, -s * 0.75, s * 0.6, s * 0.38);
        // Visor (eyes)
        ctx.fillStyle = '#000000';
        ctx.fillRect(-s * 0.22, -s * 0.65, s * 0.44, s * 0.12);
        ctx.fillStyle = '#ff4466';
        ctx.fillRect(-s * 0.18, -s * 0.63, s * 0.14, s * 0.08);
        ctx.fillRect(s * 0.06, -s * 0.63, s * 0.14, s * 0.08);
        // Antenna
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.75);
        ctx.lineTo(0, -s * 0.95);
        ctx.stroke();
        ctx.fillStyle = '#ff4466';
        ctx.beginPath();
        ctx.arc(0, -s * 0.97, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'hulk': {
        // HULK: Massive armored robot — wide body, thick arms, glowing core
        const col = flash ? '#ffffff' : C.hulk;
        const pulse = 1 + Math.sin(game.time * 2) * 0.03;
        ctx.scale(pulse, pulse);
        // Legs (thick)
        ctx.fillStyle = '#116622';
        ctx.fillRect(-s * 0.4, s * 0.2, s * 0.3, s * 0.45);
        ctx.fillRect(s * 0.1, s * 0.2, s * 0.3, s * 0.45);
        // Body (wide armored torso)
        ctx.fillStyle = col;
        ctx.fillRect(-s * 0.55, -s * 0.45, s * 1.1, s * 0.75);
        // Armor plating lines
        ctx.strokeStyle = '#44ff66';
        ctx.lineWidth = 1;
        ctx.strokeRect(-s * 0.5, -s * 0.4, s * 1.0, s * 0.65);
        // Arms (heavy, hang down)
        ctx.fillStyle = C.hulkArm;
        ctx.fillRect(-s * 0.75, -s * 0.2, s * 0.22, s * 0.6);
        ctx.fillRect(s * 0.53, -s * 0.2, s * 0.22, s * 0.6);
        // Fists
        ctx.fillStyle = '#dddd22';
        ctx.fillRect(-s * 0.78, s * 0.35, s * 0.28, s * 0.15);
        ctx.fillRect(s * 0.5, s * 0.35, s * 0.28, s * 0.15);
        // Head (small on big body)
        ctx.fillStyle = col;
        ctx.fillRect(-s * 0.25, -s * 0.7, s * 0.5, s * 0.3);
        // Eyes (angry slits)
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(-s * 0.18, -s * 0.6, s * 0.12, s * 0.06);
        ctx.fillRect(s * 0.06, -s * 0.6, s * 0.12, s * 0.06);
        // Glowing core
        ctx.fillStyle = '#88ff88';
        ctx.globalAlpha = 0.5 + Math.sin(game.time * 3) * 0.3;
        ctx.beginPath();
        ctx.arc(0, -s * 0.1, s * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'electrode': {
        // ELECTRODE: Crackling energy hazard — spiky, pulsing
        const t = e.special.colorTimer;
        const ep = 1 + Math.sin(t * 8) * 0.15;
        ctx.scale(ep, ep);
        // Spiky cross shape
        const col1 = Math.floor(t * 4) % 2 === 0 ? C.electrode : C.electrodePulse;
        const col2 = Math.floor(t * 4) % 2 === 0 ? C.electrodePulse : C.electrode;
        ctx.fillStyle = col1;
        ctx.fillRect(-s * 0.2, -s, s * 0.4, s * 2); // vertical bar
        ctx.fillRect(-s, -s * 0.2, s * 2, s * 0.4); // horizontal bar
        // Diagonal spikes
        ctx.fillStyle = col2;
        ctx.save();
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-s * 0.15, -s * 0.7, s * 0.3, s * 1.4);
        ctx.fillRect(-s * 0.7, -s * 0.15, s * 1.4, s * 0.3);
        ctx.restore();
        // Center glow
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.6 + Math.sin(t * 10) * 0.4;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'spheroid': {
        // SPHEROID: Floating drone — sphere with ring, pulsating
        const col = flash ? '#ffffff' : C.spheroid;
        const sp = 0.85 + Math.sin(e.special.pulseTimer * 3) * 0.3;
        ctx.scale(sp, sp);
        // Outer ring
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 1.1, s * 0.4, game.time * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        // Body sphere
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
        ctx.fill();
        // Inner light
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.4 + Math.sin(e.special.pulseTimer * 3) * 0.3;
        ctx.beginPath();
        ctx.arc(-s * 0.15, -s * 0.15, s * 0.25, 0, Math.PI * 2);
        ctx.fill();
        // Eye
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#001144';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4488ff';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.1, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'enforcer': {
        // ENFORCER: Small attack drone — angular, with gun barrel
        const col = flash ? '#ffffff' : C.enforcer;
        ctx.rotate(e.animTimer * 1.5);
        // Angular body
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.9);
        ctx.lineTo(s * 0.7, -s * 0.1);
        ctx.lineTo(s * 0.4, s * 0.7);
        ctx.lineTo(-s * 0.4, s * 0.7);
        ctx.lineTo(-s * 0.7, -s * 0.1);
        ctx.closePath();
        ctx.fill();
        // Inner detail
        ctx.fillStyle = '#005566';
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.5);
        ctx.lineTo(s * 0.3, s * 0.1);
        ctx.lineTo(-s * 0.3, s * 0.1);
        ctx.closePath();
        ctx.fill();
        // Gun port
        ctx.fillStyle = '#ff6622';
        ctx.beginPath();
        ctx.arc(0, s * 0.4, s * 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'quark': {
        // QUARK: Chaotic energy entity — spinning triangles, color-shifting
        const qcolors = ['#ff4400', '#ff8800', '#ffcc00'];
        const ci = Math.floor(game.time * 6) % 3;
        ctx.rotate(e.special.spinAngle);
        // Outer triangle
        ctx.fillStyle = flash ? '#ffffff' : qcolors[ci];
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s * 0.87, s * 0.5); ctx.lineTo(-s * 0.87, s * 0.5);
        ctx.closePath(); ctx.fill();
        // Inner inverted triangle
        ctx.fillStyle = qcolors[(ci + 1) % 3];
        ctx.beginPath();
        ctx.moveTo(0, s * 0.5); ctx.lineTo(s * 0.43, -s * 0.25); ctx.lineTo(-s * 0.43, -s * 0.25);
        ctx.closePath(); ctx.fill();
        // Center energy core
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.6 + Math.sin(game.time * 8) * 0.4;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'tank': {
        // TANK: Heavy treaded robot — rectangular body, visible turret, treads
        const col = flash ? '#ffffff' : C.tank;
        // Treads
        ctx.fillStyle = '#113311';
        ctx.fillRect(-s * 0.7, -s * 0.35, s * 0.18, s * 0.7);
        ctx.fillRect(s * 0.52, -s * 0.35, s * 0.18, s * 0.7);
        // Tread detail lines
        ctx.strokeStyle = '#224422';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const ty = -s * 0.3 + i * s * 0.18;
          ctx.beginPath();
          ctx.moveTo(-s * 0.7, ty); ctx.lineTo(-s * 0.52, ty);
          ctx.moveTo(s * 0.52, ty); ctx.lineTo(s * 0.7, ty);
          ctx.stroke();
        }
        // Body
        ctx.fillStyle = col;
        ctx.fillRect(-s * 0.5, -s * 0.3, s * 1.0, s * 0.6);
        // Armor lines
        ctx.strokeStyle = '#44cc44';
        ctx.lineWidth = 1;
        ctx.strokeRect(-s * 0.45, -s * 0.25, s * 0.9, s * 0.5);
        // Turret base
        ctx.fillStyle = '#336633';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
        ctx.fill();
        // Turret barrel
        ctx.strokeStyle = '#44ff44';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(e.special.turretAngle) * s * 0.8, Math.sin(e.special.turretAngle) * s * 0.8);
        ctx.stroke();
        // Muzzle
        ctx.fillStyle = '#88ff88';
        ctx.beginPath();
        ctx.arc(Math.cos(e.special.turretAngle) * s * 0.8, Math.sin(e.special.turretAngle) * s * 0.8, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'brain': {
        // BRAIN: kept from previous overhaul (Robotron-style brain with folds)
        const wobble = Math.sin(e.special.shimmerTimer * 4) * 2;
        const t = e.special.shimmerTimer;
        ctx.fillStyle = flash ? '#ffffff' : C.brain;
        ctx.beginPath();
        ctx.ellipse(-s * 0.25, -s * 0.1 + wobble, s * 0.55, s * 0.7, -0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(s * 0.25, -s * 0.1 - wobble * 0.5, s * 0.55, s * 0.65, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#aa33aa';
        ctx.beginPath();
        ctx.ellipse(0, s * 0.4, s * 0.35, s * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#662266';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.8 + wobble);
        ctx.quadraticCurveTo(wobble * 0.5, 0, 0, s * 0.3);
        ctx.stroke();
        ctx.strokeStyle = '#dd88dd';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(-s*0.6,-s*0.2); ctx.quadraticCurveTo(-s*0.3,-s*0.5,-s*0.1,-s*0.15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s*0.5,s*0.1); ctx.quadraticCurveTo(-s*0.2,-s*0.1,-s*0.1,s*0.15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s*0.6,-s*0.15); ctx.quadraticCurveTo(s*0.3,-s*0.45,s*0.1,-s*0.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s*0.5,s*0.15); ctx.quadraticCurveTo(s*0.2,-s*0.05,s*0.1,s*0.2); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffccff';
        ctx.globalAlpha = 0.2 + Math.sin(t * 6) * 0.2;
        ctx.beginPath();
        ctx.ellipse(Math.sin(t*3)*s*0.3, -s*0.2, s*0.2, s*0.15, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff0044';
        ctx.fillRect(-s*0.2, s*0.25, s*0.12, s*0.08);
        ctx.fillRect(s*0.08, s*0.25, s*0.12, s*0.08);
        break;
      }
      case 'prog': {
        // PROG: Corrupted human — distorted humanoid with glitch effect
        const glitch = Math.sin(e.special.glitchTimer * 15) > 0.7 ? randF(-4, 4) : 0;
        ctx.translate(glitch, 0);
        const pCol = Math.floor(e.special.glitchTimer * 8) % 2 === 0 ? C.prog : '#ff4444';
        // Body (human-like but wrong)
        ctx.fillStyle = pCol;
        ctx.fillRect(-s * 0.35, -s * 0.5, s * 0.7, s * 0.8);
        // Head (tilted/glitchy)
        ctx.fillStyle = '#660000';
        const headTilt = Math.sin(e.special.glitchTimer * 6) * 0.2;
        ctx.save();
        ctx.rotate(headTilt);
        ctx.fillRect(-s * 0.25, -s * 0.85, s * 0.5, s * 0.38);
        // Glowing red eyes
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(-s * 0.15, -s * 0.75, s * 0.1, s * 0.06);
        ctx.fillRect(s * 0.05, -s * 0.75, s * 0.1, s * 0.06);
        ctx.restore();
        // Legs (jerky)
        ctx.fillStyle = '#441111';
        const pLeg = Math.sin(e.special.glitchTimer * 12) * s * 0.15;
        ctx.fillRect(-s * 0.3, s * 0.3, s * 0.22, s * 0.35 + pLeg);
        ctx.fillRect(s * 0.08, s * 0.3, s * 0.22, s * 0.35 - pLeg);
        // Glitch scanlines
        if (Math.random() < 0.3) {
          ctx.fillStyle = '#ff000044';
          ctx.fillRect(-s * 0.5, randF(-s, s) * 0.8, s, 2);
        }
        break;
      }
    }
    
    ctx.restore();
  }
}

// ============================================================================
// 13. HUMANS
// ============================================================================

function spawnHumans(count) {
  const types = ['mommy', 'daddy', 'mikey'];
  const colors = { mommy: C.mommy, daddy: C.daddy, mikey: C.mikey };
  const sizes = { mommy: 24, daddy: 28, mikey: 20 }; // 3x original — must be visible
  const speeds = { mommy: 60, daddy: 55, mikey: 80 }; // Mikey is fastest (small child running)
  
  for (let i = 0; i < count; i++) {
    const type = types[randI(0, 2)];
    const x = randF(200, WORLD_W - 200);
    const y = randF(200, WORLD_H - 200);
    if (dist(x, y, game.player.x, game.player.y) < 200) continue;
    game.humans.push({
      type, x, y, vx: 0, vy: 0,
      color: colors[type], size: sizes[type],
      speed: speeds[type],
      wanderTimer: 0, alive: true,
      // Robotron-style movement state
      moveAngle: randF(0, Math.PI * 2), // current wander direction
      panicTimer: 0,   // > 0 = fleeing from nearby enemy
      panicDirX: 0, panicDirY: 0,
      animTimer: 0,
      animFrame: 0,
    });
  }
}

function updateHumans(dt) {
  const p = game.player;
  for (let i = game.humans.length - 1; i >= 0; i--) {
    const h = game.humans[i];
    if (!h.alive) { game.humans.splice(i, 1); continue; }
    
    h.animTimer += dt;
    
    // ---- Robotron-style panicked wandering ----
    // Humans wander aimlessly, but PANIC when an enemy is nearby
    // They run in short bursts, change direction suddenly, bump off walls
    // This creates the frantic, helpless feel from the original
    
    // Check for nearby enemies -> panic flee
    h.panicTimer -= dt;
    let nearestEnemyDist = Infinity;
    let nearestEnemyX = 0, nearestEnemyY = 0;
    for (const e of game.enemies) {
      if (!e.active || e.spawnTimer > 0 || e.type === 'electrode') continue;
      const ed = dist(h.x, h.y, e.x, e.y);
      if (ed < nearestEnemyDist) {
        nearestEnemyDist = ed;
        nearestEnemyX = e.x;
        nearestEnemyY = e.y;
      }
    }
    
    const panicRange = 120;
    if (nearestEnemyDist < panicRange) {
      // PANIC! Flee away from enemy
      const fleeX = h.x - nearestEnemyX;
      const fleeY = h.y - nearestEnemyY;
      const fleeDist = Math.hypot(fleeX, fleeY);
      if (fleeDist > 0) {
        h.panicDirX = fleeX / fleeDist;
        h.panicDirY = fleeY / fleeDist;
      }
      h.panicTimer = randF(0.3, 0.8); // Panic burst duration
    }
    
    if (h.panicTimer > 0) {
      // Panicked running — faster, with jitter
      const panicSpeed = h.speed * 1.8;
      h.vx = h.panicDirX * panicSpeed + randF(-20, 20);
      h.vy = h.panicDirY * panicSpeed + randF(-20, 20);
    } else {
      // Normal Robotron wander: walk in a direction, then suddenly change
      h.wanderTimer -= dt;
      if (h.wanderTimer <= 0) {
        // New random direction — sharp turns, not gradual
        h.moveAngle = randF(0, Math.PI * 2);
        h.wanderTimer = randF(0.4, 1.5); // Short bursts of movement
        // Occasionally stop briefly (humans in Robotron pause momentarily)
        if (Math.random() < 0.2) {
          h.vx = 0; h.vy = 0;
          h.wanderTimer = randF(0.2, 0.6);
        } else {
          h.vx = Math.cos(h.moveAngle) * h.speed;
          h.vy = Math.sin(h.moveAngle) * h.speed;
        }
      }
    }
    
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    
    // Bounce off world edges (Robotron humans bounce, not clamp)
    if (h.x < 50) { h.x = 50; h.vx = Math.abs(h.vx); h.moveAngle = randF(-Math.PI/3, Math.PI/3); }
    if (h.x > WORLD_W - 50) { h.x = WORLD_W - 50; h.vx = -Math.abs(h.vx); h.moveAngle = randF(Math.PI*2/3, Math.PI*4/3); }
    if (h.y < 50) { h.y = 50; h.vy = Math.abs(h.vy); h.moveAngle = randF(Math.PI/6, Math.PI*5/6); }
    if (h.y > WORLD_H - 50) { h.y = WORLD_H - 50; h.vy = -Math.abs(h.vy); h.moveAngle = randF(-Math.PI*5/6, -Math.PI/6); }
    
    // Walk animation
    if (Math.abs(h.vx) > 1 || Math.abs(h.vy) > 1) {
      if (h.animTimer > 0.12) { h.animFrame = (h.animFrame + 1) % 4; h.animTimer = 0; }
    } else {
      h.animFrame = 0;
    }
    
    // Rescue on player contact
    if (p.alive && dist(h.x, h.y, p.x, p.y) < PLAYER_SIZE + h.size) {
      rescueHuman(h, i);
    }
  }
  
  // FAIL STATE: Game over ONLY if all humans are gone AND the player rescued NONE of them
  // (meaning enemies killed every single one). If the player saved at least one,
  // the wave ends normally via updateWaveSystem.
  if (game.humans.length === 0 && game.waveHumansStart > 0 && game.state === 'playing' && !game.betweenWaves) {
    if (game.player.rescueCount === 0 && game.waveHumansLost > 0) {
      // Total failure — not a single human saved
      game.player.alive = false;
      game.gameOverReason = 'humans_lost';
      emitParticles(game.player.x, game.player.y, 15, '#ff4444', 15, 100, 0.6, 3);
      game.shakeTimer = 0.5;
      game.shakeIntensity = 8;
      SFX.gameOverDramatic();
      setTimeout(() => { triggerGameEnd(); }, 1500);
    }
    // Otherwise: wave ends normally (handled by updateWaveSystem detecting humans.length === 0)
  }
}

function rescueHuman(h, index) {
  h.alive = false;
  game.humans.splice(index, 1);
  
  game.player.rescueCount++;
  game.player.totalRescues++;
  const rescueNum = game.player.rescueCount;
  const points = Math.min(rescueNum, 5) * 1000;
  game.player.score += points;
  
  // XP bonus
  game.player.xp += Math.floor(10 * game.player.xpMulti);
  
  emitDirectionalParticles(h.x, h.y, 15, '#44ff44', 0, -1, 40, 120, 0.8, 3);
  spawnFloatingText(h.x, h.y - 15, `${points}`, '#44ff44', 14);
  SFX.humanRescue(rescueNum);
}

function killHuman(h, index) {
  h.alive = false;
  game.humans.splice(index, 1);
  game.waveHumansLost++;
  game.cycleSurvivorCount = Math.max(0, game.cycleSurvivorCount - 1);
  
  // Big death effect — this should feel BAD
  emitParticles(h.x, h.y, 15, h.color, 20, 120, 0.7, 4);
  emitParticles(h.x, h.y, 8, '#ff0000', 15, 80, 0.4, 3);
  spawnFloatingText(h.x, h.y - 15, 'HUMAN LOST', '#ff4444', 12);
  
  // Ominous Midway-style death cue — the player should feel dread
  SFX.humanDeathOminous();
  
  // Screen flash red + shake
  game.flashTimer = 0.15;
  game.flashColor = '#ff0000';
  game.shakeTimer = 0.15;
  game.shakeIntensity = 3;
  
  // Pop the human count on screen (large, center, temporary)
  game.humanDeathPopTimer = 1.2; // show for 1.2 seconds
  game.humanDeathPopCount = game.humans.length;
}

function convertHumanToProg(h) {
  const idx = game.humans.indexOf(h);
  if (idx < 0) return;
  h.alive = false;
  game.humans.splice(idx, 1);
  game.waveHumansLost++;
  game.cycleSurvivorCount = Math.max(0, game.cycleSurvivorCount - 1);
  
  // Spawn a Prog at the human's location
  const prog = createEnemy('prog', h.x, h.y);
  prog.spawnTimer = 0.3;
  game.enemies.push(prog);
  game.waveEnemiesTotal++;
  game.waveEnemiesRemaining++;
  
  emitParticles(h.x, h.y, 8, '#ff2222', 15, 80, 0.3, 3);
  spawnFloatingText(h.x, h.y - 10, 'CONVERTED!', '#cc44cc', 10);
}

function drawHumans(ctx) {
  for (const h of game.humans) {
    if (!h.alive) continue;
    ctx.save();
    ctx.translate(h.x, h.y);
    
    const s = h.size;
    const isPanic = h.panicTimer > 0;
    
    // === ALWAYS-VISIBLE GREEN HIGHLIGHT ===
    // Pulsing green glow ring so humans are never lost in chaos
    const hGlow = 0.25 + Math.sin(game.time * 4 + h.x * 0.02) * 0.1;
    const hGlowR = s * 1.6 + Math.sin(game.time * 3 + h.y * 0.01) * 3;
    // Green ring
    ctx.strokeStyle = '#44ff44';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = hGlow;
    ctx.beginPath();
    ctx.arc(0, -s * 0.2, hGlowR, 0, Math.PI * 2);
    ctx.stroke();
    // Soft green fill
    ctx.fillStyle = '#44ff44';
    ctx.globalAlpha = hGlow * 0.08;
    ctx.beginPath();
    ctx.arc(0, -s * 0.2, hGlowR * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    
    // Panic: additional bright flash ring
    if (isPanic) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3 + Math.sin(game.time * 10) * 0.3;
      ctx.beginPath();
      ctx.arc(0, -s * 0.2, hGlowR * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    
    // Flash when panicking
    if (isPanic && Math.floor(h.panicTimer * 8) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = h.color;
    }
    
    // Animated humanoid — legs move, arms wave when panicking
    const legOff = Math.sin(h.animFrame * Math.PI / 2) * s * 0.25;
    
    // Head
    ctx.fillRect(-s * 0.25, -s * 1.0, s * 0.5, s * 0.4);
    // Body
    ctx.fillRect(-s * 0.3, -s * 0.6, s * 0.6, s * 0.7);
    // Arms
    if (isPanic) {
      ctx.fillRect(-s * 0.55, -s * 0.5 + Math.sin(h.animTimer * 10) * 3, s * 0.2, s * 0.4);
      ctx.fillRect(s * 0.35, -s * 0.5 - Math.sin(h.animTimer * 10) * 3, s * 0.2, s * 0.4);
    } else {
      ctx.fillRect(-s * 0.5, -s * 0.45, s * 0.18, s * 0.35);
      ctx.fillRect(s * 0.32, -s * 0.45, s * 0.18, s * 0.35);
    }
    // Legs (animated walk)
    const darkColor = h.type === 'mommy' ? '#cc4477' : h.type === 'daddy' ? '#336699' : '#999933';
    ctx.fillStyle = darkColor;
    ctx.fillRect(-s * 0.25, s * 0.1, s * 0.2, s * 0.4 + legOff);
    ctx.fillRect(s * 0.05, s * 0.1, s * 0.2, s * 0.4 - legOff);
    
    // "SAVE ME" text above human when player is nearby (within 250px)
    const dToPlayer = dist(h.x, h.y, game.player.x, game.player.y);
    if (dToPlayer < 250 && dToPlayer > 40) {
      ctx.fillStyle = '#44ff44';
      ctx.globalAlpha = clamp(1 - dToPlayer / 250, 0.2, 0.8);
      ctx.font = "6px 'Press Start 2P', monospace";
      ctx.textAlign = 'center';
      ctx.fillText('SAVE', 0, -s * 1.3);
      ctx.globalAlpha = 1;
    }
    
    ctx.restore();
  }
}

// ============================================================================
// 14. PROJECTILES
// ============================================================================

function updateProjectiles(dt) {
  // Player bullets
  game.playerBullets.forEach(b => {
    b.prevX = b.x; b.prevY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    
    // Off world
    if (b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
      b.active = false; return;
    }
    
    // Hit enemies
    for (const e of game.enemies) {
      if (!e.active || !e.alive || e.spawnTimer > 0) continue;
      if (dist(b.x, b.y, e.x, e.y) < e.size + 4) {
        damageEnemy(e, b.dmg);
        b.active = false;
        emitParticles(b.x, b.y, 3, '#ffffff', 8, 80, 0.15, 2);
        return;
      }
    }
  });
  
  // Enemy bullets
  game.enemyBullets.forEach(b => {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    
    // Cruise missiles home toward player
    if (b.type === 'cruise') {
      const dx = game.player.x - b.x;
      const dy = game.player.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        const homingStrength = 1.5;
        b.vx += (dx / d) * homingStrength;
        b.vy += (dy / d) * homingStrength;
      }
      // Exhaust particles
      if (Math.random() < 0.3) {
        emitParticles(b.x, b.y, 1, '#ff4400', 3, 20, 0.2, 2);
      }
    }
    
    // Tank shell bouncing
    if (b.type === 'shell') {
      if (b.x < 0 || b.x > WORLD_W) {
        if (b.bounces < b.maxBounces) { b.vx *= -1; b.bounces++; SFX.tankBounce(); }
        else { b.active = false; return; }
      }
      if (b.y < 0 || b.y > WORLD_H) {
        if (b.bounces < b.maxBounces) { b.vy *= -1; b.bounces++; SFX.tankBounce(); }
        else { b.active = false; return; }
      }
    } else {
      // Regular bullets die at world edge
      if (b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
        b.active = false; return;
      }
    }
    
    // Hit player
    if (game.player.alive && dist(b.x, b.y, game.player.x, game.player.y) < PLAYER_SIZE + 4) {
      damagePlayer(b.dmg);
      b.active = false;
      return;
    }
    
    // Enemy bullets kill humans on contact (but player bullets do NOT)
    for (let j = game.humans.length - 1; j >= 0; j--) {
      const h = game.humans[j];
      if (dist(b.x, b.y, h.x, h.y) < h.size) {
        killHuman(h, j);
        b.active = false;
        return;
      }
    }
  });
}

function drawProjectiles(ctx) {
  // Player LASER bullets only (missiles/spread drawn by drawWeapons)
  game.playerBullets.forEach(b => {
    if (b._type !== 'laser') return; // Skip non-laser bullets
    
    // Bright afterimage trail
    ctx.strokeStyle = C.laserGlow;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = LASER_WIDTH + 1;
    ctx.beginPath();
    ctx.moveTo(b.prevX, b.prevY);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    
    // Bright bolt
    ctx.fillStyle = '#ffffff';
    const a = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(a);
    ctx.fillRect(-LASER_LENGTH, -LASER_WIDTH / 2, LASER_LENGTH * 2, LASER_WIDTH);
    // Glow core
    ctx.fillStyle = C.laserGlow;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(-LASER_LENGTH * 1.5, -LASER_WIDTH, LASER_LENGTH * 3, LASER_WIDTH * 2);
    ctx.globalAlpha = 1;
    ctx.restore();
  });
  
  // Enemy bullets
  game.enemyBullets.forEach(b => {
    ctx.save();
    ctx.translate(b.x, b.y);
    
    switch (b.type) {
      case 'spark':
        ctx.fillStyle = C.enforcerSpark;
        ctx.fillRect(-3, -3, 6, 6);
        break;
      case 'shell':
        ctx.fillStyle = C.tankShell;
        ctx.fillRect(-4, -4, 8, 8);
        break;
      case 'cruise':
        ctx.fillStyle = '#ff4400';
        const ca = Math.atan2(b.vy, b.vx);
        ctx.rotate(ca);
        ctx.fillRect(-6, -3, 12, 6);
        ctx.fillStyle = '#ff8800';
        ctx.fillRect(-6, -1, 4, 2);
        break;
    }
    
    ctx.restore();
  });
}

// ============================================================================
// 15. XP & LEVELING
// ============================================================================

function updateGems(dt) {
  const p = game.player;
  const magnetR = XP_MAGNET_RADIUS * p.pickupRadiusMulti;
  
  game.gems.forEach(g => {
    const d = dist(g.x, g.y, p.x, p.y);
    if (d < magnetR) g.magnetized = true;
    
    if (g.magnetized) {
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dd = Math.hypot(dx, dy);
      if (dd > 0) {
        const spd = XP_MAGNET_SPEED * (1 - dd / magnetR * 0.5);
        g.x += (dx / dd) * spd * dt;
        g.y += (dy / dd) * spd * dt;
      }
    }
    
    // Collect
    if (dist(g.x, g.y, p.x, p.y) < 12) {
      const xpGain = Math.floor(g.value * p.xpMulti);
      p.xp += xpGain;
      g.active = false;
      SFX.xpGem();
      
      // Check level up
      checkLevelUp();
    }
  });
}

function checkLevelUp() {
  const p = game.player;
  while (p.xp >= p.xpToNext) {
    p.xp -= p.xpToNext;
    p.level++;
    
    // XP curve
    if (p.level <= 20) {
      p.xpToNext = 5 + (p.level - 1) * 10;
    } else if (p.level === 21) {
      p.xpToNext += 600;
    } else if (p.level <= 40) {
      p.xpToNext += 13;
    } else if (p.level === 41) {
      p.xpToNext += 2400;
    } else {
      p.xpToNext += 16;
    }
    
    // Trigger level-up screen
    game.state = 'levelup';
    generateLevelUpOptions();
    SFX.levelUp();
    emitParticles(p.x, p.y, 20, C.textCyan, 20, 150, 0.6, 4);
    return; // Handle one level at a time
  }
}

function drawGems(ctx) {
  game.gems.forEach(g => {
    // Color cycling
    const t = game.time * 3;
    ctx.fillStyle = g.color;
    ctx.globalAlpha = 0.7 + Math.sin(t + g.x * 0.01) * 0.3;
    
    // Diamond shape
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-g.size / 2, -g.size / 2, g.size, g.size);
    ctx.restore();
    ctx.globalAlpha = 1;
  });
}

// ============================================================================
// 16. LEVEL-UP SYSTEM (Vampire Survivors Style)
// ============================================================================

const WEAPONS = [
  { id: 'orbital', name: 'Orbital Shield', desc: 'Rotating orbs damage enemies on contact', maxLevel: 8, pairPassive: 'armor' },
  { id: 'missiles', name: 'Homing Missiles', desc: 'Auto-fires seeking missiles', maxLevel: 8, pairPassive: 'targeting' },
  { id: 'shockwave', name: 'Shockwave Pulse', desc: 'Periodic radial burst', maxLevel: 8, pairPassive: 'power' },
  { id: 'lightning', name: 'Chain Lightning', desc: 'Zaps and chains between enemies', maxLevel: 8, pairPassive: 'overcharge' },
  { id: 'flame', name: 'Flame Trail', desc: 'Leave a damaging fire trail', maxLevel: 8, pairPassive: 'propulsion' },
  { id: 'spread', name: 'Spread Shot', desc: 'Auto-fires a fan of projectiles', maxLevel: 8, pairPassive: 'rapid' },
  { id: 'mines', name: 'Mine Layer', desc: 'Drops proximity mines', maxLevel: 8, pairPassive: 'sensor' },
  { id: 'plasma', name: 'Plasma Wave', desc: 'Energy wave passes through enemies', maxLevel: 8, pairPassive: 'amplifier' },
];

const PASSIVES = [
  { id: 'armor', name: 'Armor Plating', desc: '-1 damage per hit', stat: 'armorFlat', perLevel: 1, maxLevel: 8 },
  { id: 'targeting', name: 'Targeting Array', desc: '+10% projectile speed', stat: 'projSpeedMulti', perLevel: 0.1, maxLevel: 8, additive: true },
  { id: 'power', name: 'Power Surge', desc: '+10% damage', stat: 'damageMulti', perLevel: 0.1, maxLevel: 8, additive: true },
  { id: 'overcharge', name: 'Overcharge Cell', desc: '+10% duration', stat: 'durationMulti', perLevel: 0.1, maxLevel: 8, additive: true },
  { id: 'propulsion', name: 'Propulsion Boost', desc: '+8% move speed', stat: 'speedMulti', perLevel: 0.08, maxLevel: 8, additive: true },
  { id: 'rapid', name: 'Rapid Loader', desc: '-6% cooldowns', stat: 'cooldownMulti', perLevel: -0.06, maxLevel: 8, additive: true },
  { id: 'sensor', name: 'Sensor Grid', desc: '+20% pickup radius', stat: 'pickupRadiusMulti', perLevel: 0.2, maxLevel: 8, additive: true },
  { id: 'amplifier', name: 'Amplifier Core', desc: '+10% AoE', stat: 'aoeMulti', perLevel: 0.1, maxLevel: 8, additive: true },
  { id: 'nanite', name: 'Nanite Repair', desc: '+0.3 HP/sec', stat: 'regenPerSec', perLevel: 0.3, maxLevel: 8 },
  { id: 'crown', name: 'Neural Crown', desc: '+8% XP gain', stat: 'xpMulti', perLevel: 0.08, maxLevel: 8, additive: true },
  { id: 'fortune', name: 'Fortune Chip', desc: '+5% crit chance', stat: 'critChance', perLevel: 0.05, maxLevel: 8 },
  { id: 'hollow', name: 'Hollow Core', desc: '+15% max HP', stat: 'maxHpMulti', perLevel: 0.15, maxLevel: 8, additive: true },
];

let levelUpOptions = [];
let levelUpSelection = 0;

function generateLevelUpOptions() {
  const p = game.player;
  const options = [];
  
  // 3% chance for Stompy
  if (Math.random() < 0.03) {
    options.push({ type: 'stompy', name: 'STOMPY', desc: 'BECOME THE MACHINE - 30s giant robot!', level: 0, legendary: true });
  }
  
  // Gather possible offerings
  const pool = [];
  
  // Weapons the player owns (can level up)
  for (const w of p.weapons) {
    const def = WEAPONS.find(d => d.id === w.id);
    if (def && w.level < def.maxLevel) {
      pool.push({ type: 'weapon', id: w.id, name: def.name, desc: def.desc, level: w.level + 1, isNew: false });
    }
  }
  
  // New weapons (if under 6)
  if (p.weapons.length < 6) {
    for (const def of WEAPONS) {
      if (!p.weapons.find(w => w.id === def.id)) {
        pool.push({ type: 'weapon', id: def.id, name: def.name, desc: def.desc, level: 1, isNew: true });
      }
    }
  }
  
  // Passives the player owns (can level up)
  for (const pa of p.passives) {
    const def = PASSIVES.find(d => d.id === pa.id);
    if (def && pa.level < def.maxLevel) {
      pool.push({ type: 'passive', id: pa.id, name: def.name, desc: def.desc, level: pa.level + 1, isNew: false });
    }
  }
  
  // New passives (if under 6)
  if (p.passives.length < 6) {
    for (const def of PASSIVES) {
      if (!p.passives.find(pa => pa.id === def.id)) {
        pool.push({ type: 'passive', id: def.id, name: def.name, desc: def.desc, level: 1, isNew: true });
      }
    }
  }
  
  // Pick 3-4 random options (fill remaining from pool)
  const needed = 4 - options.length;
  for (let i = 0; i < needed && pool.length > 0; i++) {
    const idx = randI(0, pool.length - 1);
    options.push(pool.splice(idx, 1)[0]);
  }
  
  // If nothing available, offer HP or XP
  if (options.length === 0) {
    options.push({ type: 'heal', name: 'Emergency Repair', desc: '+25 HP', level: 0 });
    options.push({ type: 'xpbonus', name: 'XP Surge', desc: '+50 bonus XP', level: 0 });
  }
  
  levelUpOptions = options;
  levelUpSelection = 0;
}

function selectLevelUpOption(opt) {
  const p = game.player;
  
  if (opt.type === 'stompy') {
    activateStompy();
  } else if (opt.type === 'weapon') {
    const existing = p.weapons.find(w => w.id === opt.id);
    if (existing) {
      existing.level++;
    } else {
      p.weapons.push({ id: opt.id, level: 1 });
    }
  } else if (opt.type === 'passive') {
    const existing = p.passives.find(pa => pa.id === opt.id);
    if (existing) {
      existing.level++;
    } else {
      p.passives.push({ id: opt.id, level: 1 });
    }
    // Apply passive stats
    recalcPassiveStats();
  } else if (opt.type === 'heal') {
    p.hp = Math.min(p.hp + 25, p.maxHp);
  } else if (opt.type === 'xpbonus') {
    p.xp += 50;
  }
  
  SFX.menuConfirm();
  game.state = 'playing';
  p.iframes = 1.0; // Brief invincibility after level up
}

function recalcPassiveStats() {
  const p = game.player;
  // Reset to base
  p.damageMulti = 1; p.speedMulti = 1; p.cooldownMulti = 1;
  p.pickupRadiusMulti = 1; p.projSpeedMulti = 1; p.durationMulti = 1;
  p.aoeMulti = 1; p.armorFlat = 0; p.regenPerSec = 0;
  p.xpMulti = 1; p.critChance = 0; p.maxHpMulti = 1;
  
  for (const pa of p.passives) {
    const def = PASSIVES.find(d => d.id === pa.id);
    if (!def) continue;
    if (def.additive) {
      p[def.stat] += def.perLevel * pa.level;
    } else {
      p[def.stat] += def.perLevel * pa.level;
    }
  }
  
  // Apply max HP multiplier
  p.maxHp = Math.floor(PLAYER_MAX_HP * p.maxHpMulti);
  if (p.hp > p.maxHp) p.hp = p.maxHp;
}

// ============================================================================
// 16b. WEAPON EFFECTS SYSTEM
// ============================================================================

// Runtime state for active weapons
const weaponState = {
  orbital: { angle: 0 },
  missiles: { cooldown: 0 },
  shockwave: { cooldown: 0, activeRadius: 0, activeDuration: 0 },
  lightning: { cooldown: 0, arcs: [] },
  flame: { trail: [] }, // {x, y, life, maxLife}
  spread: { cooldown: 0 },
  mines: { cooldown: 0, placed: [] }, // {x, y, radius, life, armed}
  plasma: { cooldown: 0, waves: [] }, // {x, y, dirX, dirY, dist, life}
};

function resetWeaponState() {
  weaponState.orbital.angle = 0;
  weaponState.missiles.cooldown = 0;
  weaponState.shockwave.cooldown = 0;
  weaponState.shockwave.activeRadius = 0;
  weaponState.shockwave.activeDuration = 0;
  weaponState.lightning.cooldown = 0;
  weaponState.lightning.arcs = [];
  weaponState.flame.trail = [];
  weaponState.spread.cooldown = 0;
  weaponState.mines.cooldown = 0;
  weaponState.mines.placed = [];
  weaponState.plasma.cooldown = 0;
  weaponState.plasma.waves = [];
}

function getWeaponLevel(id) {
  const w = game.player.weapons.find(w => w.id === id);
  return w ? w.level : 0;
}

function updateWeapons(dt) {
  const p = game.player;
  if (!p.alive) return;
  const dmgMult = p.damageMulti;
  const cdMult = Math.max(0.3, p.cooldownMulti); // floor at 30%
  const aoeMult = p.aoeMulti;
  const durMult = p.durationMulti;
  const projSpd = p.projSpeedMulti;

  // ---- ORBITAL SHIELD ----
  const orbLv = getWeaponLevel('orbital');
  if (orbLv > 0) {
    const orbCount = Math.min(2 + Math.floor(orbLv / 2), 6); // 2,2,3,3,4,4,5,6
    const orbRadius = 50 + orbLv * 5;
    const orbSpeed = 2.5 + orbLv * 0.3;
    const orbDmg = (1 + orbLv * 0.8) * dmgMult;
    weaponState.orbital.angle += orbSpeed * dt;

    for (let i = 0; i < orbCount; i++) {
      const a = weaponState.orbital.angle + (i / orbCount) * Math.PI * 2;
      const ox = p.x + Math.cos(a) * orbRadius;
      const oy = p.y + Math.sin(a) * orbRadius;
      // Hit enemies
      for (const e of game.enemies) {
        if (!e.active || !e.alive || e.spawnTimer > 0) continue;
        if (dist(ox, oy, e.x, e.y) < e.size + 8) {
          damageEnemy(e, orbDmg);
          SFX.orbitalHit();
        }
      }
    }
  }

  // ---- HOMING MISSILES ----
  const misLv = getWeaponLevel('missiles');
  if (misLv > 0) {
    const misCount = Math.min(1 + Math.floor(misLv / 2), 5); // 1,1,2,2,3,3,4,5
    const misCd = Math.max(0.4, (2.0 - misLv * 0.2) * cdMult);
    const misDmg = (3 + misLv * 1.5) * dmgMult;
    const misSpd = (350 + misLv * 30) * projSpd;

    weaponState.missiles.cooldown -= dt;
    if (weaponState.missiles.cooldown <= 0) {
      weaponState.missiles.cooldown = misCd;
      // Find nearest enemies and fire at them
      const sorted = game.enemies
        .filter(e => e.active && e.alive && e.spawnTimer <= 0)
        .map(e => ({ e, d: dist(p.x, p.y, e.x, e.y) }))
        .sort((a, b) => a.d - b.d);
      for (let i = 0; i < misCount && i < sorted.length; i++) {
        const target = sorted[i].e;
        const b = game.playerBullets.get();
        if (!b) break;
        const a = angle(p.x, p.y, target.x, target.y);
        b.x = p.x; b.y = p.y;
        b.prevX = p.x; b.prevY = p.y;
        b.vx = Math.cos(a) * misSpd;
        b.vy = Math.sin(a) * misSpd;
        b.dmg = misDmg;
        b._type = 'missile'; // for rendering
        b._target = target;
        b._homingStr = 3.0 + misLv * 0.5;
        b._life = 3.0;
      }
      SFX.missilelaunch();
    }
  }

  // ---- SHOCKWAVE PULSE ----
  const swLv = getWeaponLevel('shockwave');
  if (swLv > 0) {
    const swCd = Math.max(1.0, (4.0 - swLv * 0.35) * cdMult);
    const swRadius = (80 + swLv * 25) * aoeMult;
    const swDmg = (2 + swLv * 1.2) * dmgMult;
    const swKnockback = 60 + swLv * 15;

    weaponState.shockwave.cooldown -= dt;
    if (weaponState.shockwave.cooldown <= 0) {
      weaponState.shockwave.cooldown = swCd;
      weaponState.shockwave.activeRadius = 0;
      weaponState.shockwave.activeDuration = 0.3;
      weaponState.shockwave._maxRadius = swRadius;
      // Damage + knockback all enemies in radius
      for (const e of game.enemies) {
        if (!e.active || !e.alive || e.spawnTimer > 0) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d < swRadius) {
          damageEnemy(e, swDmg);
          // Knockback
          if (d > 0) {
            const nx = (e.x - p.x) / d;
            const ny = (e.y - p.y) / d;
            e.x += nx * swKnockback;
            e.y += ny * swKnockback;
          }
        }
      }
      SFX.shockwaveBlast();
      game.shakeTimer = 0.1;
      game.shakeIntensity = 3;
    }
    // Animate expanding ring
    if (weaponState.shockwave.activeDuration > 0) {
      weaponState.shockwave.activeDuration -= dt;
      weaponState.shockwave.activeRadius = lerp(0, weaponState.shockwave._maxRadius || 200, 1 - weaponState.shockwave.activeDuration / 0.3);
    }
  }

  // ---- CHAIN LIGHTNING ----
  const ltLv = getWeaponLevel('lightning');
  if (ltLv > 0) {
    const ltCd = Math.max(0.4, (1.2 - ltLv * 0.08) * cdMult);
    const ltChains = Math.min(1 + ltLv, 6); // 2,3,4,5,6,6,6,6 (capped)
    const ltDmg = (2 + ltLv * 0.8) * dmgMult;
    const ltRange = (150 + ltLv * 20) * aoeMult;

    weaponState.lightning.cooldown -= dt;
    if (weaponState.lightning.cooldown <= 0) {
      weaponState.lightning.cooldown = ltCd;
      weaponState.lightning.arcs = [];
      // Find nearest enemy
      let current = { x: p.x, y: p.y };
      const hit = new Set();
      for (let c = 0; c < ltChains; c++) {
        let nearest = null;
        let nearDist = Infinity;
        for (const e of game.enemies) {
          if (!e.active || !e.alive || e.spawnTimer > 0 || hit.has(e)) continue;
          const d = dist(current.x, current.y, e.x, e.y);
          if (d < ltRange && d < nearDist) {
            nearDist = d;
            nearest = e;
          }
        }
        if (!nearest) break;
        hit.add(nearest);
        weaponState.lightning.arcs.push({ x1: current.x, y1: current.y, x2: nearest.x, y2: nearest.y, life: 0.15 });
        damageEnemy(nearest, ltDmg);
        current = { x: nearest.x, y: nearest.y };
      }
      if (weaponState.lightning.arcs.length > 0) {
        SFX.lightningCrackle();
      }
    }
    // Decay arc visuals
    for (let i = weaponState.lightning.arcs.length - 1; i >= 0; i--) {
      weaponState.lightning.arcs[i].life -= dt;
      if (weaponState.lightning.arcs[i].life <= 0) weaponState.lightning.arcs.splice(i, 1);
    }
  }

  // ---- FLAME TRAIL ----
  const flLv = getWeaponLevel('flame');
  if (flLv > 0) {
    const flDmg = (1 + flLv * 0.6) * dmgMult;
    const flLife = (1.0 + flLv * 0.4) * durMult;
    const flWidth = (12 + flLv * 3) * aoeMult;
    const isMoving = Math.abs(Input.moveX) > 0.01 || Math.abs(Input.moveY) > 0.01;

    // Drop flame segments while moving
    if (isMoving) {
      const trail = weaponState.flame.trail;
      const last = trail.length > 0 ? trail[trail.length - 1] : null;
      if (!last || dist(last.x, last.y, p.x, p.y) > 10) {
        trail.push({ x: p.x, y: p.y, life: flLife, maxLife: flLife, radius: flWidth, dmg: flDmg });
        if (!last || dist(last.x, last.y, p.x, p.y) > 40) SFX.flameWhoosh();
      }
    }
    // Update trail segments
    for (let i = weaponState.flame.trail.length - 1; i >= 0; i--) {
      const seg = weaponState.flame.trail[i];
      seg.life -= dt;
      if (seg.life <= 0) { weaponState.flame.trail.splice(i, 1); continue; }
      // Damage enemies touching this segment
      seg._dmgTimer = (seg._dmgTimer || 0) - dt;
      if (seg._dmgTimer <= 0) {
        seg._dmgTimer = 0.3; // damage tick rate
        for (const e of game.enemies) {
          if (!e.active || !e.alive || e.spawnTimer > 0) continue;
          if (dist(seg.x, seg.y, e.x, e.y) < seg.radius + e.size) {
            damageEnemy(e, seg.dmg);
          }
        }
      }
    }
  }

  // ---- SPREAD SHOT ----
  const spLv = getWeaponLevel('spread');
  if (spLv > 0) {
    const spCount = 3 + Math.floor(spLv * 0.7); // 3,4,4,5,5,6,7,8
    const spCd = Math.max(0.3, (1.2 - spLv * 0.1) * cdMult);
    const spDmg = (1.5 + spLv * 0.6) * dmgMult;
    const spSpd = (500 + spLv * 30) * projSpd;
    const spreadAngle = Math.PI * (0.4 - spLv * 0.02); // narrows at higher levels

    weaponState.spread.cooldown -= dt;
    if (weaponState.spread.cooldown <= 0) {
      weaponState.spread.cooldown = spCd;
      const baseAngle = p.facing;
      for (let i = 0; i < spCount; i++) {
        const a = baseAngle + (i / (spCount - 1) - 0.5) * spreadAngle;
        const b = game.playerBullets.get();
        if (!b) break;
        b.x = p.x; b.y = p.y;
        b.prevX = p.x; b.prevY = p.y;
        b.vx = Math.cos(a) * spSpd;
        b.vy = Math.sin(a) * spSpd;
        b.dmg = spDmg;
        b._type = 'spread';
      }
      SFX.spreadBlast();
    }
  }

  // ---- MINE LAYER ----
  const mnLv = getWeaponLevel('mines');
  if (mnLv > 0) {
    const mnCd = Math.max(0.8, (3.0 - mnLv * 0.25) * cdMult);
    const mnBlast = (50 + mnLv * 12) * aoeMult;
    const mnDmg = (4 + mnLv * 2) * dmgMult;
    const mnLife = 10 + mnLv * 2;
    const mnPerDrop = Math.min(1 + Math.floor(mnLv / 3), 3); // 1,1,1,2,2,2,3,3

    weaponState.mines.cooldown -= dt;
    if (weaponState.mines.cooldown <= 0) {
      weaponState.mines.cooldown = mnCd;
      for (let i = 0; i < mnPerDrop; i++) {
        weaponState.mines.placed.push({
          x: p.x + randF(-20, 20), y: p.y + randF(-20, 20),
          radius: mnBlast, dmg: mnDmg, life: mnLife,
          armed: false, armTimer: 0.5, // arm after 0.5s
          pulseTimer: 0,
        });
      }
    }
    // Update mines
    for (let i = weaponState.mines.placed.length - 1; i >= 0; i--) {
      const m = weaponState.mines.placed[i];
      m.life -= dt;
      m.pulseTimer += dt;
      if (m.life <= 0) { weaponState.mines.placed.splice(i, 1); continue; }
      if (!m.armed) {
        m.armTimer -= dt;
        if (m.armTimer <= 0) { m.armed = true; SFX.mineArm(); }
        continue;
      }
      // Check proximity to enemies
      let triggered = false;
      for (const e of game.enemies) {
        if (!e.active || !e.alive || e.spawnTimer > 0) continue;
        if (dist(m.x, m.y, e.x, e.y) < 40) {
          triggered = true; break;
        }
      }
      if (triggered) {
        // Explode!
        for (const e of game.enemies) {
          if (!e.active || !e.alive || e.spawnTimer > 0) continue;
          if (dist(m.x, m.y, e.x, e.y) < m.radius) {
            damageEnemy(e, m.dmg);
          }
        }
        emitParticles(m.x, m.y, 15, '#ff8800', 20, 180, 0.5, 4);
        emitParticles(m.x, m.y, 8, '#ffcc00', 15, 120, 0.3, 3);
        SFX.mineExplode();
        game.shakeTimer = 0.08;
        game.shakeIntensity = 2;
        weaponState.mines.placed.splice(i, 1);
      }
    }
  }

  // ---- PLASMA WAVE ----
  const plLv = getWeaponLevel('plasma');
  if (plLv > 0) {
    const plCd = Math.max(1.0, (5.0 - plLv * 0.4) * cdMult);
    const plDmg = (3 + plLv * 1.5) * dmgMult;
    const plSpd = 400 * projSpd;
    const plWidth = (20 + plLv * 5) * aoeMult;
    const plDirs = Math.min(1 + Math.floor(plLv / 2), 4); // 1,1,2,2,3,3,4,4

    weaponState.plasma.cooldown -= dt;
    if (weaponState.plasma.cooldown <= 0) {
      weaponState.plasma.cooldown = plCd;
      const directions = [];
      if (plDirs >= 1) directions.push({ x: 1, y: 0 });  // right
      if (plDirs >= 2) directions.push({ x: -1, y: 0 }); // left
      if (plDirs >= 3) directions.push({ x: 0, y: -1 }); // up
      if (plDirs >= 4) directions.push({ x: 0, y: 1 });  // down
      for (const dir of directions) {
        weaponState.plasma.waves.push({
          x: p.x, y: p.y,
          dirX: dir.x, dirY: dir.y,
          speed: plSpd, width: plWidth, dmg: plDmg,
          dist: 0, maxDist: 800 + plLv * 50,
          life: 2.0, _hitSet: new Set(),
        });
      }
      SFX.plasmaFire();
    }
    // Update plasma waves
    for (let i = weaponState.plasma.waves.length - 1; i >= 0; i--) {
      const pw = weaponState.plasma.waves[i];
      const move = pw.speed * dt;
      pw.x += pw.dirX * move;
      pw.y += pw.dirY * move;
      pw.dist += move;
      pw.life -= dt;
      if (pw.life <= 0 || pw.dist > pw.maxDist || pw.x < 0 || pw.x > WORLD_W || pw.y < 0 || pw.y > WORLD_H) {
        weaponState.plasma.waves.splice(i, 1); continue;
      }
      // Damage enemies (pass through, but only hit each once)
      for (const e of game.enemies) {
        if (!e.active || !e.alive || e.spawnTimer > 0 || pw._hitSet.has(e)) continue;
        // Check if enemy is within the wave beam width
        let inBeam = false;
        if (Math.abs(pw.dirX) > 0.5) {
          // Horizontal beam
          inBeam = Math.abs(e.y - pw.y) < pw.width + e.size && Math.abs(e.x - pw.x) < 40;
        } else {
          // Vertical beam
          inBeam = Math.abs(e.x - pw.x) < pw.width + e.size && Math.abs(e.y - pw.y) < 40;
        }
        if (inBeam) {
          damageEnemy(e, pw.dmg);
          pw._hitSet.add(e);
        }
      }
    }
  }

  // ---- UPDATE HOMING MISSILE BULLETS ----
  game.playerBullets.forEach(b => {
    if (b._type === 'missile' && b._target) {
      const t = b._target;
      if (t.active && t.alive) {
        const dx = t.x - b.x;
        const dy = t.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          b.vx += (dx / d) * b._homingStr;
          b.vy += (dy / d) * b._homingStr;
        }
      }
      b._life -= dt;
      if (b._life <= 0) b.active = false;
      // Exhaust particles
      if (Math.random() < 0.4) {
        emitParticles(b.x, b.y, 1, '#ff6600', 3, 15, 0.15, 2);
      }
    }
  });
}

function drawWeapons(ctx) {
  const p = game.player;
  if (!p.alive) return;

  // ---- ORBITAL SHIELD ORBS ----
  const orbLv = getWeaponLevel('orbital');
  if (orbLv > 0) {
    const orbCount = Math.min(2 + Math.floor(orbLv / 2), 6);
    const orbRadius = 50 + orbLv * 5;
    const orbSize = 6 + orbLv * 0.5;
    for (let i = 0; i < orbCount; i++) {
      const a = weaponState.orbital.angle + (i / orbCount) * Math.PI * 2;
      const ox = p.x + Math.cos(a) * orbRadius;
      const oy = p.y + Math.sin(a) * orbRadius;
      // Glow
      ctx.fillStyle = '#44ccff';
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(ox, oy, orbSize * 1.8, 0, Math.PI * 2);
      ctx.fill();
      // Core
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#88eeff';
      ctx.beginPath();
      ctx.arc(ox, oy, orbSize, 0, Math.PI * 2);
      ctx.fill();
      // Afterimage trail
      const prevA = a - 0.3;
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#44ccff';
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(prevA) * orbRadius, p.y + Math.sin(prevA) * orbRadius, orbSize * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- SHOCKWAVE EXPANDING RING ----
  if (weaponState.shockwave.activeDuration > 0) {
    const alpha = weaponState.shockwave.activeDuration / 0.3;
    ctx.strokeStyle = '#88ddff';
    ctx.lineWidth = 3 + (1 - alpha) * 4;
    ctx.globalAlpha = alpha * 0.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, weaponState.shockwave.activeRadius, 0, Math.PI * 2);
    ctx.stroke();
    // Inner ring
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, weaponState.shockwave.activeRadius * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- CHAIN LIGHTNING ARCS ----
  for (const arc of weaponState.lightning.arcs) {
    const alpha = arc.life / 0.15;
    ctx.strokeStyle = '#aaeeff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha;
    // Draw jagged lightning bolt
    ctx.beginPath();
    ctx.moveTo(arc.x1, arc.y1);
    const segments = 6;
    const dx = arc.x2 - arc.x1;
    const dy = arc.y2 - arc.y1;
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const jitter = 12 * (1 - Math.abs(t - 0.5) * 2);
      ctx.lineTo(
        arc.x1 + dx * t + randF(-jitter, jitter),
        arc.y1 + dy * t + randF(-jitter, jitter)
      );
    }
    ctx.lineTo(arc.x2, arc.y2);
    ctx.stroke();
    // Bright center
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(arc.x1, arc.y1);
    ctx.lineTo(arc.x2, arc.y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- FLAME TRAIL ----
  for (const seg of weaponState.flame.trail) {
    const alpha = seg.life / seg.maxLife;
    const r = seg.radius * alpha;
    // Outer glow
    ctx.fillStyle = '#ff4400';
    ctx.globalAlpha = alpha * 0.4;
    ctx.beginPath();
    ctx.arc(seg.x, seg.y, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.fillStyle = '#ff8800';
    ctx.globalAlpha = alpha * 0.7;
    ctx.beginPath();
    ctx.arc(seg.x, seg.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Bright center
    ctx.fillStyle = '#ffcc44';
    ctx.globalAlpha = alpha * 0.5;
    ctx.beginPath();
    ctx.arc(seg.x, seg.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ---- MINES ----
  for (const m of weaponState.mines.placed) {
    ctx.save();
    ctx.translate(m.x, m.y);
    const pulse = m.armed ? 0.5 + Math.sin(m.pulseTimer * 6) * 0.5 : 0.3;
    // Outer ring
    ctx.strokeStyle = m.armed ? '#ff6600' : '#666666';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();
    // Center
    ctx.fillStyle = m.armed ? '#ff4400' : '#444444';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    // Blink light
    if (m.armed) {
      ctx.fillStyle = '#ff0000';
      ctx.globalAlpha = pulse;
      ctx.fillRect(-2, -2, 4, 4);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // ---- PLASMA WAVES ----
  for (const pw of weaponState.plasma.waves) {
    const alpha = pw.life / 2.0;
    const hw = pw.width;
    ctx.save();
    ctx.translate(pw.x, pw.y);
    // Bright beam
    ctx.fillStyle = '#aa44ff';
    ctx.globalAlpha = alpha * 0.6;
    if (Math.abs(pw.dirX) > 0.5) {
      // Horizontal beam
      ctx.fillRect(-30, -hw, 60, hw * 2);
    } else {
      // Vertical beam
      ctx.fillRect(-hw, -30, hw * 2, 60);
    }
    // Core
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = alpha * 0.4;
    if (Math.abs(pw.dirX) > 0.5) {
      ctx.fillRect(-20, -hw * 0.4, 40, hw * 0.8);
    } else {
      ctx.fillRect(-hw * 0.4, -20, hw * 0.8, 40);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // ---- HOMING MISSILE BULLETS (custom rendering) ----
  game.playerBullets.forEach(b => {
    if (!b.active || b._type !== 'missile') return;
    ctx.save();
    ctx.translate(b.x, b.y);
    const a = Math.atan2(b.vy, b.vx);
    ctx.rotate(a);
    // Body
    ctx.fillStyle = '#ff8844';
    ctx.fillRect(-6, -2, 12, 4);
    // Exhaust
    ctx.fillStyle = '#ff4400';
    ctx.fillRect(-9, -1, 4, 2);
    ctx.restore();
  });

  // ---- SPREAD SHOT BULLETS (custom rendering) ----
  game.playerBullets.forEach(b => {
    if (!b.active || b._type !== 'spread') return;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = '#ffcc44';
    ctx.fillRect(-3, -2, 6, 4);
    ctx.restore();
  });
}

// ============================================================================
// 17. STOMPY
// ============================================================================

let stompyActive = false;
let stompyTimer = 0;

function activateStompy() {
  stompyActive = true;
  stompyTimer = 30;
  game.camZoom = 0.8; // Zoom out
  game.shakeTimer = 0.5;
  game.shakeIntensity = 6;
  // Flash
  game.flashTimer = 0.3;
  game.flashColor = '#ffffff';
  SFX.stompyTransform();
}

function updateStompy(dt) {
  if (!stompyActive) return;
  stompyTimer -= dt;
  
  // Stomp footstep shake
  if (Math.abs(Input.moveX) > 0.01 || Math.abs(Input.moveY) > 0.01) {
    if (Math.floor(game.time * 4) % 2 === 0 && Math.floor((game.time - dt) * 4) % 2 !== 0) {
      game.shakeTimer = 0.05;
      game.shakeIntensity = 2;
    }
  }
  
  // Crush enemies on contact
  const p = game.player;
  const stompRadius = PLAYER_SIZE * 4;
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    if (!e.active || e.spawnTimer > 0) continue;
    if (dist(e.x, e.y, p.x, p.y) < stompRadius + e.size) {
      // Kill everything, even Hulks
      e.hp = 0;
      killEnemy(e, i);
    }
  }
  
  // Still rescue humans
  for (let i = game.humans.length - 1; i >= 0; i--) {
    const h = game.humans[i];
    if (dist(h.x, h.y, p.x, p.y) < stompRadius + h.size) {
      rescueHuman(h, i);
    }
  }
  
  if (stompyTimer <= 0) {
    stompyActive = false;
    game.camZoom = 1.0;
    game.player.iframes = 3.0; // Grace period
  }
}

// ============================================================================
// 18. WAVE SYSTEM
// ============================================================================

// Humans persist across 5-wave cycles. Fresh batch every 5 waves.
function startNextWave() {
  game.wave++;
  game.player.rescueCount = 0;
  game.waveHumansLost = 0;
  
  const w = game.wave;
  const isBrainWave = w % 5 === 0;
  const cycleWave = ((w - 1) % 5) + 1; // 1,2,3,4,5,1,2,3,4,5...
  const isNewCycle = cycleWave === 1; // Fresh humans on wave 1,6,11,16...
  
  // Clear non-Hulk enemies from previous wave
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    if (e.type !== 'hulk') { e.active = false; game.enemies.splice(i, 1); }
  }
  
  // Spawn electrodes as static hazards
  const electrodes = 5 + w * 2;
  for (let i = 0; i < electrodes; i++) spawnEnemyRandom('electrode');
  
  // Hulks: persistent, add more each wave
  const newHulks = w >= 2 ? Math.min(Math.floor(w * 0.5), 4) : 0;
  if (!isBrainWave) { for (let i = 0; i < newHulks; i++) spawnEnemyRandom('hulk'); }
  
  // Brains on brain waves (every 5th)
  if (isBrainWave) {
    const brainCount = 3 + Math.floor(w / 2);
    for (let i = 0; i < brainCount; i++) spawnEnemyAtEdge('brain');
  }
  
  // Spawn initial enemies
  const initGrunts = 15 + w * 5;
  for (let i = 0; i < initGrunts; i++) spawnEnemyAtEdge('grunt');
  if (w >= 3) { for (let i = 0; i < Math.min(w - 2, 3); i++) spawnEnemyAtEdge('spheroid'); }
  if (w >= 4) { for (let i = 0; i < Math.min(w - 3, 2); i++) spawnEnemyAtEdge('quark'); }
  
  // ---- HUMAN CYCLE SYSTEM ----
  // Fixed pool of survivors across 5-wave cycles.
  // Wave 1/6/11/16: fresh batch spawns.
  // Waves 2-5 within a cycle: ONLY the survivors from the previous wave return.
  // Rescued humans come back (they survived!). Killed humans do NOT.
  // This means the pool shrinks only when enemies kill humans.
  
  if (isNewCycle) {
    // Fresh batch
    game.humans = [];
    game.cycleSurvivorCount = Math.max(8, 20 + Math.floor((w - 1) / 5) * 3);
    spawnHumans(game.cycleSurvivorCount);
    game.cycleSurvivorCount = game.humans.length; // actual spawned (may be less due to position conflicts)
  } else {
    // Carry-over: the survivors from last wave = cycleSurvivorCount - total killed across this cycle
    // Re-spawn the surviving count at random positions
    const survivorCount = game.cycleSurvivorCount; // this was decremented by killHuman
    game.humans = [];
    if (survivorCount > 0) {
      spawnHumans(survivorCount);
    }
  }
  
  // Track for this wave
  game.waveHumansStart = game.humans.length;
  
  // Set continuous spawn rate
  game.waveSpawnTimer = 0;
  game.waveSpawnRate = Math.max(0.8, 3.0 - w * 0.15);
  game.waveSpawnCount = Math.min(3 + Math.floor(w * 0.5), 8);
  
  // Announce
  game.waveAnnounce = 2.5;
  game.betweenWaves = false;
  
  SFX.waveTransition();
  
  // Show cycle info
  if (isNewCycle && w > 1) {
    spawnFloatingText(game.player.x, game.player.y - 60, 'NEW SURVIVORS ARRIVED!', '#44ff44', 14);
  } else if (!isNewCycle) {
    spawnFloatingText(game.player.x, game.player.y - 60, `${game.humans.length} SURVIVORS REMAIN`, game.humans.length <= 5 ? '#ff4444' : '#ffcc00', 11);
  }
}

function updateWaveSystem(dt) {
  if (game.betweenWaves) {
    game.waveClearTimer -= dt;
    if (game.waveClearTimer <= 0) {
      startNextWave();
    }
    return;
  }
  
  if (game.waveAnnounce > 0) {
    game.waveAnnounce -= dt;
    return;
  }
  
  // Wave is driven by HUMANS, not enemy counts
  // Enemies spawn continuously until all humans are either saved or dead
  // Wave ends when: humans.length === 0 (all saved or killed)
  
  const humansRemaining = game.humans.length;
  
  if (humansRemaining === 0) {
    // Wave complete! (if not game over from all dying)
    if (game.player.alive && game.state === 'playing') {
      game.betweenWaves = true;
      game.waveClearTimer = 3.0;
      SFX.waveClear();
      game.player.score += 500 * game.wave;
      const saved = game.player.rescueCount;
      const totalHumans = saved + game.waveHumansLost;
      spawnFloatingText(game.player.x, game.player.y - 40, `WAVE ${game.wave} CLEAR!`, C.textYellow, 18);
      spawnFloatingText(game.player.x, game.player.y - 10, `HUMANS SAVED: ${saved} / ${totalHumans}`, saved > 0 ? '#44ff44' : '#ff4444', 12);
      spawnFloatingText(game.player.x, game.player.y + 15, `+${500 * game.wave} BONUS`, C.textCyan, 10);
      
      // Kill remaining non-Hulk enemies for clean transition
      game.shakeTimer = 0.2;
      game.shakeIntensity = 4;
    }
    return;
  }
  
  // CONTINUOUS ENEMY SPAWNING — keeps pressure on until humans are resolved
  game.waveSpawnTimer -= dt;
  if (game.waveSpawnTimer <= 0) {
    game.waveSpawnTimer = game.waveSpawnRate;
    const count = game.waveSpawnCount;
    for (let i = 0; i < count; i++) {
      const w = game.wave;
      const r = Math.random();
      if (r < 0.55) {
        spawnEnemyAtEdge('grunt');
      } else if (r < 0.70 && w >= 3) {
        spawnEnemyAtEdge('enforcer');
      } else if (r < 0.80 && w >= 4) {
        spawnEnemyAtEdge('tank');
      } else if (r < 0.88 && w >= 3) {
        spawnEnemyAtEdge('spheroid');
      } else if (r < 0.94 && w >= 4) {
        spawnEnemyAtEdge('quark');
      } else {
        spawnEnemyAtEdge('grunt');
      }
    }
  }
  
  // Periodic grunt march sound when many grunts on screen
  const gruntCount = game.enemies.filter(e => e.active && e.type === 'grunt').length;
  if (gruntCount > 10 && Math.random() < 0.01) SFX.gruntMarch();
  
  // Brain ambient sound
  const brainCount = game.enemies.filter(e => e.active && e.type === 'brain').length;
  if (brainCount > 0 && Math.random() < 0.005) SFX.brainAmbient();
}

// ============================================================================
// 19. RENDERING
// ============================================================================

// Screen shake
game.shakeTimer = 0;
game.shakeIntensity = 0;
game.flashTimer = 0;
game.flashColor = '#ffffff';

function drawWorld(ctx) {
  ctx.save();
  
  // Camera transform
  const zoom = game.camZoom;
  ctx.scale(zoom, zoom);
  
  // Screen shake
  let shakeX = 0, shakeY = 0;
  if (game.shakeTimer > 0) {
    game.shakeTimer -= 1/60;
    const intensity = game.shakeIntensity * (game.shakeTimer / 0.4);
    shakeX = Math.sin(game.time * 50) * intensity;
    shakeY = Math.cos(game.time * 37) * intensity;
  }
  
  ctx.translate(-game.camX + shakeX, -game.camY + shakeY);
  
  // Background grid
  const camL = Math.floor(game.camX / GRID_SIZE) * GRID_SIZE;
  const camT = Math.floor(game.camY / GRID_SIZE) * GRID_SIZE;
  const camR = game.camX + game.width / zoom + GRID_SIZE;
  const camB = game.camY + game.height / zoom + GRID_SIZE;
  
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = camL; x <= camR; x += GRID_SIZE) {
    ctx.moveTo(x, camT); ctx.lineTo(x, camB);
  }
  for (let y = camT; y <= camB; y += GRID_SIZE) {
    ctx.moveTo(camL, y); ctx.lineTo(camR, y);
  }
  ctx.stroke();
  
  // World border (neon glow)
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 4;
  ctx.shadowColor = C.border;
  ctx.shadowBlur = 15;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  ctx.shadowBlur = 0;
  
  // Draw game entities
  drawGems(ctx);
  drawWeapons(ctx);
  drawHumans(ctx);
  drawEnemies(ctx);
  drawProjectiles(ctx);
  drawPlayer(ctx);
  
  // Draw Stompy overlay
  if (stompyActive) {
    const p = game.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    const sz = PLAYER_SIZE * 4;
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5 + Math.sin(game.time * 4) * 0.3;
    ctx.strokeRect(-sz, -sz * 1.2, sz * 2, sz * 2.4);
    // Giant robot body
    ctx.fillStyle = '#ffcc00';
    ctx.globalAlpha = 0.8;
    ctx.fillRect(-sz * 0.8, -sz * 1.0, sz * 1.6, sz * 1.8);
    // Eyes
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(-sz * 0.4, -sz * 0.7, sz * 0.3, sz * 0.2);
    ctx.fillRect(sz * 0.1, -sz * 0.7, sz * 0.3, sz * 0.2);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  
  // Particles
  particles.forEach(p => {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    const s = p.size * alpha;
    ctx.fillRect(p.x - s/2, p.y - s/2, s, s);
  });
  ctx.globalAlpha = 1;
  
  // Floating texts
  for (const ft of floatingTexts) {
    ctx.globalAlpha = ft.life / ft.maxLife;
    ctx.fillStyle = ft.color;
    ctx.font = `bold ${ft.size}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;
  
  ctx.restore();
}

function drawHUD(ctx) {
  const p = game.player;
  const w = game.width;
  const h = game.height;
  
  ctx.save();
  ctx.font = "bold 14px 'Press Start 2P', monospace";
  
  // Score — top left
  ctx.fillStyle = C.textWhite;
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE ${p.score.toLocaleString()}`, 16, 30);
  
  // High score — top center
  ctx.textAlign = 'center';
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillStyle = C.textCyan;
  ctx.fillText(`HI ${game.sessionHigh.toLocaleString()}`, w / 2, 24);
  
  // Wave — top right
  ctx.textAlign = 'right';
  ctx.font = "bold 14px 'Press Start 2P', monospace";
  ctx.fillStyle = C.textWhite;
  ctx.fillText(`WAVE ${game.wave}`, w - 16, 30);
  
  // Human count — under wave, top right
  const humansAlive = game.humans.length;
  const cycleWave = ((game.wave - 1) % 5) + 1;
  ctx.font = "9px 'Press Start 2P', monospace";
  ctx.fillStyle = humansAlive <= 3 ? '#ff4444' : humansAlive <= 8 ? '#ffcc00' : '#44ff44';
  ctx.fillText(`SURVIVORS: ${humansAlive}`, w - 16, 46);
  // Cycle indicator
  ctx.fillStyle = '#888888';
  ctx.font = "7px 'Press Start 2P', monospace";
  ctx.fillText(`CYCLE ${cycleWave}/5`, w - 16, 60);
  // Flash warning when low
  if (humansAlive <= 3 && humansAlive > 0 && Math.floor(game.time * 3) % 2 === 0) {
    ctx.fillStyle = '#ff0000';
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText('!! SAVE THEM !!', w - 16, 74);
  }
  
  // HP bar — bottom left
  const hpBarW = 200;
  const hpBarH = 14;
  const hpX = 16;
  const hpY = h - 50;
  ctx.fillStyle = '#333333';
  ctx.fillRect(hpX, hpY, hpBarW, hpBarH);
  const hpFrac = p.hp / p.maxHp;
  ctx.fillStyle = hpFrac > 0.3 ? C.hpBar : C.hpBarDmg;
  ctx.fillRect(hpX, hpY, hpBarW * hpFrac, hpBarH);
  ctx.strokeStyle = '#666666';
  ctx.strokeRect(hpX, hpY, hpBarW, hpBarH);
  ctx.fillStyle = C.textWhite;
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = 'left';
  ctx.fillText(`HP ${Math.ceil(p.hp)}/${p.maxHp}`, hpX, hpY - 4);
  
  // XP bar — bottom full width
  const xpBarH = 6;
  const xpY = h - 20;
  ctx.fillStyle = '#222222';
  ctx.fillRect(0, xpY, w, xpBarH);
  const xpFrac = p.xp / p.xpToNext;
  ctx.fillStyle = C.xpBar;
  ctx.fillRect(0, xpY, w * xpFrac, xpBarH);
  
  // Level — next to XP bar
  ctx.fillStyle = C.textCyan;
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = 'left';
  ctx.fillText(`LVL ${p.level}`, 16, xpY - 4);
  
  // Active weapons — bottom right
  ctx.textAlign = 'right';
  ctx.font = "7px 'Press Start 2P', monospace";
  let weapY = h - 80;
  for (const w2 of p.weapons) {
    const def = WEAPONS.find(d => d.id === w2.id);
    if (def) {
      ctx.fillStyle = C.textYellow;
      ctx.fillText(`${def.name} L${w2.level}`, w - 16, weapY);
      weapY += 12;
    }
  }
  
  // Stompy timer
  if (stompyActive) {
    ctx.textAlign = 'center';
    ctx.font = "bold 20px 'Press Start 2P', monospace";
    ctx.fillStyle = stompyTimer <= 5 ? '#ff4444' : '#ffcc00';
    ctx.fillText(`STOMPY: ${Math.ceil(stompyTimer)}s`, w / 2, 60);
  }
  
  // Wave announcement
  if (game.waveAnnounce > 0) {
    ctx.textAlign = 'center';
    const scale = 1 + Math.max(0, game.waveAnnounce - 2) * 0.5;
    ctx.font = `bold ${Math.floor(28 * scale)}px 'Press Start 2P', monospace`;
    ctx.fillStyle = game.wave % 5 === 0 ? C.brain : C.textCyan;
    ctx.globalAlpha = Math.min(1, game.waveAnnounce);
    ctx.fillText(`WAVE ${game.wave}`, w / 2, h / 2);
    if (game.wave % 5 === 0) {
      ctx.font = "14px 'Press Start 2P', monospace";
      ctx.fillStyle = C.brainGlow;
      ctx.fillText('BRAIN WAVE', w / 2, h / 2 + 35);
    }
    ctx.globalAlpha = 1;
  }
  
  // ---- HUMAN DIRECTION ARROWS anchored around the player ----
  if (game.humans.length > 0 && game.player.alive) {
    // Player screen position (accounts for camera offset and zoom)
    const psx = (game.player.x - game.camX) * game.camZoom;
    const psy = (game.player.y - game.camY) * game.camZoom;
    const arrowDist = 80; // distance from player on screen
    
    const sorted = game.humans
      .map(h => ({ h, d: dist(game.player.x, game.player.y, h.x, h.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    for (const { h, d: hd } of sorted) {
      if (hd < 100) continue; // skip nearby humans (already visible)
      const a = angle(game.player.x, game.player.y, h.x, h.y);
      const ax = psx + Math.cos(a) * arrowDist;
      const ay = psy + Math.sin(a) * arrowDist;
      const alpha = clamp(1 - hd / 800, 0.3, 0.85);
      
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.globalAlpha = alpha;
      // Arrow — larger, more visible
      ctx.fillStyle = '#44ff44';
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      // Pulsing glow
      ctx.globalAlpha = alpha * 0.3 * (0.5 + Math.sin(game.time * 4) * 0.5);
      ctx.fillStyle = '#88ff88';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  
  // ---- HUMAN DEATH POP — big center-screen count when a human dies ----
  if (game.humanDeathPopTimer > 0) {
    game.humanDeathPopTimer -= 1/60;
    const popAlpha = Math.min(1, game.humanDeathPopTimer / 0.3);
    const popScale = 1 + (1 - popAlpha) * 0.3;
    ctx.save();
    ctx.globalAlpha = popAlpha * 0.9;
    ctx.fillStyle = game.humanDeathPopCount <= 3 ? '#ff0000' : '#ff4444';
    ctx.font = `bold ${Math.floor(36 * popScale)}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${game.humanDeathPopCount} HUMANS LEFT`, game.width / 2, game.height * 0.35);
    if (game.humanDeathPopCount <= 3 && game.humanDeathPopCount > 0) {
      ctx.font = "14px 'Press Start 2P', monospace";
      ctx.fillStyle = '#ff6666';
      ctx.fillText('SAVE THEM!', game.width / 2, game.height * 0.35 + 35);
    }
    ctx.restore();
  }
  
  // Minimap
  drawMinimap(ctx);
  
  ctx.restore();
}

function drawMinimap(ctx) {
  const mmSize = 140;
  const mmX = game.width - mmSize - 12;
  const mmY = 50;
  const scale = mmSize / WORLD_W;
  
  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(mmX, mmY, mmSize, mmSize);
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmSize, mmSize);
  
  // Humans (green dots)
  ctx.fillStyle = '#44ff44';
  for (const h of game.humans) {
    ctx.fillRect(mmX + h.x * scale - 1, mmY + h.y * scale - 1, 2, 2);
  }
  
  // Enemy density (red dots for clusters)
  ctx.fillStyle = 'rgba(255,50,50,0.5)';
  for (const e of game.enemies) {
    if (!e.active || e.type === 'electrode') continue;
    ctx.fillRect(mmX + e.x * scale - 0.5, mmY + e.y * scale - 0.5, 1, 1);
  }
  
  // Player (white dot)
  ctx.fillStyle = '#ffffff';
  const px = mmX + game.player.x * scale;
  const py = mmY + game.player.y * scale;
  ctx.fillRect(px - 2, py - 2, 4, 4);
  
  // Camera viewport rect
  ctx.strokeStyle = '#666666';
  ctx.strokeRect(
    mmX + game.camX * scale,
    mmY + game.camY * scale,
    (game.width / game.camZoom) * scale,
    (game.height / game.camZoom) * scale
  );
}

// ============================================================================
// 20. LEVEL-UP UI
// ============================================================================

function drawLevelUpUI(ctx) {
  const w = game.width;
  const h = game.height;
  
  // Dark overlay
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, w, h);
  
  // Title
  ctx.fillStyle = C.textCyan;
  ctx.font = "bold 20px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  ctx.fillText('LEVEL UP!', w / 2, 80);
  ctx.font = "12px 'Press Start 2P', monospace";
  ctx.fillStyle = C.textWhite;
  ctx.fillText(`Level ${game.player.level}`, w / 2, 110);
  
  // Cards
  const cardW = 220;
  const cardH = 120;
  const gap = 20;
  const totalW = levelUpOptions.length * cardW + (levelUpOptions.length - 1) * gap;
  const startX = (w - totalW) / 2;
  const cardY = h / 2 - cardH / 2;
  
  for (let i = 0; i < levelUpOptions.length; i++) {
    const opt = levelUpOptions[i];
    const cx = startX + i * (cardW + gap);
    const selected = i === levelUpSelection;
    
    // Card background
    if (opt.legendary) {
      ctx.fillStyle = selected ? 'rgba(255,204,0,0.3)' : 'rgba(255,204,0,0.15)';
      ctx.strokeStyle = '#ffcc00';
    } else {
      ctx.fillStyle = selected ? 'rgba(0,229,255,0.2)' : 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = selected ? C.textCyan : '#444444';
    }
    ctx.lineWidth = selected ? 3 : 1;
    ctx.fillRect(cx, cardY, cardW, cardH);
    ctx.strokeRect(cx, cardY, cardW, cardH);
    
    // Content
    ctx.textAlign = 'center';
    const midX = cx + cardW / 2;
    
    // Name
    ctx.fillStyle = opt.legendary ? '#ffcc00' : C.textWhite;
    ctx.font = "bold 10px 'Press Start 2P', monospace";
    ctx.fillText(opt.name, midX, cardY + 25);
    
    // Level
    if (opt.level > 0 && !opt.legendary) {
      ctx.fillStyle = opt.isNew ? '#44ff44' : C.textYellow;
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillText(opt.isNew ? 'NEW' : `Lv ${opt.level}`, midX, cardY + 42);
    }
    
    // Description
    ctx.fillStyle = '#aaaaaa';
    ctx.font = "7px 'Press Start 2P', monospace";
    // Word wrap description
    const words = opt.desc.split(' ');
    let line = '';
    let lineY = cardY + 62;
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > cardW - 20) {
        ctx.fillText(line.trim(), midX, lineY);
        line = word + ' ';
        lineY += 12;
      } else {
        line = test;
      }
    }
    if (line.trim()) ctx.fillText(line.trim(), midX, lineY);
  }
  
  // Controls hint
  ctx.fillStyle = '#666666';
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  ctx.fillText(Input.gamepad ? 'D-PAD: SELECT    A: CONFIRM' : 'ARROWS: SELECT    ENTER: CONFIRM', w / 2, h - 50);
}

function updateLevelUpInput() {
  // Navigate
  if (Input.gpJust(14) || Input.wasPressed('ArrowLeft')) { // D-pad left
    levelUpSelection = Math.max(0, levelUpSelection - 1);
    SFX.menuNav();
  }
  if (Input.gpJust(15) || Input.wasPressed('ArrowRight')) { // D-pad right
    levelUpSelection = Math.min(levelUpOptions.length - 1, levelUpSelection + 1);
    SFX.menuNav();
  }
  
  // Confirm
  if (Input.confirmPressed()) {
    selectLevelUpOption(levelUpOptions[levelUpSelection]);
  }
}

// ============================================================================
// 21. TITLE SCREEN & ATTRACT MODE
// ============================================================================

function drawTitleScreen(ctx) {
  const w = game.width;
  const h = game.height;
  
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  
  // Subtle background grunts wandering
  const t = game.time;
  for (let i = 0; i < 8; i++) {
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = C.grunt;
    const gx = ((t * 20 + i * 300) % (w + 100)) - 50;
    const gy = 200 + Math.sin(t + i * 2) * 100 + i * 50;
    ctx.fillRect(gx - 8, gy - 8, 16, 16);
  }
  ctx.globalAlpha = 1;
  
  // Title — ROBO SURVIVORS
  // Materialization effect on first few seconds
  const titleAge = game.attractTimer;
  ctx.textAlign = 'center';
  
  if (titleAge < 2) {
    // Scatter-converge animation
    const prog = titleAge / 2;
    const title = 'ROBO SURVIVORS';
    ctx.font = "bold 36px 'Press Start 2P', monospace";
    for (let i = 0; i < title.length; i++) {
      const charProg = clamp((prog - i * 0.04) * 3, 0, 1);
      const scatter = (1 - charProg) * 80;
      ctx.globalAlpha = charProg;
      ctx.fillStyle = ['#ffffff', '#00e5ff', '#ff4444'][Math.floor(t * 6 + i) % 3];
      const cx = w / 2 + (i - title.length / 2) * 30 + randF(-scatter, scatter) * (1 - charProg);
      const cy = h * 0.3 + randF(-scatter, scatter) * (1 - charProg);
      ctx.fillText(title[i], cx, cy);
    }
  } else {
    // Steady title with glow
    ctx.fillStyle = C.textWhite;
    ctx.shadowColor = C.textCyan;
    ctx.shadowBlur = 15 + Math.sin(t * 2) * 5;
    ctx.font = "bold 36px 'Press Start 2P', monospace";
    ctx.fillText('ROBO', w / 2, h * 0.28);
    ctx.fillStyle = C.textCyan;
    ctx.fillText('SURVIVORS', w / 2, h * 0.38);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  
  // PRESS START — pulsing
  const pressAlpha = 0.3 + Math.sin(t * Math.PI) * 0.7;
  ctx.globalAlpha = pressAlpha;
  ctx.fillStyle = C.textWhite;
  ctx.font = "16px 'Press Start 2P', monospace";
  ctx.fillText(Input.gamepad ? 'PRESS START' : 'PRESS ENTER', w / 2, h * 0.55);
  ctx.globalAlpha = 1;
  
  // Subtitle
  ctx.fillStyle = '#555555';
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.fillText('INSERT COIN... JUST KIDDING, IT\'S FREE', w / 2, h * 0.62);
  
  // Credits
  ctx.fillStyle = '#333333';
  ctx.font = "7px 'Press Start 2P', monospace";
  ctx.fillText('INSPIRED BY ROBOTRON: 2084 & VAMPIRE SURVIVORS', w / 2, h * 0.90);
}

function drawAttractDemo(ctx) {
  const w = game.width;
  const h = game.height;
  const t = game.attractTimer;
  
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  
  // Simulated gameplay scene (pre-scripted visual, not real game)
  // Background grid scrolling
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 0.5;
  const scroll = t * 30;
  ctx.beginPath();
  for (let x = -GRID_SIZE + (scroll % GRID_SIZE); x < w + GRID_SIZE; x += GRID_SIZE) {
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  }
  for (let y = -GRID_SIZE + (scroll * 0.7 % GRID_SIZE); y < h + GRID_SIZE; y += GRID_SIZE) {
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();
  
  // Fake player moving in a pattern
  const px = w * 0.5 + Math.sin(t * 1.2) * w * 0.25;
  const py = h * 0.5 + Math.cos(t * 0.8) * h * 0.2;
  // Player sprite
  ctx.fillStyle = C.player;
  ctx.fillRect(px - 7, py - 10, 14, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px - 5, py - 16, 10, 7);
  
  // Fake laser shots
  for (let i = 0; i < 5; i++) {
    const bx = px + Math.cos(t * 3 + i) * (50 + i * 40);
    const by = py + Math.sin(t * 3 + i) * (30 + i * 25);
    ctx.fillStyle = C.laser;
    ctx.fillRect(bx - 4, by - 1, 8, 3);
  }
  
  // Fake enemies moving across screen
  for (let i = 0; i < 12; i++) {
    const ex = ((t * 40 + i * 130) % (w + 100)) - 50;
    const ey = 100 + Math.sin(t + i * 1.5) * 80 + (i % 3) * 150;
    ctx.fillStyle = [C.grunt, C.enforcer, C.spheroid, C.quark][i % 4];
    ctx.fillRect(ex - 8, ey - 8, 16, 16);
  }
  
  // Fake humans
  for (let i = 0; i < 4; i++) {
    const hx = 150 + Math.sin(t * 0.5 + i * 2) * 100 + i * 200;
    const hy = h * 0.3 + Math.cos(t * 0.7 + i) * 60 + i * 80;
    ctx.fillStyle = [C.mommy, C.daddy, C.mikey, C.mommy][i];
    ctx.fillRect(hx - 10, hy - 14, 20, 24);
  }
  
  // Fake particle explosions
  for (let i = 0; i < 3; i++) {
    const ex = w * 0.3 + Math.sin(t * 2 + i * 3) * w * 0.3;
    const ey = h * 0.4 + Math.cos(t * 1.5 + i * 2) * h * 0.2;
    ctx.fillStyle = '#ff4444';
    ctx.globalAlpha = 0.3 + Math.sin(t * 5 + i) * 0.3;
    for (let j = 0; j < 5; j++) {
      const px2 = ex + Math.cos(t * 8 + j) * (10 + j * 5);
      const py2 = ey + Math.sin(t * 8 + j) * (10 + j * 5);
      ctx.fillRect(px2 - 2, py2 - 2, 4, 4);
    }
  }
  ctx.globalAlpha = 1;
  
  // "DEMO PLAY" watermark
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.3;
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.textAlign = 'left';
  ctx.fillText('DEMO PLAY', 16, 24);
  ctx.globalAlpha = 1;
  
  // Fake HUD
  ctx.font = "bold 12px 'Press Start 2P', monospace";
  ctx.fillStyle = C.textWhite;
  ctx.textAlign = 'left';
  ctx.fillText('SCORE ' + Math.floor(t * 850).toLocaleString(), 16, h - 20);
  ctx.textAlign = 'right';
  ctx.fillText('WAVE 7', w - 16, 24);
  ctx.fillStyle = '#44ff44';
  ctx.fillText('SURVIVORS: 12', w - 16, 40);
  
  // Press start overlay
  ctx.textAlign = 'center';
  const pressAlpha = 0.2 + Math.sin(t * Math.PI) * 0.4;
  ctx.globalAlpha = pressAlpha;
  ctx.fillStyle = C.textWhite;
  ctx.font = "12px 'Press Start 2P', monospace";
  ctx.fillText(Input.gamepad ? 'PRESS START' : 'PRESS ENTER', w / 2, h - 50);
  ctx.globalAlpha = 1;
}

function getFilteredScores(tier) {
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); weekStart.setHours(0,0,0,0);
  
  let filtered;
  switch (tier) {
    case 0: // daily
      filtered = game.highScores.filter(s => s.timestamp >= todayStart.getTime());
      break;
    case 1: // weekly
      filtered = game.highScores.filter(s => s.timestamp >= weekStart.getTime());
      break;
    case 2: // all-time
    default:
      filtered = [...game.highScores];
      break;
  }
  return filtered.sort((a, b) => b.score - a.score).slice(0, 10);
}

function drawAttractScores(ctx) {
  const w = game.width;
  const h = game.height;
  const t = game.attractTimer;
  const tab = game.attractScoreTab;
  const tabTimer = game.attractScoreTabTimer;
  
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  
  ctx.textAlign = 'center';
  
  // Tab title
  const titles = ["TODAY'S BEST", "THIS WEEK'S BEST", 'ALL TIME LEGENDS'];
  const titleColors = ['#44ff44', '#ffcc00', '#ff4444'];
  ctx.fillStyle = titleColors[tab];
  ctx.font = "bold 20px 'Press Start 2P', monospace";
  ctx.shadowColor = titleColors[tab];
  ctx.shadowBlur = 10;
  ctx.fillText(titles[tab], w / 2, h * 0.1);
  ctx.shadowBlur = 0;
  
  // Get scores for this tier
  const scores = getFilteredScores(tab);
  
  if (scores.length === 0) {
    ctx.fillStyle = '#666666';
    ctx.font = "12px 'Press Start 2P', monospace";
    ctx.fillText('NO SCORES YET', w / 2, h * 0.4);
    ctx.fillStyle = '#888888';
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText('BE THE FIRST!', w / 2, h * 0.48);
  } else {
    // Header
    ctx.fillStyle = '#666666';
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText('RANK   INITIALS      SCORE       WAVE  LVL', w / 2, h * 0.17);
    
    // Entries (staggered fade-in)
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      const rowDelay = i * 0.1;
      const rowAlpha = clamp((tabTimer - rowDelay) * 5, 0, 1);
      if (rowAlpha <= 0) continue;
      
      ctx.globalAlpha = rowAlpha;
      const y = h * 0.22 + i * 28;
      const isTop = i === 0;
      
      // Rank
      ctx.fillStyle = isTop ? titleColors[tab] : C.textWhite;
      ctx.font = `${isTop ? 'bold ' : ''}10px 'Press Start 2P', monospace`;
      if (isTop) {
        ctx.shadowColor = titleColors[tab];
        ctx.shadowBlur = 8;
      }
      
      const row = `${(i + 1).toString().padStart(2, ' ')}.  ${s.initials}    ${s.score.toLocaleString().padStart(10, ' ')}    W${s.wave}   L${s.level}`;
      ctx.fillText(row, w / 2, y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
  
  // Tab indicator dots
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i === tab ? '#ffffff' : '#444444';
    ctx.beginPath();
    ctx.arc(w / 2 - 20 + i * 20, h * 0.92, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Press start
  const pressAlpha = 0.2 + Math.sin(t * Math.PI) * 0.4;
  ctx.globalAlpha = pressAlpha;
  ctx.fillStyle = C.textWhite;
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillText(Input.gamepad ? 'PRESS START' : 'PRESS ENTER', w / 2, h * 0.97);
  ctx.globalAlpha = 1;
}

function drawGameOver(ctx) {
  const w = game.width;
  const h = game.height;
  const p = game.player;
  
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(0, 0, w, h);
  
  ctx.textAlign = 'center';
  
  // GAME OVER + reason
  ctx.fillStyle = '#ff4444';
  ctx.font = "bold 32px 'Press Start 2P', monospace";
  ctx.fillText('GAME OVER', w / 2, h * 0.15);
  
  // Reason
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillStyle = '#ff8888';
  if (game.gameOverReason === 'humans_lost') {
    ctx.fillText('ALL HUMANS WERE LOST', w / 2, h * 0.22);
  } else {
    ctx.fillText('YOU WERE DESTROYED', w / 2, h * 0.22);
  }
  
  // Stats
  ctx.fillStyle = C.textWhite;
  ctx.font = "12px 'Press Start 2P', monospace";
  const stats = [
    `SCORE: ${p.score.toLocaleString()}`,
    `WAVE: ${game.wave}`,
    `LEVEL: ${p.level}`,
    `HUMANS SAVED: ${p.totalRescues}`,
    `HUMANS LOST: ${game.waveHumansLost}`,
    `ENEMIES DESTROYED: ${p.totalKills}`,
    `TIME: ${Math.floor(game.runTime / 60)}m ${Math.floor(game.runTime % 60)}s`,
  ];
  stats.forEach((s, i) => {
    ctx.fillText(s, w / 2, h * 0.35 + i * 28);
  });
  
  // New high score?
  if (p.score > game.sessionHigh) {
    game.sessionHigh = p.score;
    ctx.fillStyle = C.textYellow;
    ctx.font = "bold 14px 'Press Start 2P', monospace";
    ctx.fillText('NEW HIGH SCORE!', w / 2, h * 0.72);
  }
  
  // Restart prompt
  const pressAlpha = 0.3 + Math.sin(game.time * Math.PI) * 0.7;
  ctx.globalAlpha = pressAlpha;
  ctx.fillStyle = C.textWhite;
  ctx.font = "12px 'Press Start 2P', monospace";
  ctx.fillText(Input.gamepad ? 'PRESS START TO PLAY AGAIN' : 'PRESS ENTER TO PLAY AGAIN', w / 2, h * 0.85);
  ctx.globalAlpha = 1;
}

// ============================================================================
// 21b. HIGH SCORE INITIALS ENTRY
// ============================================================================

const INITIALS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!? ';
let hsEntry = {
  active: false,
  slots: [0, 0, 0], // indices into INITIALS_CHARS
  currentSlot: 0,
  holdTimer: 0,
  holdDelay: 0.3,
  timeoutTimer: 30,
};

function startHighScoreEntry() {
  hsEntry.active = true;
  hsEntry.slots = [0, 0, 0]; // default to 'A','A','A'
  hsEntry.currentSlot = 0;
  hsEntry.holdTimer = 0;
  hsEntry.timeoutTimer = 30;
  game.state = 'highscore_entry';
  SFX.levelUp(); // celebration sound
}

function updateHighScoreEntry(dt) {
  hsEntry.timeoutTimer -= dt;
  if (hsEntry.timeoutTimer <= 0) {
    submitHighScore();
    return;
  }
  
  // Navigate letters
  let moved = false;
  // D-pad up or left stick up = next letter
  if (Input.gpJust(12) || Input.wasPressed('ArrowUp')) {
    hsEntry.slots[hsEntry.currentSlot] = (hsEntry.slots[hsEntry.currentSlot] + 1) % INITIALS_CHARS.length;
    moved = true;
  }
  // D-pad down or left stick down = prev letter
  if (Input.gpJust(13) || Input.wasPressed('ArrowDown')) {
    hsEntry.slots[hsEntry.currentSlot] = (hsEntry.slots[hsEntry.currentSlot] - 1 + INITIALS_CHARS.length) % INITIALS_CHARS.length;
    moved = true;
  }
  
  // Hold-to-repeat for stick
  if (Input.gamepad) {
    const gp = Input.gamepad;
    const ly = gp.axes[1];
    if (Math.abs(ly) > 0.5) {
      hsEntry.holdTimer -= dt;
      if (hsEntry.holdTimer <= 0) {
        hsEntry.holdTimer = 0.08; // 12.5 chars/sec when holding
        if (ly < -0.5) {
          hsEntry.slots[hsEntry.currentSlot] = (hsEntry.slots[hsEntry.currentSlot] + 1) % INITIALS_CHARS.length;
          moved = true;
        } else {
          hsEntry.slots[hsEntry.currentSlot] = (hsEntry.slots[hsEntry.currentSlot] - 1 + INITIALS_CHARS.length) % INITIALS_CHARS.length;
          moved = true;
        }
      }
    } else {
      hsEntry.holdTimer = hsEntry.holdDelay;
    }
  }
  
  if (moved) SFX.menuNav();
  
  // Direct keyboard letter typing
  for (let code = 65; code <= 90; code++) {
    if (Input.wasPressed('Key' + String.fromCharCode(code))) {
      hsEntry.slots[hsEntry.currentSlot] = code - 65; // A=0, B=1, etc.
      if (hsEntry.currentSlot < 2) hsEntry.currentSlot++;
      SFX.menuNav();
    }
  }
  for (let code = 48; code <= 57; code++) {
    if (Input.wasPressed('Digit' + String.fromCharCode(code))) {
      hsEntry.slots[hsEntry.currentSlot] = 26 + (code - 48); // 0-9 after letters
      if (hsEntry.currentSlot < 2) hsEntry.currentSlot++;
      SFX.menuNav();
    }
  }
  
  // Confirm current slot (A button / Enter)
  if (Input.confirmPressed()) {
    if (hsEntry.currentSlot < 2) {
      hsEntry.currentSlot++;
      SFX.menuConfirm();
    } else {
      submitHighScore();
    }
  }
  
  // Back (B button / Backspace)
  if (Input.backPressed()) {
    if (hsEntry.currentSlot > 0) {
      hsEntry.currentSlot--;
      SFX.menuNav();
    }
  }
}

function submitHighScore() {
  const initials = hsEntry.slots.map(i => INITIALS_CHARS[i]).join('');
  const entry = {
    initials,
    score: game.player.score,
    wave: game.wave,
    level: game.player.level,
    humansRescued: game.player.totalRescues,
    enemiesKilled: game.player.totalKills,
    timeSurvived: Math.floor(game.runTime),
    timestamp: Date.now(),
  };
  
  game.highScores.push(entry);
  game.highScores.sort((a, b) => b.score - a.score);
  if (game.highScores.length > 20) game.highScores.length = 20;
  
  // Try to save (works on Droplet, fails silently in sandbox)
  try {
    const _ls = window['local' + 'Storage'];
    if (_ls) _ls.setItem('robo_survivors_scores', JSON.stringify(game.highScores));
  } catch (e) { }
  
  if (game.player.score > game.sessionHigh) game.sessionHigh = game.player.score;
  
  hsEntry.active = false;
  game.state = 'gameover';
  SFX.menuConfirm();
}

function drawHighScoreEntry(ctx) {
  const w = game.width;
  const h = game.height;
  
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, w, h);
  
  ctx.textAlign = 'center';
  
  // Title
  ctx.fillStyle = C.textYellow;
  ctx.font = "bold 24px 'Press Start 2P', monospace";
  const titlePulse = 1 + Math.sin(game.time * 4) * 0.05;
  ctx.save();
  ctx.translate(w / 2, h * 0.15);
  ctx.scale(titlePulse, titlePulse);
  ctx.fillText('NEW HIGH SCORE!', 0, 0);
  ctx.restore();
  
  // Score
  ctx.fillStyle = C.textWhite;
  ctx.font = "bold 18px 'Press Start 2P', monospace";
  ctx.fillText(game.player.score.toLocaleString(), w / 2, h * 0.25);
  
  // Wave/Level
  ctx.fillStyle = C.textCyan;
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillText(`WAVE ${game.wave}  LEVEL ${game.player.level}`, w / 2, h * 0.32);
  
  // Initials entry
  ctx.fillStyle = C.textWhite;
  ctx.font = "12px 'Press Start 2P', monospace";
  ctx.fillText('ENTER YOUR INITIALS', w / 2, h * 0.42);
  
  // The 3 slots
  const slotW = 50;
  const slotGap = 20;
  const totalW = slotW * 3 + slotGap * 2;
  const startX = (w - totalW) / 2;
  const slotY = h * 0.52;
  
  for (let i = 0; i < 3; i++) {
    const sx = startX + i * (slotW + slotGap);
    const isActive = i === hsEntry.currentSlot;
    const char = INITIALS_CHARS[hsEntry.slots[i]];
    
    // Slot background
    ctx.fillStyle = isActive ? 'rgba(0,229,255,0.2)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(sx, slotY - 5, slotW, 50);
    ctx.strokeStyle = isActive ? C.textCyan : '#444444';
    ctx.lineWidth = isActive ? 3 : 1;
    ctx.strokeRect(sx, slotY - 5, slotW, 50);
    
    // Character
    ctx.fillStyle = isActive ? C.textCyan : C.textWhite;
    ctx.font = "bold 28px 'Press Start 2P', monospace";
    ctx.fillText(char, sx + slotW / 2, slotY + 33);
    
    // Up/down arrows on active slot
    if (isActive) {
      ctx.fillStyle = C.textCyan;
      ctx.font = "10px 'Press Start 2P', monospace";
      const arrowBob = Math.sin(game.time * 6) * 3;
      ctx.fillText('▲', sx + slotW / 2, slotY - 12 + arrowBob);
      ctx.fillText('▼', sx + slotW / 2, slotY + 60 - arrowBob);
    }
  }
  
  // Underline for active slot
  const activeX = startX + hsEntry.currentSlot * (slotW + slotGap);
  ctx.fillStyle = C.textCyan;
  ctx.globalAlpha = 0.5 + Math.sin(game.time * 8) * 0.5;
  ctx.fillRect(activeX + 5, slotY + 42, slotW - 10, 3);
  ctx.globalAlpha = 1;
  
  // Controls hint
  ctx.fillStyle = '#666666';
  ctx.font = "7px 'Press Start 2P', monospace";
  if (Input.gamepad) {
    ctx.fillText('D-PAD: CHANGE LETTER     A: CONFIRM     B: BACK', w / 2, h * 0.75);
  } else {
    ctx.fillText('UP/DOWN: CHANGE     ENTER: CONFIRM     BACKSPACE: BACK', w / 2, h * 0.75);
    ctx.fillText('OR TYPE A LETTER KEY DIRECTLY', w / 2, h * 0.75 + 16);
  }
  
  // Timeout
  ctx.fillStyle = '#444444';
  ctx.font = "7px 'Press Start 2P', monospace";
  ctx.fillText(`AUTO-SUBMIT IN ${Math.ceil(hsEntry.timeoutTimer)}s`, w / 2, h * 0.88);
}

// ============================================================================
// 22. GAME INITIALIZATION & MAIN LOOP
// ============================================================================

function resetGame() {
  // Clear entities
  game.enemies = [];
  game.humans = [];
  game.playerBullets.items.forEach(b => b.active = false);
  game.enemyBullets.items.forEach(b => b.active = false);
  game.gems.items.forEach(g => g.active = false);
  particles.items.forEach(p => p.active = false);
  floatingTexts.length = 0;
  
  // Reset player
  const p = game.player;
  p.x = WORLD_W / 2; p.y = WORLD_H / 2;
  p.hp = PLAYER_MAX_HP; p.maxHp = PLAYER_MAX_HP;
  p.speed = PLAYER_SPEED;
  p.alive = true; p.iframes = 2.0;
  p.xp = 0; p.level = 1; p.xpToNext = 5;
  p.score = 0; p.rescueCount = 0; p.totalRescues = 0; p.totalKills = 0;
  p.fireCooldown = 0; p.facing = 0; p.animFrame = 0; p.animTimer = 0;
  p.weapons = []; p.passives = [];
  recalcPassiveStats();
  
  // Reset game state
  game.wave = 0;
  game.waveAnnounce = 0;
  game.betweenWaves = false;
  game.waveHumansStart = 0;
  game.waveHumansLost = 0;
  game.gameOverReason = '';
  game.cycleSurvivorCount = 0;
  game.runTime = 0;
  game.nextHpRestore = 25000;
  game.powerScore = 0;
  stompyActive = false;
  stompyTimer = 0;
  game.camZoom = 1.0;
  resetWeaponState();
  
  // Camera
  game.camX = p.x - game.width / 2;
  game.camY = p.y - game.height / 2;
  
  // Start wave 1
  game.state = 'playing';
  startNextWave();
}

function startGame() {
  initAudio();
  resumeAudio();
  resetGame();
  SFX.gameStart();
}

function init() {
  game.canvas = document.getElementById('gameCanvas');
  game.ctx = game.canvas.getContext('2d');
  
  // Set canvas size
  function resize() {
    game.canvas.width = window.innerWidth;
    game.canvas.height = window.innerHeight;
    game.width = game.canvas.width;
    game.height = game.canvas.height;
  }
  resize();
  window.addEventListener('resize', resize);
  
  Input.init();
  
  // Try loading high scores (works on Droplet, in-memory only in sandbox)
  try {
    const _ls = window['local' + 'Storage'];
    if (_ls) {
      const saved = _ls.getItem('robo_survivors_scores');
      if (saved) game.highScores = JSON.parse(saved);
    }
  } catch (e) { /* sandbox — in memory only */ }
  
  game.state = 'title';
  game.attractTimer = 0;
  
  // Start game loop
  let lastTime = 0;
  let accumulator = 0;
  
  function gameLoop(timestamp) {
    const delta = timestamp - lastTime;
    lastTime = timestamp;
    accumulator += delta;
    
    // Cap accumulator to prevent spiral of death
    if (accumulator > 200) accumulator = 200;
    
    // Input
    Input.update();
    
    // Fixed timestep updates
    while (accumulator >= TICK_RATE) {
      const dt = TICK_RATE / 1000;
      game.time += dt;
      
      switch (game.state) {
        case 'title':
          game.attractTimer += dt;
          if (Input.startPressed()) { startGame(); break; }
          // Attract mode cycle: title 60s -> demo 30s -> scores 30s -> title
          if (game.attractPhase === 0 && game.attractTimer > 60) {
            game.attractPhase = 1; game.attractTimer = 0; // -> demo
          } else if (game.attractPhase === 1 && game.attractTimer > 30) {
            game.attractPhase = 2; game.attractTimer = 0; game.attractScoreTab = 0; game.attractScoreTabTimer = 0; // -> scores
          } else if (game.attractPhase === 2 && game.attractTimer > 30) {
            game.attractPhase = 0; game.attractTimer = 0; // -> title
          }
          // Score tab cycling (10s each: daily, weekly, all-time)
          if (game.attractPhase === 2) {
            game.attractScoreTabTimer += dt;
            if (game.attractScoreTabTimer > 10) {
              game.attractScoreTabTimer = 0;
              game.attractScoreTab = (game.attractScoreTab + 1) % 3;
            }
          }
          break;
        case 'highscore_entry':
          updateHighScoreEntry(dt);
          break;
          
        case 'playing':
          game.runTime += dt;
          updatePlayer(dt);
          updateEnemies(dt);
          updateHumans(dt);
          updateProjectiles(dt);
          updateGems(dt);
          updateWeapons(dt);
          updateStompy(dt);
          updateWaveSystem(dt);
          updateHeartbeat(dt);
          updateCamera(dt);
          
          // Update particles
          particles.forEach(p => {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 50 * dt; // slight gravity
            p.life -= dt;
            if (p.life <= 0) p.active = false;
          });
          
          // Update floating texts
          for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const ft = floatingTexts[i];
            ft.y += ft.vy * dt;
            ft.life -= dt;
            if (ft.life <= 0) floatingTexts.splice(i, 1);
          }
          
          // Pause
          if (Input.gpJust(9) || Input.wasPressed('Escape')) {
            game.state = 'paused';
          }
          break;
          
        case 'paused':
          if (Input.startPressed() || Input.wasPressed('Escape')) {
            game.state = 'playing';
          }
          break;
          
        case 'levelup':
          updateLevelUpInput();
          break;
          
        case 'gameover':
          game.attractTimer += dt;
          game.attractReturnTimer -= dt;
          if (Input.startPressed()) { startGame(); break; }
          // Return to attract mode after 30s idle on gameover
          if (game.attractReturnTimer <= 0) {
            game.state = 'title';
            game.attractPhase = 0;
            game.attractTimer = 0;
          }
          break;
      }
      
      Input.endFrame();
      accumulator -= TICK_RATE;
    }
    
    // Render
    const ctx = game.ctx;
    ctx.clearRect(0, 0, game.width, game.height);
    
    switch (game.state) {
      case 'title':
        if (game.attractPhase === 0) {
          drawTitleScreen(ctx);
        } else if (game.attractPhase === 1) {
          drawAttractDemo(ctx);
        } else if (game.attractPhase === 2) {
          drawAttractScores(ctx);
        }
        break;
      case 'highscore_entry':
        drawWorld(ctx);
        drawHighScoreEntry(ctx);
        break;
        
      case 'playing':
      case 'paused':
      case 'levelup':
        drawWorld(ctx);
        drawHUD(ctx);
        if (game.state === 'paused') {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(0, 0, game.width, game.height);
          ctx.fillStyle = C.textWhite;
          ctx.font = "bold 24px 'Press Start 2P', monospace";
          ctx.textAlign = 'center';
          ctx.fillText('PAUSED', game.width / 2, game.height / 2);
          ctx.font = "10px 'Press Start 2P', monospace";
          ctx.fillText(Input.gamepad ? 'PRESS START TO RESUME' : 'PRESS ESC TO RESUME', game.width / 2, game.height / 2 + 40);
        }
        if (game.state === 'levelup') {
          drawLevelUpUI(ctx);
        }
        break;
        
      case 'gameover':
        drawWorld(ctx);
        drawGameOver(ctx);
        break;
    }
    
    // Screen flash
    if (game.flashTimer > 0) {
      game.flashTimer -= 1/60;
      ctx.fillStyle = game.flashColor;
      ctx.globalAlpha = game.flashTimer / 0.3;
      ctx.fillRect(0, 0, game.width, game.height);
      ctx.globalAlpha = 1;
    }
    
    requestAnimationFrame(gameLoop);
  }
  
  requestAnimationFrame(gameLoop);
}

// ============================================================================
// START
// ============================================================================

// Wait for fonts to load
document.fonts.ready.then(() => {
  init();
});
