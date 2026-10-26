(() => {
  // ---------- Configuration ----------
  const W = 360, H = 640;          // logical size; scaled to fit the screen
  const GROUND_H = 90;
  const GRAVITY = 1500;            // px/s²
  const FLAP_V = -430;             // px/s
  const MAX_FALL = 700;            // px/s
  const PIPE_W = 64;
  const PIPE_GAP = 165;
  const PIPE_SPEED = 160;          // px/s
  const PIPE_INTERVAL = 1.45;      // s between pipes
  const STEP = 1 / 60;             // fixed physics step
  const GAME_ID = 'vuela';

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

  // ---------- Canvas & scaling ----------
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1;

  function resize() {
    // #stage excludes the safe-area insets (notch, home indicator)
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    scale = Math.min(stage.clientWidth / W, stage.clientHeight / H);
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- State ----------
  let state, paused, bird, pipes, score, best, pipeTimer, groundDist, prevGroundDist, overTimer, playTime;
  best = loadBest();

  function reset() {
    state = 'ready';               // ready | playing | over
    paused = false;
    bird = { x: 100, y: H / 2 - 40, vy: 0, r: 15, rot: 0, t: 0 };
    bird.prevY = bird.y;
    bird.prevRot = bird.rot;
    pipes = [];
    score = 0;
    pipeTimer = 0;
    groundDist = prevGroundDist = 0;
    overTimer = 0;
    playTime = 0;
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
  window.addEventListener('pointerdown', e => { e.preventDefault(); flap(); });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (!e.repeat) flap();       // holding the key must not auto-flap
    }
  });

  // ---------- Logic ----------
  function spawnPipe() {
    const minTop = 60;
    const maxTop = H - GROUND_H - PIPE_GAP - 60;
    const top = minTop + Math.random() * (maxTop - minTop);
    const x = W + 10;
    pipes.push({ x, prevX: x, top, passed: false });
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
    // circle vs. two rectangles
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
      if (!p.passed && p.x + PIPE_W < bird.x) { p.passed = true; score++; }
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

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, getVar('--sky-top'));
    g.addColorStop(1, getVar('--sky-bottom'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // simple clouds
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    [[60, 120], [230, 80], [300, 200], [140, 260]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.arc(x + 20, y - 8, 22, 0, Math.PI * 2);
      ctx.arc(x + 42, y, 16, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPipes(alpha) {
    for (const p of pipes) {
      const x = lerp(p.prevX, p.x, alpha);
      const bottomY = p.top + PIPE_GAP;
      ctx.fillStyle = getVar('--pipe');
      ctx.fillRect(x, 0, PIPE_W, p.top);
      ctx.fillRect(x, bottomY, PIPE_W, H - GROUND_H - bottomY);
      // lips
      ctx.fillStyle = getVar('--pipe-dark');
      ctx.fillRect(x - 4, p.top - 22, PIPE_W + 8, 22);
      ctx.fillRect(x - 4, bottomY, PIPE_W + 8, 22);
      // highlight
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + 8, 0, 8, p.top - 22);
      ctx.fillRect(x + 8, bottomY + 22, 8, H - GROUND_H - bottomY - 22);
    }
  }

  function drawGround(alpha) {
    const y = H - GROUND_H;
    const offset = -(lerp(prevGroundDist, groundDist, alpha) % 24);
    ctx.fillStyle = getVar('--ground');
    ctx.fillRect(0, y, W, GROUND_H);
    ctx.fillStyle = getVar('--ground-dark');
    ctx.fillRect(0, y, W, 6);
    for (let x = offset; x < W; x += 24) {
      ctx.fillRect(x, y + 6, 12, 6);
    }
  }

  function drawBird(alpha) {
    ctx.save();
    ctx.translate(bird.x, lerp(bird.prevY, bird.y, alpha));
    ctx.rotate(lerp(bird.prevRot, bird.rot, alpha));
    // body
    ctx.fillStyle = getVar('--bird');
    ctx.beginPath(); ctx.arc(0, 0, bird.r, 0, Math.PI * 2); ctx.fill();
    // wing (flaps while alive)
    const wingY = state === 'over' ? 2 : Math.sin(bird.t * 18) * 4;
    ctx.fillStyle = getVar('--bird-dark');
    ctx.beginPath(); ctx.ellipse(-4, wingY + 2, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
    // eye
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(6, -5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(7.5, -5, 2.4, 0, Math.PI * 2); ctx.fill();
    // beak
    ctx.fillStyle = '#ff7a2f';
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(22, 3); ctx.lineTo(12, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function text(str, x, y, size, align = 'center') {
    ctx.font = `bold ${size}px ${getVar('--brand-font')}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = getVar('--text');
    ctx.fillText(str, x, y);
  }

  function drawUI() {
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      text(String(score), W / 2, 70, 52);
      text('Pausa', W / 2, 220, 46);
      text('Toca para seguir', W / 2, 280, 22);
    } else if (state === 'playing') {
      text(String(score), W / 2, 70, 52);
    } else if (state === 'ready') {
      text('Vuela', W / 2, 150, 54);
      text('Toca para volar', W / 2, H / 2 + 60, 22);
      if (best > 0) text(`Récord: ${best}`, W / 2, H / 2 + 95, 18);
    } else if (state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, W, H);
      text('¡Fin!', W / 2, 170, 50);
      text(`Puntos: ${score}`, W / 2, 245, 28);
      text(`Récord: ${best}`, W / 2, 285, 22);
      if (overTimer > 0.6) text('Toca para reintentar', W / 2, 360, 20);
    }
  }

  const cssCache = {};
  function getVar(name) {
    if (!cssCache[name]) {
      cssCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    return cssCache[name];
  }

  function render(alpha) {
    drawBackground();
    drawPipes(alpha);
    drawGround(alpha);
    drawBird(alpha);
    drawUI();
  }

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
