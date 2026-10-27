(() => {
  // ---------- Configuration ----------
  const H = 640;                   // logical height; the width follows the screen shape
  const MIN_W = 280, MAX_W = 480;  // beyond this range the game is letterboxed
  const GROUND_H = 90;
  const GRAVITY = 1500;            // px/s²
  const FLAP_V = -430;             // px/s
  const MAX_FALL = 700;            // px/s
  const PIPE_W = 64;
  const PIPE_GAP = 130;            // vertical gap between top and bottom pipe
  const PIPE_SPEED = 160;          // px/s
  const PIPE_INTERVAL = 1.45;      // s between pipes
  const STEP = 1 / 60;             // fixed physics step
  const GAME_ID = 'vuela';

  // Shelves that give a prize when passed (pipe number -> kind)
  const PRIZE_PIPES = { 10: 'gold', 25: 'gold', 50: 'gold', 100: 'super' };
  const PRIZE_TEXT = { gold: '¡Has ganado un premio!', super: '¡Premio superior!' };
  const PRIZE_TIME = 2.2;          // s the prize banner stays on screen

  // ---------- Token supplied by the app (?token=...), see shared/bridge.js ----------
  const token = window.getToken();

  // ---------- Best score (per device) ----------
  function loadBest() {
    try { return parseInt(localStorage.getItem('vuela_best') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('vuela_best', String(v)); } catch (e) {}
  }

  // ---------- CSS colors ----------
  const cssCache = {};
  function getVar(name) {
    if (!cssCache[name]) {
      cssCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    return cssCache[name];
  }

  // ---------- Sound (shared/sound.js, unlocked on the first tap) ----------
  function playSound(kind) {
    if (kind === 'point') {                       // short "plim"
      sound.tone(1568, 0, 0.16, 0.16);            // G6
      sound.tone(2093, 0.05, 0.22, 0.12);         // C7
    } else {                                      // prize: rising arpeggio
      const notes = kind === 'super'
        ? [1047, 1319, 1568, 2093, 2637, 3136]    // C6 E6 G6 C7 E7 G7
        : [1047, 1319, 1568, 2093];               // C6 E6 G6 C7
      notes.forEach((f, i) => sound.tone(f, i * 0.08, 0.3, 0.14, 'triangle'));
    }
  }

  // ---------- Canvas & scaling ----------
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const bgCanvas = document.createElement('canvas');   // sky gradient, drawn once per resize
  const bgCtx = bgCanvas.getContext('2d');
  let W = 360, scale = 1, safeTop = 0;

  // Reads the notch height (CSS px) through a hidden element
  const safeProbe = document.createElement('div');
  safeProbe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
  document.body.appendChild(safeProbe);

  function resize() {
    // DPR capped at 2: at 3x the canvas has twice the pixels for no visible gain
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = stage.clientWidth, ch = stage.clientHeight;
    W = Math.max(MIN_W, Math.min(MAX_W, H * cw / ch));   // not rounded: avoids 1px bars
    scale = Math.min(cw / W, ch / H);
    // only the part of the notch the stage actually reaches (none from the home screen)
    const notch = parseFloat(getComputedStyle(safeProbe).paddingTop) || 0;
    safeTop = Math.max(0, notch - stage.getBoundingClientRect().top) / scale;
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    canvas.width = bgCanvas.width = Math.round(W * scale * dpr);
    canvas.height = bgCanvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    bgCtx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawBackground(bgCtx);
  }
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  // ---------- State ----------
  let state, paused, bird, pipes, pipeCount, score, best, pipeTimer, groundDist, prevGroundDist, overTimer, playTime, prize;
  best = loadBest();

  function reset() {
    state = 'ready';               // ready | playing | over
    paused = false;
    bird = { x: 100, y: H / 2 - 40, vy: 0, r: 15, rot: 0, t: 0 };
    bird.prevY = bird.y;
    bird.prevRot = bird.rot;
    pipes = [];
    pipeCount = 0;
    score = 0;
    pipeTimer = 0;
    groundDist = prevGroundDist = 0;
    overTimer = 0;
    playTime = 0;
    prize = null;                  // banner on screen: { kind, t }
  }
  reset();

  // ---------- Input ----------
  function flap() {
    if (paused) {
      paused = false;              // resume with a flap so the bird doesn't drop
      bird.vy = FLAP_V;
    } else if (state === 'ready') {
      state = 'playing';
      bird.vy = FLAP_V;
    } else if (state === 'playing') {
      bird.vy = FLAP_V;
    } else if (state === 'over' && overTimer > 0.6) {
      reset();                     // small delay prevents accidental restarts
    }
  }
  // Listen on the whole window so the letterbox bars also respond to taps
  window.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.button > 0) return;      // ignore right/middle mouse buttons
    sound.unlock();
    flap();
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      sound.unlock();
      if (!e.repeat) flap();       // holding the key must not auto-flap
    }
  });

  // ---------- Logic ----------
  function spawnPipe() {
    const minTop = 60;
    const maxTop = H - GROUND_H - PIPE_GAP - 60;
    const top = minTop + Math.random() * (maxTop - minTop);
    const x = W + 10;
    const n = ++pipeCount;
    pipes.push({ x, prevX: x, top, n, kind: PRIZE_PIPES[n] || null, passed: false });
  }

  function passPipe(p) {
    p.passed = true;
    score++;
    if (p.kind) {
      prize = { kind: p.kind, t: 0 };
      playSound(p.kind);
    } else {
      playSound('point');
    }
  }

  function gameOver() {
    state = 'over';
    overTimer = 0;
    if (score > best) { best = score; saveBest(best); }
    window.notify({
      type: 'game_over',
      game: GAME_ID,
      score,
      durationMs: Math.round(playTime * 1000),   // excludes time spent paused
      token,
      ts: new Date().toISOString()
    });
  }

  function hitsPipe(p) {
    // circle vs. the pipe bodies and their wider lips
    const cx = bird.x, cy = bird.y, r = bird.r - 2;
    const bottomY = p.top + PIPE_GAP;
    const rects = [
      { x: p.x, y: 0, w: PIPE_W, h: p.top - 22 },
      { x: p.x - 4, y: p.top - 22, w: PIPE_W + 8, h: 22 },           // top lip
      { x: p.x - 4, y: bottomY, w: PIPE_W + 8, h: 22 },              // bottom lip
      { x: p.x, y: bottomY + 22, w: PIPE_W, h: H - GROUND_H - bottomY - 22 }
    ];
    return rects.some(rc => {
      const nx = Math.max(rc.x, Math.min(cx, rc.x + rc.w));
      const ny = Math.max(rc.y, Math.min(cy, rc.y + rc.h));
      return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
    });
  }

  function savePrevious() {
    // positions before this step, used to interpolate when drawing
    bird.prevY = bird.y;
    bird.prevRot = bird.rot;
    prevGroundDist = groundDist;
    for (const p of pipes) p.prevX = p.x;
  }

  function update(dt) {
    savePrevious();
    bird.t += dt;
    if (prize && (prize.t += dt) > PRIZE_TIME) prize = null;

    if (state !== 'over') groundDist += PIPE_SPEED * dt;

    if (state === 'ready') {
      bird.y = H / 2 - 40 + Math.sin(bird.t * 4) * 6;  // idle hover
      return;
    }

    if (state === 'over') {
      overTimer += dt;
      // let the bird fall to the ground
      if (bird.y < H - GROUND_H - bird.r) {
        bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
        bird.y = Math.min(bird.y + bird.vy * dt, H - GROUND_H - bird.r);
        bird.rot = Math.min(bird.rot + 6 * dt, Math.PI / 2);
      }
      return;
    }

    // playing
    playTime += dt;
    bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.45, Math.min(Math.PI / 2, bird.vy / 600));

    pipeTimer -= dt;
    if (pipeTimer <= 0) { spawnPipe(); pipeTimer = PIPE_INTERVAL; }

    for (const p of pipes) {
      p.x -= PIPE_SPEED * dt;
      if (!p.passed && p.x + PIPE_W < bird.x) passPipe(p);
      if (hitsPipe(p)) { gameOver(); return; }
    }
    pipes = pipes.filter(p => p.x + PIPE_W > -10);

    if (bird.y + bird.r >= H - GROUND_H) {
      bird.y = H - GROUND_H - bird.r;
      gameOver();
    }
    if (bird.y - bird.r < 0) { bird.y = bird.r; bird.vy = 0; }
  }

  // ---------- Drawing ----------
  const lerp = (a, b, t) => a + (b - a) * t;

  function drawBackground(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, getVar('--sky-top'));
    g.addColorStop(1, getVar('--sky-bottom'));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  // Clouds drift past slower than the shelves (parallax): [position in the loop, y, size, speed]
  const CLOUDS = [[0.05, 90, 1.1, 0.25], [0.38, 170, 0.8, 0.18], [0.62, 60, 0.9, 0.22],
                  [0.85, 250, 1.2, 0.3], [0.22, 330, 0.7, 0.15], [0.7, 400, 1, 0.26]];
  function drawClouds(alpha) {
    const dist = lerp(prevGroundDist, groundDist, alpha);
    const span = W + 160;
    ctx.fillStyle = getVar('--cloud');
    for (const [fx, y, sz, speed] of CLOUDS) {
      const x = ((fx * span - dist * speed) % span + span) % span - 80;
      ctx.beginPath();
      ctx.arc(x - 22 * sz, y + 6 * sz, 16 * sz, 0, Math.PI * 2);
      ctx.arc(x, y - 4 * sz, 22 * sz, 0, Math.PI * 2);
      ctx.arc(x + 24 * sz, y + 6 * sz, 15 * sz, 0, Math.PI * 2);
      ctx.rect(x - 22 * sz, y + 6 * sz, 46 * sz, 16 * sz);
      ctx.fill();
    }
  }

  // Supermarket sections: every shelf holds one product repeated, packed tight,
  // and each board of the shelf takes the next colour of its section
  const SHELF_H = 38;
  const SECTIONS = [
    { kind: 'bottle', w: 9,  colors: ['--item-water', '--item-orange', '--item-red'] },     // drinks
    { kind: 'box',    w: 12, colors: ['--item-yellow', '--item-red', '--item-orange'] },    // cereal
    { kind: 'can',    w: 10, colors: ['--item-red', '--item-green', '--item-yellow'] },     // tins
    { kind: 'carton', w: 11, colors: ['--item-white', '--item-water', '--item-yellow'] },   // dairy
    { kind: 'fruit',  w: 10, colors: ['--item-orange', '--item-red', '--item-green'], wood: true }
  ];

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  // Little smiling face centred on (cx, cy), sized to the product width
  function drawFace(cx, cy, w) {
    const e = w * 0.22;
    ctx.fillStyle = getVar('--face');
    ctx.beginPath();
    ctx.arc(cx - e, cy, 1, 0, Math.PI * 2);
    ctx.arc(cx + e, cy, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = getVar('--face');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy + 1, w * 0.18, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }

  function drawProduct(kind, x, board, w) {
    const c = ctx, cx = x + w / 2;
    if (kind === 'bottle') {                     // rounded body, neck and cap
      roundRect(x, board - 25, w, 25, 4);
      roundRect(cx - 2, board - 31, 4, 8, 1.5);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      roundRect(x + 1.5, board - 22, 2, 8, 1);
      drawFace(cx, board - 11, w);
    } else if (kind === 'box') {                 // tall box with a label
      roundRect(x, board - 32, w, 32, 3);
      c.fillStyle = 'rgba(255,255,255,0.6)';
      roundRect(x + 1.5, board - 24, w - 3, 11, 2);
      drawFace(cx, board - 20, w);
    } else if (kind === 'can') {                 // short can with a band
      roundRect(x, board - 15, w, 15, 3);
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillRect(x, board - 11, w, 6);
      drawFace(cx, board - 9, w);
    } else if (kind === 'carton') {              // carton with a gable top
      roundRect(x, board - 25, w, 25, 2.5);
      c.beginPath();
      c.moveTo(x + 0.5, board - 24); c.lineTo(cx, board - 31); c.lineTo(x + w - 0.5, board - 24);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.45)';
      roundRect(x + 1.5, board - 18, w - 3, 9, 2);
      drawFace(cx, board - 14, w);
    } else {                                     // round fruit with a leaf
      c.beginPath();
      c.arc(cx, board - w / 2, w / 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = getVar('--leaf');
      c.beginPath();
      c.ellipse(cx + 1.5, board - w - 0.5, 2.2, 1.1, -0.5, 0, Math.PI * 2);
      c.fill();
      drawFace(cx, board - w / 2, w);
    }
  }

  // Products standing on the shelf boards between y0 and y1; boards are counted
  // from the gap outwards so they line up with the end board
  function drawShelfItems(x, y0, y1, n, fromBottom) {
    const sec = SECTIONS[n % SECTIONS.length];
    const gap = 1, inner = PIPE_W - 6;
    const step = sec.w + gap;
    const count = Math.floor((inner + gap) / step);
    const start = x + 3 + (inner - (count * step - gap)) / 2;   // centred row
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y0, PIPE_W, y1 - y0);
    ctx.clip();
    for (let sh = 0; sh * SHELF_H < y1 - y0; sh++) {
      const board = fromBottom ? y1 - sh * SHELF_H : y0 + (sh + 1) * SHELF_H;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, board - 3, PIPE_W, 3);
      const color = getVar(sec.colors[sh % sec.colors.length]);
      // cans stack two high, fruit piles up in three rows, the rest stand in one
      const layers = sec.kind === 'can' ? 2 : sec.kind === 'fruit' ? 3 : 1;
      for (let l = 0; l < layers; l++) {
        const shift = sec.kind === 'fruit' ? l * 0.5 : 0;
        const lift = sec.kind === 'fruit' ? l * sec.w * 0.85 : l * 15;
        for (let k = 0; k < count - (sec.kind === 'fruit' ? l : 0); k++) {
          ctx.fillStyle = color;
          drawProduct(sec.kind, start + (k + shift) * step, board - 3 - lift, sec.w);
        }
      }
    }
    ctx.restore();
  }

  // Plank seams for the wooden fruit stands
  function drawWood(x, y, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let px = x + 16; px < x + PIPE_W; px += 16) ctx.fillRect(px, y, 2, h);
  }

  function drawPipes(alpha) {
    for (const p of pipes) {
      const x = lerp(p.prevX, p.x, alpha);
      const bottomY = p.top + PIPE_GAP;
      const wood = !p.kind && SECTIONS[p.n % SECTIONS.length].wood;
      const color = p.kind ? `--pipe-${p.kind}` : wood ? '--pipe-wood' : '--pipe';
      const bottomH = H - GROUND_H - bottomY;
      ctx.fillStyle = getVar(color);
      ctx.fillRect(x, 0, PIPE_W, p.top);
      ctx.fillRect(x, bottomY, PIPE_W, bottomH);
      if (wood) { drawWood(x, 0, p.top); drawWood(x, bottomY, bottomH); }
      drawShelfItems(x, 0, p.top - 22, p.n, true);
      drawShelfItems(x, bottomY + 22, H - GROUND_H, p.n, false);
      // end boards with a price strip
      ctx.fillStyle = getVar(color + '-dark');
      ctx.fillRect(x - 4, p.top - 22, PIPE_W + 8, 22);
      ctx.fillRect(x - 4, bottomY, PIPE_W + 8, 22);
      ctx.fillStyle = p.kind ? 'rgba(255,255,255,0.55)' : getVar('--item-yellow');
      ctx.fillRect(x + 6, p.top - 15, PIPE_W - 12, 8);
      ctx.fillRect(x + 6, bottomY + 7, PIPE_W - 12, 8);
    }
  }

  function drawGround(alpha) {
    const y = H - GROUND_H;
    const offset = -(lerp(prevGroundDist, groundDist, alpha) % 24);
    ctx.fillStyle = getVar('--ground');
    ctx.fillRect(0, y, W, GROUND_H);
    ctx.fillStyle = getVar('--ground-dark');
    ctx.fillRect(0, y, W, 6);
    // floor tiles scrolling with the shelves
    ctx.fillStyle = 'rgba(42,81,53,0.08)';
    for (let x = offset; x < W; x += 24) {
      for (let ty = y + 6; ty < H; ty += 24) {
        ctx.fillRect(x, ty, 12, 12);
        ctx.fillRect(x + 12, ty + 12, 12, 12);
      }
    }
  }

  function drawBird(alpha) {
    ctx.save();
    ctx.translate(bird.x, lerp(bird.prevY, bird.y, alpha));
    ctx.rotate(lerp(bird.prevRot, bird.rot, alpha));
    // shopping cart with wings, about the size of the collision circle
    const flapA = state === 'over' ? 0.2 : Math.sin(bird.t * 18) * 0.6;
    // back wing (flaps while alive)
    ctx.save();
    ctx.translate(-4, -8);
    ctx.rotate(-0.5 + flapA);
    ctx.fillStyle = getVar('--wing-dark');
    ctx.beginPath(); ctx.ellipse(-8, 0, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // shopping peeking out of the basket
    ctx.fillStyle = getVar('--item-red');
    ctx.beginPath(); ctx.arc(-5, -9, 5, 0, Math.PI * 2); ctx.fill();          // apple
    ctx.fillStyle = getVar('--item-green');
    ctx.fillRect(1, -15, 4, 9);                                               // leek
    ctx.save();
    ctx.translate(8, -10); ctx.rotate(0.5);
    ctx.fillStyle = '#d9963f';
    ctx.fillRect(-2.5, -8, 5, 14);                                            // baguette
    ctx.restore();
    // basket: trapezoid with a wire grid
    ctx.fillStyle = getVar('--cart');
    ctx.beginPath();
    ctx.moveTo(-15, -6); ctx.lineTo(14, -6); ctx.lineTo(10, 7); ctx.lineTo(-11, 7);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = getVar('--cart-wire');
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const gx of [-7, 0, 7]) { ctx.moveTo(gx, -5); ctx.lineTo(gx * 0.85, 6); }
    ctx.moveTo(-13, 0.5); ctx.lineTo(12, 0.5);
    ctx.stroke();
    // handle, frame and wheels
    ctx.strokeStyle = getVar('--cart');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-15, -6); ctx.lineTo(-19, -12); ctx.lineTo(-23, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-11, 7); ctx.lineTo(-9, 10); ctx.lineTo(9, 10); ctx.stroke();
    ctx.fillStyle = getVar('--cart');
    ctx.beginPath(); ctx.arc(-7, 13, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(7, 13, 3, 0, Math.PI * 2); ctx.fill();
    // front wing
    ctx.save();
    ctx.translate(2, -6);
    ctx.rotate(-0.3 + flapA);
    ctx.fillStyle = getVar('--wing');
    ctx.beginPath(); ctx.ellipse(-9, 0, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function text(str, x, y, size, align = 'center') {
    ctx.font = `bold ${size}px ${getVar('--brand-font')}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = getVar('--text-outline');
    ctx.strokeText(str, x, y);
    ctx.fillStyle = getVar('--text');
    ctx.fillText(str, x, y);
  }

  function drawPrize() {
    if (!prize) return;
    const t = prize.t;
    // pop in with a small overshoot, fade out at the end
    const pop = t < 0.25 ? 1 + Math.sin(t / 0.25 * Math.PI) * 0.15 : 1;
    const alpha = Math.min(1, t / 0.1, (PRIZE_TIME - t) / 0.4);
    const w = Math.min(W - 32, 280), h = 44;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(W / 2, safeTop + 130);
    const s = Math.min(pop, t / 0.08);
    ctx.scale(s, s);
    ctx.fillStyle = getVar(`--pipe-${prize.kind}-dark`);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    else ctx.rect(-w / 2, -h / 2, w, h);                       // iOS < 16
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = getVar(`--pipe-${prize.kind}`);
    ctx.stroke();
    text(PRIZE_TEXT[prize.kind], 0, 1, 20);
    ctx.restore();
  }

  function drawUI() {
    const top = safeTop;           // keep the HUD below the notch
    if (paused) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(0, 0, W, H);
      text(String(score), W / 2, top + 70, 52);
      text('Pausa', W / 2, 220, 46);
      text('Toca para seguir', W / 2, 280, 22);
    } else if (state === 'playing') {
      text(String(score), W / 2, top + 70, 52);
      drawPrize();
    } else if (state === 'ready') {
      text('Carro volador', W / 2, top + 150, 44);
      text('Toca para volar', W / 2, H / 2 + 60, 22);
      if (best > 0) text(`Récord: ${best}`, W / 2, H / 2 + 95, 18);
    } else if (state === 'over') {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(0, 0, W, H);
      text('¡Fin!', W / 2, top + 170, 50);
      text(`Puntos: ${score}`, W / 2, top + 245, 28);
      text(`Récord: ${best}`, W / 2, top + 285, 22);
      if (overTimer > 0.6) text('Toca para reintentar', W / 2, top + 360, 20);
    }
  }

  function render(alpha) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.restore();
    drawClouds(alpha);
    drawPipes(alpha);
    drawGround(alpha);
    drawBird(alpha);
    drawUI();
  }

  resize();

  // ---------- Fixed-timestep loop ----------
  let last = performance.now();
  let acc = 0;
  function loop(now) {
    let frame = (now - last) / 1000;
    last = now;
    if (frame > 0.25) frame = 0.25;      // avoid spiral after tab switch
    if (!paused) {
      acc += frame;
      while (acc >= STEP) { update(STEP); acc -= STEP; }
    }
    // draw between the last two physics steps so motion is smooth at any refresh rate
    render(paused ? 1 : acc / STEP);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Pause when the webview goes to background; wait for a tap to resume.
  // Some iOS webviews skip visibilitychange, so pagehide and blur pause too.
  function pause() { if (state === 'playing') paused = true; }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
    } else {
      last = performance.now();
      acc = 0;
    }
  });
  window.addEventListener('pagehide', pause);
  window.addEventListener('blur', pause);
})();
