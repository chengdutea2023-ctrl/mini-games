const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const startButton = document.getElementById('startButton');
const musicButton = document.getElementById('musicButton');
const motionButton = document.getElementById('motionButton');
const calibrateButton = document.getElementById('calibrateButton');
const motionStatus = document.getElementById('motionStatus');
const motionVideo = document.getElementById('motionVideo');

const W = canvas.width;
const H = canvas.height;
const keys = new Set();
const images = {};
const sounds = {};
const pointer = { active: false, shooting: false, x: W / 2, y: H - 90 };
const audioState = { musicMuted: false, musicReady: false };
const motionControl = {
  enabled: false,
  stream: null,
  detector: null,
  canvas: document.createElement('canvas'),
  context: null,
  baseline: null,
  samples: [],
  direction: 0,
  confidence: 0,
  lastFrame: 0,
  raf: null
};
const musicEngine = { context: null, master: null, timer: null, step: 0, playing: false };

const state = {
  mode: 'ready',
  score: 0,
  lives: 3,
  level: 1,
  time: 0,
  bgY: 0,
  lastShot: 0,
  lastEnemy: 0,
  lastEnemyShot: 0,
  player: { x: W / 2, y: H - 92, w: 64, h: 64, invincible: 0 },
  bullets: [],
  enemies: [],
  enemyBullets: [],
  explosions: [],
  particles: []
};

function loadImage(name, src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images[name] = img; resolve(img); };
    img.onerror = () => reject(new Error(src + ' 加载失败'));
    img.src = src;
  });
}

function loadSound(name, src, options = {}) {
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.loop = Boolean(options.loop);
  audio.volume = options.volume ?? 0.55;
  sounds[name] = audio;
}

function playSound(name) {
  const audio = sounds[name];
  if (!audio) return;
  const copy = audio.cloneNode();
  copy.volume = name === 'shoot' ? 0.3 : 0.55;
  copy.play().catch(() => {});
}

function updateMusicButton() {
  if (!musicButton) return;
  musicButton.textContent = audioState.musicMuted ? '音乐关' : '音乐开';
  musicButton.setAttribute('aria-pressed', String(!audioState.musicMuted));
}

function ensureMusicContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!musicEngine.context) {
    musicEngine.context = new AudioCtor();
    musicEngine.master = musicEngine.context.createGain();
    musicEngine.master.gain.value = 0.32;
    musicEngine.master.connect(musicEngine.context.destination);
  }
  return musicEngine.context;
}

function playMusicTone(freq, start, duration, type, gainValue) {
  const ctx = musicEngine.context;
  if (!ctx || !musicEngine.master) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(musicEngine.master);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function playMusicNoise(start) {
  const ctx = musicEngine.context;
  if (!ctx || !musicEngine.master) return;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.045), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  const gain = ctx.createGain();
  noise.buffer = buffer;
  gain.gain.setValueAtTime(0.06, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
  noise.connect(gain);
  gain.connect(musicEngine.master);
  noise.start(start);
}

function scheduleMusicStep() {
  const ctx = musicEngine.context;
  if (!ctx || !musicEngine.playing) return;
  const now = ctx.currentTime;
  const step = musicEngine.step % 32;
  const bass = [55, 55, 82.41, 55, 73.42, 55, 98, 55, 65.41, 65.41, 98, 65.41, 87.31, 65.41, 110, 65.41, 55, 55, 82.41, 55, 73.42, 55, 98, 55, 49, 49, 73.42, 49, 65.41, 49, 87.31, 49];
  const lead = [440, 554.37, 659.25, 830.61, 659.25, 554.37, 493.88, 659.25];
  playMusicTone(bass[step], now, 0.24, 'sawtooth', 0.18);
  playMusicTone(lead[step % lead.length], now, 0.14, 'square', 0.08);
  if (step % 4 === 0) playMusicTone(72, now, 0.18, 'sine', 0.24);
  if (step % 2 === 1) playMusicNoise(now);
  musicEngine.step += 1;
}

function startMusic() {
  if (audioState.musicMuted || musicEngine.playing) return;
  const ctx = ensureMusicContext();
  if (!ctx) return;
  ctx.resume().then(() => {
    if (audioState.musicMuted || musicEngine.playing) return;
    musicEngine.playing = true;
    audioState.musicReady = true;
    scheduleMusicStep();
    musicEngine.timer = window.setInterval(scheduleMusicStep, 125);
  }).catch(() => {});
}

function pauseMusic() {
  musicEngine.playing = false;
  if (musicEngine.timer) {
    window.clearInterval(musicEngine.timer);
    musicEngine.timer = null;
  }
}

function toggleMusic() {
  audioState.musicMuted = !audioState.musicMuted;
  if (audioState.musicMuted) pauseMusic();
  else if (state.mode === 'playing') startMusic();
  updateMusicButton();
}

function drawSprite(name, x, y, w, h, rotation = 0, alpha = 1) {
  const img = images[name];
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function resetGame() {
  state.mode = 'playing';
  state.score = 0;
  state.lives = 3;
  state.level = 1;
  state.time = 0;
  state.bgY = 0;
  state.lastShot = 0;
  state.lastEnemy = 0;
  state.lastEnemyShot = 0;
  state.player = { x: W / 2, y: H - 92, w: 64, h: 64, invincible: 1200 };
  state.bullets = [];
  state.enemies = [];
  state.enemyBullets = [];
  state.explosions = [];
  state.particles = [];
  overlay.classList.add('hidden');
  startButton.textContent = '重新启动';
  startMusic();
  if (motionControl.enabled) calibrateMotion();
  playSound('start');
  updateHud();
}

function updateHud() {
  scoreEl.textContent = state.score;
  livesEl.textContent = state.lives;
  levelEl.textContent = state.level;
}

function shoot(now) {
  if (now - state.lastShot < 150) return;
  state.lastShot = now;
  state.bullets.push({ x: state.player.x - 15, y: state.player.y - 30, w: 10, h: 34, vy: -650 });
  state.bullets.push({ x: state.player.x + 15, y: state.player.y - 30, w: 10, h: 34, vy: -650 });
  playSound('shoot');
}

function spawnEnemy(now) {
  const interval = Math.max(340, 880 - state.level * 64);
  if (now - state.lastEnemy < interval) return;
  state.lastEnemy = now;
  const type = Math.random() > 0.55 ? 'enemyB' : 'enemyA';
  const size = type === 'enemyB' ? 68 : 60;
  state.enemies.push({
    x: 36 + Math.random() * (W - 72),
    y: -48,
    w: size,
    h: size,
    vy: 110 + state.level * 18 + Math.random() * 70,
    vx: (Math.random() - 0.5) * (28 + state.level * 4),
    hp: type === 'enemyB' ? 2 : 1,
    type
  });
}

function rectsHit(a, b) {
  const aScale = a.hitScale ?? 0.5;
  const bScale = b.hitScale ?? 0.5;
  return Math.abs(a.x - b.x) < (a.w * aScale + b.w * bScale) && Math.abs(a.y - b.y) < (a.h * aScale + b.h * bScale);
}

function spawnEnemyBullet(now) {
  const interval = Math.max(520, 1350 - state.level * 80);
  if (now - state.lastEnemyShot < interval || state.enemies.length === 0) return;
  const shooters = state.enemies.filter((enemy) => !enemy.dead && enemy.y > 30 && enemy.y < H * 0.68);
  if (shooters.length === 0) return;
  const enemy = shooters[Math.floor(Math.random() * shooters.length)];
  state.lastEnemyShot = now;
  const dx = state.player.x - enemy.x;
  const dy = state.player.y - enemy.y;
  const len = Math.hypot(dx, dy) || 1;
  const speed = 235 + state.level * 15;
  state.enemyBullets.push({
    x: enemy.x,
    y: enemy.y + enemy.h * 0.22,
    w: 14,
    h: 30,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    angle: Math.atan2(dy, dx) + Math.PI / 2,
    hitScale: 0.32
  });
}

function addExplosion(x, y, big = false) {
  state.explosions.push({ x, y, age: 0, ttl: big ? 620 : 420, size: big ? 90 : 62 });
  for (let i = 0; i < (big ? 24 : 14); i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 160;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      ttl: 380 + Math.random() * 240,
      color: Math.random() > 0.45 ? '#ffdf5a' : '#ff5d3d'
    });
  }
}

function damagePlayer() {
  if (state.player.invincible > 0) return;
  state.lives -= 1;
  state.player.invincible = 1400;
  addExplosion(state.player.x, state.player.y, true);
  playSound('hit');
  updateHud();
  if (state.lives <= 0) {
    state.mode = 'gameover';
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = '任务失败';
    overlayText.textContent = '最终分数：' + state.score;
    playSound('explode');
    pauseMusic();
  }
}

function update(dt, now) {
  if (state.mode !== 'playing') return;
  state.time += dt;
  state.bgY = (state.bgY + dt * (45 + state.level * 6)) % H;
  state.level = Math.min(12, 1 + Math.floor(state.score / 450));

  const speed = 390;
  let dx = 0;
  let dy = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) dy -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) dy += 1;
  if (motionControl.enabled && motionControl.confidence > 0.1) {
    dx += motionControl.direction * 1.9;
  }
  if (pointer.active) {
    state.player.x += (pointer.x - state.player.x) * Math.min(1, dt * 12);
    state.player.y += (pointer.y - state.player.y) * Math.min(1, dt * 12);
  } else if (dx || dy) {
    const len = Math.hypot(dx, dy) || 1;
    state.player.x += (dx / len) * speed * dt;
    state.player.y += (dy / len) * speed * dt;
  }
  state.player.x = Math.max(30, Math.min(W - 30, state.player.x));
  state.player.y = Math.max(68, Math.min(H - 42, state.player.y));
  state.player.invincible = Math.max(0, state.player.invincible - dt * 1000);

  shoot(now);
  spawnEnemy(now);
  spawnEnemyBullet(now);

  for (const bullet of state.bullets) bullet.y += bullet.vy * dt;
  state.bullets = state.bullets.filter((bullet) => bullet.y > -40);

  for (const bullet of state.enemyBullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
  }
  state.enemyBullets = state.enemyBullets.filter((bullet) => bullet.y < H + 44 && bullet.x > -44 && bullet.x < W + 44);

  for (const enemy of state.enemies) {
    enemy.y += enemy.vy * dt;
    enemy.x += enemy.vx * dt;
    if (enemy.x < 30 || enemy.x > W - 30) enemy.vx *= -1;
  }

  for (const bullet of state.bullets) {
    for (const enemy of state.enemies) {
      if (enemy.dead || bullet.dead) continue;
      if (rectsHit(bullet, enemy)) {
        bullet.dead = true;
        enemy.hp -= 1;
        if (enemy.hp <= 0) {
          enemy.dead = true;
          state.score += enemy.type === 'enemyB' ? 120 : 75;
          addExplosion(enemy.x, enemy.y, enemy.type === 'enemyB');
          playSound('explode');
          updateHud();
        }
      }
    }
  }
  state.bullets = state.bullets.filter((bullet) => !bullet.dead);

  for (const enemy of state.enemies) {
    if (!enemy.dead && rectsHit(enemy, state.player)) {
      enemy.dead = true;
      damagePlayer();
    }
    if (!enemy.dead && enemy.y > H + 60) {
      enemy.dead = true;
    }
  }
  state.enemies = state.enemies.filter((enemy) => !enemy.dead);

  for (const bullet of state.enemyBullets) {
    if (!bullet.dead && rectsHit(bullet, state.player)) {
      bullet.dead = true;
      damagePlayer();
    }
  }
  state.enemyBullets = state.enemyBullets.filter((bullet) => !bullet.dead);

  for (const explosion of state.explosions) explosion.age += dt * 1000;
  state.explosions = state.explosions.filter((explosion) => explosion.age < explosion.ttl);
  for (const particle of state.particles) {
    particle.age += dt * 1000;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }
  state.particles = state.particles.filter((particle) => particle.age < particle.ttl);
}

function drawBackground() {
  const bg = images.background;
  if (!bg) {
    ctx.fillStyle = '#050812';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const y = state.bgY;
  ctx.drawImage(bg, 0, y - H, W, H);
  ctx.drawImage(bg, 0, y, W, H);
}

function drawEnemyBullet(bullet) {
  ctx.save();
  ctx.translate(bullet.x, bullet.y);
  ctx.rotate(bullet.angle);
  ctx.shadowColor = '#ff2bd6';
  ctx.shadowBlur = 14;
  ctx.fillStyle = 'rgba(255, 43, 214, 0.32)';
  ctx.fillRect(-7, -18, 14, 36);
  ctx.fillStyle = '#ff2bd6';
  ctx.fillRect(-4, -13, 8, 26);
  ctx.fillStyle = '#fff2ff';
  ctx.fillRect(-1, -10, 2, 20);
  ctx.restore();
}

function draw() {
  drawBackground();

  for (const enemyBullet of state.enemyBullets) {
    drawEnemyBullet(enemyBullet);
  }

  for (const bullet of state.bullets) {
    drawSprite('laser', bullet.x, bullet.y, bullet.w * 2.4, bullet.h);
  }

  for (const enemy of state.enemies) {
    drawSprite(enemy.type, enemy.x, enemy.y, enemy.w, enemy.h);
  }

  for (const particle of state.particles) {
    const alpha = 1 - particle.age / particle.ttl;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
    ctx.globalAlpha = 1;
  }

  for (const explosion of state.explosions) {
    const progress = explosion.age / explosion.ttl;
    drawSprite('explosion', explosion.x, explosion.y, explosion.size * (0.7 + progress * 0.6), explosion.size * (0.7 + progress * 0.6), 0, 1 - progress * 0.35);
  }

  const blink = state.player.invincible > 0 && Math.floor(state.time * 16) % 2 === 0;
  if (!blink || state.mode !== 'playing') drawSprite('player', state.player.x, state.player.y, state.player.w, state.player.h);

  for (let i = 0; i < state.lives; i++) {
    drawSprite('heart', 26 + i * 26, H - 22, 20, 20);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt, now);
  draw();
  requestAnimationFrame(loop);
}

function togglePause() {
  if (state.mode === 'playing') {
    state.mode = 'paused';
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = '系统暂停';
    overlayText.textContent = '按 P 继续，或点击按钮重新启动。体感控制开启后，头向左/右会控制飞机横向移动。';
    pauseMusic();
  } else if (state.mode === 'paused') {
    state.mode = 'playing';
    overlay.classList.add('hidden');
    startMusic();
  }
}

document.addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (event.code === 'Space') event.preventDefault();
  if (event.code === 'KeyP') togglePause();
});
document.addEventListener('keyup', (event) => keys.delete(event.code));

function pointerToCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * W,
    y: ((event.clientY - rect.top) / rect.height) * H
  };
}

canvas.addEventListener('pointerdown', (event) => {
  const pos = pointerToCanvas(event);
  pointer.active = true;
  pointer.shooting = true;
  pointer.x = pos.x;
  pointer.y = pos.y;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointer.active) return;
  const pos = pointerToCanvas(event);
  pointer.x = pos.x;
  pointer.y = pos.y;
});
canvas.addEventListener('pointerup', () => {
  pointer.active = false;
  pointer.shooting = false;
});
canvas.addEventListener('pointercancel', () => {
  pointer.active = false;
  pointer.shooting = false;
});

startButton.addEventListener('click', () => {
  overlay.querySelector('h1').textContent = '霓虹空袭体感控制版';
  resetGame();
});

musicButton.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleMusic();
});

function setMotionStatus(text) {
  if (motionStatus) motionStatus.textContent = text;
}

function isCameraAllowedContext() {
  return window.isSecureContext || ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function calibrateMotion() {
  motionControl.baseline = null;
  motionControl.samples = [];
  motionControl.direction = 0;
  motionControl.confidence = 0;
  setMotionStatus('请正对摄像头保持 1 秒，正在校准中心位置。');
}

function updateMotionButton() {
  if (motionButton) motionButton.textContent = motionControl.enabled ? '体感运行中' : '开启体感';
}

async function startMotionControl() {
  if (motionControl.enabled) {
    calibrateMotion();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setMotionStatus('当前浏览器不支持摄像头体感控制。');
    return;
  }
  if (!isCameraAllowedContext()) {
    setMotionStatus('当前页面不是 HTTPS，浏览器会禁止摄像头。请用 HTTPS 线上地址，或在 localhost 本地运行。');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
      audio: false
    });
    motionControl.stream = stream;
    motionControl.enabled = true;
    motionControl.context = motionControl.canvas.getContext('2d', { willReadFrequently: true });
    motionControl.canvas.width = 160;
    motionControl.canvas.height = 120;
    if ('FaceDetector' in window) {
      motionControl.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    }
    motionVideo.srcObject = stream;
    await motionVideo.play();
    updateMotionButton();
    calibrateMotion();
    analyzeMotionFrame(performance.now());
  } catch (error) {
    motionControl.enabled = false;
    updateMotionButton();
    setMotionStatus('摄像头启动失败：' + (error.message || '请检查浏览器权限'));
  }
}

function sampleMotionCentroid() {
  if (!motionVideo.videoWidth || !motionControl.context) return null;
  const ctx2 = motionControl.context;
  const w = motionControl.canvas.width;
  const h = motionControl.canvas.height;
  ctx2.drawImage(motionVideo, 0, 0, w, h);
  const pixels = ctx2.getImageData(0, 0, w, h).data;
  let total = 0;
  let weightedX = 0;
  for (let y = 10; y < h - 8; y += 2) {
    for (let x = 8; x < w - 8; x += 2) {
      const i = (y * w + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const brightness = (r + g + b) / 3;
      const skinHint = r > 55 && g > 35 && b > 25 && r > b * 1.05 && r < 245;
      const weight = skinHint ? Math.max(0, brightness - 35) : Math.max(0, brightness - 130) * 0.35;
      if (weight > 0) {
        total += weight;
        weightedX += x * weight;
      }
    }
  }
  if (total < 900) return null;
  return { x: weightedX / total / w, confidence: Math.min(1, total / 26000) };
}

async function detectHeadPosition() {
  if (motionControl.detector) {
    try {
      const faces = await motionControl.detector.detect(motionVideo);
      if (faces.length > 0) {
        const box = faces[0].boundingBox;
        return { x: (box.x + box.width / 2) / motionVideo.videoWidth, confidence: Math.min(1, box.width / motionVideo.videoWidth) };
      }
    } catch {
      motionControl.detector = null;
    }
  }
  return sampleMotionCentroid();
}

async function analyzeMotionFrame(now) {
  if (!motionControl.enabled) return;
  if (now - motionControl.lastFrame > 85) {
    motionControl.lastFrame = now;
    const head = await detectHeadPosition();
    if (head) {
      if (motionControl.baseline === null) {
        motionControl.samples.push(head.x);
        if (motionControl.samples.length >= 10) {
          motionControl.baseline = motionControl.samples.reduce((sum, value) => sum + value, 0) / motionControl.samples.length;
          setMotionStatus('体感已启用：头向左/右移动，飞机会跟随横向移动。');
        }
      } else {
        const delta = head.x - motionControl.baseline;
        const deadZone = 0.022;
        const raw = Math.abs(delta) < deadZone ? 0 : Math.max(-1, Math.min(1, delta / 0.12));
        motionControl.direction = motionControl.direction * 0.58 + raw * 0.42;
        motionControl.confidence = head.confidence;
        if (Math.abs(raw) > 0.1) {
          setMotionStatus(raw < 0 ? '检测到头部向左，战机左移。' : '检测到头部向右，战机右移。');
        }
      }
    } else if (motionControl.baseline !== null) {
      motionControl.direction *= 0.82;
      motionControl.confidence = 0;
      setMotionStatus('暂时没有识别到头部，请保持脸部在摄像头画面内。');
    }
  }
  motionControl.raf = requestAnimationFrame(analyzeMotionFrame);
}

motionButton.addEventListener('click', (event) => {
  event.stopPropagation();
  startMotionControl();
});

calibrateButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (motionControl.enabled) calibrateMotion();
  else setMotionStatus('请先开启体感控制。');
});

async function boot() {
  await Promise.all([
    loadImage('background', './assets/images/background-space.png'),
    loadImage('player', './assets/images/player.png'),
    loadImage('enemyA', './assets/images/enemy-a.png'),
    loadImage('enemyB', './assets/images/enemy-b.png'),
    loadImage('laser', './assets/images/laser.png'),
    loadImage('explosion', './assets/images/explosion.png'),
    loadImage('heart', './assets/images/heart.png'),
    loadImage('star', './assets/images/star.png')
  ]);
  loadSound('shoot', './assets/audio/shoot.wav');
  loadSound('explode', './assets/audio/explode.wav');
  loadSound('hit', './assets/audio/hit.wav');
  loadSound('start', './assets/audio/start.wav');
  updateMusicButton();
  draw();
  requestAnimationFrame(loop);
}

boot().catch((error) => {
  overlay.classList.remove('hidden');
  overlay.querySelector('h1').textContent = '资源加载失败';
  overlayText.textContent = error.message || '请检查资源目录';
});
