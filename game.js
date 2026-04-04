// ============================================================================
// ROBO SURVIVORS — Twin-Stick Shooter Roguelike
// Pure vanilla JS + HTML5 Canvas + Web Audio API + Gamepad API
// ============================================================================

'use strict';

// ============================================================================
// 1. CONSTANTS & CONFIGURATION
// ============================================================================

const WORLD_W = 8000;
const WORLD_H = 8000;
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
  masterGain.gain.value = 0.7;
  masterGain.connect(audioCtx.destination);
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.8;
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
    const f = 880 + randF(-20, 20);
    playTone(f, 0.06, 'square', 0.12, 660);
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
};

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
  
  // Enemies
  enemies: [],
  
  // Humans
  humans: [],
  
  // Projectiles
  playerBullets: new Pool(() => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, prevX: 0, prevY: 0,
  }), 200),
  
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
  
  // Attract mode
  attractPhase: 0, // 0=title, 1=demo, 2=scores
  attractTimer: 0,
  
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
    emitParticles(p.x, p.y, 30, C.player, 20, 200, 1.0, 4);
    emitParticles(p.x, p.y, 20, '#ffffff', 15, 150, 0.8, 3);
    SFX.playerDeath();
    game.shakeTimer = 0.4;
    game.shakeIntensity = 8;
    setTimeout(() => { game.state = 'gameover'; }, 1500);
  }
}

function drawPlayer(ctx) {
  const p = game.player;
  if (!p.alive) return;
  
  // Invincibility flicker
  if (p.iframes > 0 && Math.floor(p.iframes * 10) % 2 === 0) return;
  
  ctx.save();
  ctx.translate(p.x, p.y);
  
  // Simple humanoid sprite
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
  
  // Gun direction indicator
  ctx.strokeStyle = C.laserGlow;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(p.facing) * s * 1.2, Math.sin(p.facing) * s * 1.2);
  ctx.stroke();
  
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
      e.size = 10; e.color = C.grunt;
      e.points = 100; e.gemType = 'small';
      break;
    case 'hulk':
      e.hp = 9999; e.maxHp = 9999; e.speed = 40;
      e.size = 18; e.color = C.hulk;
      e.points = 0; e.gemType = 'none';
      e.special.invincible = true;
      break;
    case 'electrode':
      e.hp = 1; e.speed = 0;
      e.size = 8; e.color = C.electrode;
      e.points = 25; e.gemType = 'small';
      e.special.static = true;
      e.special.colorTimer = 0;
      break;
    case 'spheroid':
      e.hp = 2; e.speed = 60;
      e.size = 14; e.color = C.spheroid;
      e.points = 1000; e.gemType = 'large';
      e.special.spawnTimer = randF(3, 6);
      e.special.pulseTimer = 0;
      break;
    case 'enforcer':
      e.hp = 1; e.speed = 100;
      e.size = 8; e.color = C.enforcer;
      e.points = 150; e.gemType = 'small';
      e.special.fireTimer = randF(1, 3);
      e.special.jitterX = 0; e.special.jitterY = 0;
      break;
    case 'quark':
      e.hp = 2; e.speed = 70;
      e.size = 12; e.color = C.quark;
      e.points = 1000; e.gemType = 'large';
      e.special.spawnTimer = randF(3, 6);
      e.special.spinAngle = 0;
      break;
    case 'tank':
      e.hp = 2; e.speed = 50;
      e.size = 14; e.color = C.tank;
      e.points = 200; e.gemType = 'med';
      e.special.fireTimer = randF(2, 4);
      e.special.turretAngle = 0;
      break;
    case 'brain':
      e.hp = 3; e.speed = 65;
      e.size = 14; e.color = C.brain;
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
        // Chase player
        if (d > 0) {
          e.vx = (dx / d) * e.speed;
          e.vy = (dy / d) * e.speed;
        }
        break;
      }
      case 'hulk': {
        // Slow chase player, also goes toward nearest human
        let tx = p.x, ty = p.y;
        let nearestHumanDist = Infinity;
        for (const h of game.humans) {
          const hd = dist(e.x, e.y, h.x, h.y);
          if (hd < nearestHumanDist) {
            nearestHumanDist = hd;
            tx = h.x; ty = h.y;
          }
        }
        if (nearestHumanDist < 400) {
          // Go for human
        } else {
          tx = p.x; ty = p.y;
        }
        const hdx = tx - e.x, hdy = ty - e.y;
        const hd2 = Math.hypot(hdx, hdy);
        if (hd2 > 0) {
          e.vx = (hdx / hd2) * e.speed;
          e.vy = (hdy / hd2) * e.speed;
        }
        break;
      }
      case 'electrode': {
        // Static — no movement
        e.special.colorTimer += dt;
        e.vx = 0; e.vy = 0;
        break;
      }
      case 'spheroid': {
        // Float semi-randomly
        if (e.animTimer > 1.5) {
          e.vx = randF(-1, 1) * e.speed;
          e.vy = randF(-1, 1) * e.speed;
          e.animTimer = 0;
        }
        // Spawn enforcers
        e.special.spawnTimer -= dt;
        e.special.pulseTimer += dt;
        if (e.special.spawnTimer <= 0) {
          const enf = createEnemy('enforcer', e.x + randF(-20, 20), e.y + randF(-20, 20));
          enf.spawnTimer = 0.3;
          game.enemies.push(enf);
          e.special.spawnTimer = randF(4, 8);
          game.waveEnemiesTotal++;
        }
        break;
      }
      case 'enforcer': {
        // Erratic diagonal movement
        e.special.jitterX += randF(-500, 500) * dt;
        e.special.jitterY += randF(-500, 500) * dt;
        e.special.jitterX *= 0.95;
        e.special.jitterY *= 0.95;
        if (d > 0) {
          e.vx = (dx / d) * e.speed * 0.5 + e.special.jitterX;
          e.vy = (dy / d) * e.speed * 0.5 + e.special.jitterY;
        }
        // Fire sparks
        e.special.fireTimer -= dt;
        if (e.special.fireTimer <= 0 && d < 600) {
          fireEnemyBullet(e.x, e.y, p.x, p.y, 300, 10, 'spark');
          e.special.fireTimer = randF(1.5, 3);
        }
        break;
      }
      case 'quark': {
        // Swirling movement
        e.special.spinAngle += dt * 3;
        e.vx = Math.cos(e.special.spinAngle) * e.speed + (dx / (d || 1)) * 20;
        e.vy = Math.sin(e.special.spinAngle) * e.speed + (dy / (d || 1)) * 20;
        // Spawn tanks
        e.special.spawnTimer -= dt;
        if (e.special.spawnTimer <= 0) {
          const t = createEnemy('tank', e.x + randF(-30, 30), e.y + randF(-30, 30));
          t.spawnTimer = 0.5;
          game.enemies.push(t);
          e.special.spawnTimer = randF(5, 9);
          game.waveEnemiesTotal++;
        }
        break;
      }
      case 'tank': {
        // Slow chase + fire bouncing shells
        if (d > 0) {
          e.vx = (dx / d) * e.speed;
          e.vy = (dy / d) * e.speed;
        }
        e.special.turretAngle = Math.atan2(dy, dx);
        e.special.fireTimer -= dt;
        if (e.special.fireTimer <= 0 && d < 700) {
          const b = fireEnemyBullet(e.x, e.y, p.x, p.y, 250, 10, 'shell');
          if (b) { b.maxBounces = 1; b.bounces = 0; }
          e.special.fireTimer = randF(2.5, 4.5);
        }
        break;
      }
      case 'brain': {
        // Hunt humans first, then player
        e.special.shimmerTimer += dt;
        let target = null;
        let nearDist = Infinity;
        for (const h of game.humans) {
          const bd = dist(e.x, e.y, h.x, h.y);
          if (bd < nearDist) { nearDist = bd; target = h; }
        }
        if (target && nearDist < 500) {
          const bdx = target.x - e.x, bdy = target.y - e.y;
          const bd = Math.hypot(bdx, bdy);
          e.vx = (bdx / bd) * e.speed;
          e.vy = (bdy / bd) * e.speed;
          // Capture human on contact
          if (nearDist < e.size + 10) {
            convertHumanToProg(target);
          }
        } else {
          if (d > 0) {
            e.vx = (dx / d) * e.speed;
            e.vy = (dy / d) * e.speed;
          }
        }
        // Fire cruise missiles
        e.special.fireTimer -= dt;
        if (e.special.fireTimer <= 0 && d < 600) {
          const b = fireEnemyBullet(e.x, e.y, p.x, p.y, 180, 15, 'cruise');
          e.special.fireTimer = randF(3, 5);
        }
        break;
      }
      case 'prog': {
        // Aggressively chase player
        e.special.glitchTimer += dt;
        if (d > 0) {
          e.vx = (dx / d) * e.speed;
          e.vy = (dy / d) * e.speed;
        }
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
          // Electrodes: instant big damage
          damagePlayer(30);
        } else if (e.special.invincible) {
          // Hulk: push back, damage
          damagePlayer(15);
        } else {
          damagePlayer(10);
        }
      }
    }
    
    // Hulk kills humans
    if (e.type === 'hulk') {
      for (let j = game.humans.length - 1; j >= 0; j--) {
        const h = game.humans[j];
        if (dist(e.x, e.y, h.x, h.y) < e.size + 8) {
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
  
  SFX.robotExplode();
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
      // Scatter pixels effect
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + game.time * 5;
        const dist = e.size * (1 - prog) * 2;
        ctx.fillStyle = e.color;
        ctx.fillRect(
          Math.cos(angle) * dist - 2,
          Math.sin(angle) * dist - 2,
          4, 4
        );
      }
      ctx.restore();
      continue;
    }
    
    // Flash on damage
    if (e.special._flashTimer > 0) {
      e.special._flashTimer -= 1/60;
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = e.color;
    }
    
    const s = e.size;
    
    switch (e.type) {
      case 'grunt': {
        // Simple walking humanoid
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
        ctx.fillStyle = C.gruntDark;
        const legOff = Math.sin(e.animTimer * 8) * 3;
        ctx.fillRect(-s * 0.4, s * 0.3, s * 0.3, s * 0.4 + legOff);
        ctx.fillRect(s * 0.1, s * 0.3, s * 0.3, s * 0.4 - legOff);
        break;
      }
      case 'hulk': {
        // Large chunky
        const pulse = 1 + Math.sin(game.time * 2) * 0.05;
        ctx.scale(pulse, pulse);
        ctx.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
        ctx.fillStyle = C.hulkArm;
        ctx.fillRect(-s * 0.8, -s * 0.2, s * 0.25, s * 0.6);
        ctx.fillRect(s * 0.55, -s * 0.2, s * 0.25, s * 0.6);
        break;
      }
      case 'electrode': {
        // Pulsating hazard
        const t = e.special.colorTimer;
        ctx.fillStyle = Math.floor(t * 4) % 2 === 0 ? C.electrode : C.electrodePulse;
        const ep = 1 + Math.sin(t * 8) * 0.15;
        ctx.scale(ep, ep);
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.fillStyle = Math.floor(t * 4) % 2 === 0 ? C.electrodePulse : C.electrode;
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
        break;
      }
      case 'spheroid': {
        // Pulsating circle
        const sp = 0.8 + Math.sin(e.special.pulseTimer * 3) * 0.4;
        ctx.scale(sp, sp);
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.3 + Math.sin(e.special.pulseTimer * 3) * 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'enforcer': {
        // Angular diamond
        ctx.rotate(e.animTimer * 2);
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s, 0);
        ctx.lineTo(0, s); ctx.lineTo(-s, 0);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'quark': {
        // Spinning diamond with color cycling
        const qcolors = ['#ff4400', '#ff8800', '#ffcc00'];
        ctx.fillStyle = qcolors[Math.floor(game.time * 6) % 3];
        ctx.rotate(e.special.spinAngle);
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s, 0);
        ctx.lineTo(0, s); ctx.lineTo(-s, 0);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'tank': {
        // Rectangle with turret
        ctx.fillRect(-s * 0.6, -s * 0.4, s * 1.2, s * 0.8);
        ctx.strokeStyle = '#44cc44';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(e.special.turretAngle) * s, Math.sin(e.special.turretAngle) * s);
        ctx.stroke();
        break;
      }
      case 'brain': {
        // Brain blob with shimmer
        const wobble = Math.sin(e.special.shimmerTimer * 4) * 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, s + wobble, s - wobble * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Shimmer highlight
        ctx.fillStyle = C.brainGlow;
        ctx.globalAlpha = 0.3 + Math.sin(e.special.shimmerTimer * 6) * 0.3;
        ctx.beginPath();
        ctx.ellipse(-s * 0.3, -s * 0.2, s * 0.3, s * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        // Wrinkle lines
        ctx.strokeStyle = '#ffccff';
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-s * 0.4, 0); ctx.quadraticCurveTo(0, -s * 0.4, s * 0.4, 0);
        ctx.stroke();
        break;
      }
      case 'prog': {
        // Glitchy human
        const glitch = Math.sin(e.special.glitchTimer * 15) > 0.7 ? randF(-3, 3) : 0;
        ctx.translate(glitch, 0);
        ctx.fillStyle = Math.floor(e.special.glitchTimer * 8) % 2 === 0 ? C.prog : '#ff4444';
        ctx.fillRect(-s * 0.4, -s * 0.6, s * 0.8, s * 1.2);
        ctx.fillStyle = '#440000';
        ctx.fillRect(-s * 0.3, -s * 0.8, s * 0.6, s * 0.3);
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
  const sizes = { mommy: 9, daddy: 10, mikey: 7 };
  
  for (let i = 0; i < count; i++) {
    const type = types[randI(0, 2)];
    const x = randF(200, WORLD_W - 200);
    const y = randF(200, WORLD_H - 200);
    // Don't spawn on player
    if (dist(x, y, game.player.x, game.player.y) < 200) continue;
    game.humans.push({
      type, x, y, vx: 0, vy: 0,
      color: colors[type], size: sizes[type],
      wanderTimer: 0, alive: true,
    });
  }
}

function updateHumans(dt) {
  const p = game.player;
  for (let i = game.humans.length - 1; i >= 0; i--) {
    const h = game.humans[i];
    if (!h.alive) { game.humans.splice(i, 1); continue; }
    
    // Wander
    h.wanderTimer -= dt;
    if (h.wanderTimer <= 0) {
      h.vx = randF(-30, 30);
      h.vy = randF(-30, 30);
      h.wanderTimer = randF(1, 3);
    }
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.x = clamp(h.x, 50, WORLD_W - 50);
    h.y = clamp(h.y, 50, WORLD_H - 50);
    
    // Rescue on player contact
    if (p.alive && dist(h.x, h.y, p.x, p.y) < PLAYER_SIZE + h.size) {
      rescueHuman(h, i);
    }
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
  emitParticles(h.x, h.y, 5, h.color, 10, 60, 0.4, 2);
  SFX.humanDeath();
}

function convertHumanToProg(h) {
  const idx = game.humans.indexOf(h);
  if (idx < 0) return;
  h.alive = false;
  game.humans.splice(idx, 1);
  
  // Spawn a Prog at the human's location
  const prog = createEnemy('prog', h.x, h.y);
  prog.spawnTimer = 0.3;
  game.enemies.push(prog);
  game.waveEnemiesTotal++;
  game.waveEnemiesRemaining++;
  
  emitParticles(h.x, h.y, 8, '#ff2222', 15, 80, 0.3, 3);
}

function drawHumans(ctx) {
  for (const h of game.humans) {
    if (!h.alive) continue;
    ctx.save();
    ctx.translate(h.x, h.y);
    
    const s = h.size;
    ctx.fillStyle = h.color;
    
    // Body
    ctx.fillRect(-s * 0.4, -s * 0.3, s * 0.8, s * 0.8);
    // Head
    ctx.fillRect(-s * 0.3, -s * 0.8, s * 0.6, s * 0.5);
    // Legs
    ctx.fillRect(-s * 0.3, s * 0.5, s * 0.25, s * 0.3);
    ctx.fillRect(s * 0.05, s * 0.5, s * 0.25, s * 0.3);
    
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
        if (b.bounces < b.maxBounces) { b.vx *= -1; b.bounces++; }
        else { b.active = false; return; }
      }
      if (b.y < 0 || b.y > WORLD_H) {
        if (b.bounces < b.maxBounces) { b.vy *= -1; b.bounces++; }
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
    }
  });
}

function drawProjectiles(ctx) {
  // Player bullets
  game.playerBullets.forEach(b => {
    // Afterimage trail
    ctx.strokeStyle = C.laserGlow;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = LASER_WIDTH;
    ctx.beginPath();
    ctx.moveTo(b.prevX, b.prevY);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    
    // Bolt
    ctx.fillStyle = C.laser;
    const a = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(a);
    ctx.fillRect(-LASER_LENGTH / 2, -LASER_WIDTH / 2, LASER_LENGTH, LASER_WIDTH);
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

function startNextWave() {
  game.wave++;
  game.player.rescueCount = 0; // Reset per-wave rescue counter
  
  const w = game.wave;
  const isBrainWave = w % 5 === 0;
  
  // Calculate enemy budget
  let grunts = 30 + w * 8;
  let electrodes = 8 + w * 2;
  let hulks = w >= 2 ? Math.floor(w * 0.8) : 0;
  let spheroids = w >= 3 ? Math.floor(w * 0.4) : 0;
  let quarks = w >= 4 ? Math.floor(w * 0.3) : 0;
  let brains = 0;
  let humanCount = 20 + w * 3;
  
  if (isBrainWave) {
    brains = 4 + w;
    hulks = 0; // No hulks on brain waves
    humanCount = 30 + w * 4; // Extra humans
    grunts = Math.floor(grunts * 0.6);
  }
  
  // Spawn initial batch (60% immediately, rest over time)
  const immediateRatio = 0.6;
  
  // Spawn electrodes (all at once, placed around the map)
  for (let i = 0; i < electrodes; i++) spawnEnemyRandom('electrode');
  
  // Spawn some grunts immediately
  const immediateGrunts = Math.floor(grunts * immediateRatio);
  for (let i = 0; i < immediateGrunts; i++) spawnEnemyAtEdge('grunt');
  
  // Hulks scattered
  for (let i = 0; i < hulks; i++) spawnEnemyRandom('hulk');
  
  // Spheroids
  const immSpheroids = Math.floor(spheroids * immediateRatio);
  for (let i = 0; i < immSpheroids; i++) spawnEnemyAtEdge('spheroid');
  
  // Quarks
  const immQuarks = Math.floor(quarks * immediateRatio);
  for (let i = 0; i < immQuarks; i++) spawnEnemyAtEdge('quark');
  
  // Brains
  if (brains > 0) {
    for (let i = 0; i < brains; i++) spawnEnemyAtEdge('brain');
  }
  
  // Budget for sub-wave spawning
  game.waveSpawnBudget = grunts - immediateGrunts + (spheroids - immSpheroids) + (quarks - immQuarks);
  game.waveSpawnTimer = 0;
  
  // Track remaining killable enemies
  let killable = 0;
  for (const e of game.enemies) {
    if (e.active && !e.special.invincible) killable++;
  }
  game.waveEnemiesRemaining = killable;
  game.waveEnemiesTotal = killable;
  
  // Spawn humans
  spawnHumans(humanCount);
  
  // Announce
  game.waveAnnounce = 2.5;
  game.betweenWaves = false;
  
  SFX.waveStart();
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
  
  // Sub-wave spawning
  if (game.waveSpawnBudget > 0) {
    game.waveSpawnTimer -= dt;
    if (game.waveSpawnTimer <= 0) {
      const spawnCount = randI(2, 5);
      for (let i = 0; i < spawnCount && game.waveSpawnBudget > 0; i++) {
        // Mix of enemy types
        const r = Math.random();
        if (r < 0.7) spawnEnemyAtEdge('grunt');
        else if (r < 0.85) spawnEnemyAtEdge('spheroid');
        else spawnEnemyAtEdge('quark');
        game.waveSpawnBudget--;
        game.waveEnemiesRemaining++;
        game.waveEnemiesTotal++;
      }
      game.waveSpawnTimer = randF(3, 7);
    }
  }
  
  // Check wave clear
  if (game.waveEnemiesRemaining <= 0 && game.waveSpawnBudget <= 0) {
    // Count remaining killable enemies
    let killable = 0;
    for (const e of game.enemies) {
      if (e.active && !e.special.invincible && e.type !== 'electrode') killable++;
    }
    if (killable <= 0) {
      game.betweenWaves = true;
      game.waveClearTimer = 3.0;
      SFX.waveClear();
      game.player.score += 500 * game.wave;
      spawnFloatingText(game.player.x, game.player.y - 40, `WAVE ${game.wave} CLEAR! +${500 * game.wave}`, C.textYellow, 16);
    }
  }
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

function drawGameOver(ctx) {
  const w = game.width;
  const h = game.height;
  const p = game.player;
  
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(0, 0, w, h);
  
  ctx.textAlign = 'center';
  
  // GAME OVER
  ctx.fillStyle = '#ff4444';
  ctx.font = "bold 32px 'Press Start 2P', monospace";
  ctx.fillText('GAME OVER', w / 2, h * 0.2);
  
  // Stats
  ctx.fillStyle = C.textWhite;
  ctx.font = "12px 'Press Start 2P', monospace";
  const stats = [
    `SCORE: ${p.score.toLocaleString()}`,
    `WAVE: ${game.wave}`,
    `LEVEL: ${p.level}`,
    `HUMANS SAVED: ${p.totalRescues}`,
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
  game.runTime = 0;
  game.nextHpRestore = 25000;
  game.powerScore = 0;
  stompyActive = false;
  stompyTimer = 0;
  game.camZoom = 1.0;
  
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
          if (Input.startPressed()) { startGame(); }
          break;
          
        case 'playing':
          game.runTime += dt;
          updatePlayer(dt);
          updateEnemies(dt);
          updateHumans(dt);
          updateProjectiles(dt);
          updateGems(dt);
          updateStompy(dt);
          updateWaveSystem(dt);
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
          if (Input.startPressed()) { startGame(); }
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
        drawTitleScreen(ctx);
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
