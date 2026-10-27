(() => {
  // ---------- Configuration ----------
  const H = 640;                   // logical height; the width follows the screen shape
  const MIN_W = 280, MAX_W = 480;  // beyond this range the game is letterboxed
  const BLOCK_H = 28;
  const BASE_W = 200;              // width of the first block
  const GROUND_Y = H - 90;         // top of the base block on screen before the camera moves
  const TOP_Y = 300;               // the camera keeps the tower top around this height
  const SPEED_START = 170;         // px/s of the moving block
  const SPEED_STEP = 6;            // px/s added per block
  const SPEED_MAX = 430;
  const PERFECT = 6;               // px of tolerance for a perfect drop
  const PERFECT_GROW = 10;         // px regained after PERFECT_STREAK perfect drops in a row
  const PERFECT_STREAK = 3;
  const GRAVITY = 1500;            // px/s² for the cut-off pieces
  const STEP = 1 / 60;             // fixed physics step
  const GAME_ID = 'apila';
  // Sandwich layers, from the bottom: bread again every LAYERS.length levels
  const LAYERS = ['bread', 'cheese', 'tomato', 'lettuce', 'ham'];

  // Blocks that give a prize when placed (block number -> kind)
  const PRIZE_BLOCKS = { 10: 'gold', 25: 'gold', 50: 'gold', 100: 'super' };
  const PRIZE_TEXT = { gold: '¡Has ganado un premio!', super: '¡Premio superior!' };
  const PRIZE_TIME = 2.2;          // s the prize banner stays on screen

  // ---------- Token supplied by the app (?token=...), see shared/bridge.js ----------
  const token = window.getToken();

  // ---------- Best score (per device) ----------
  function loadBest() {
    try { return parseInt(localStorage.getItem('apila_best') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('apila_best', String(v)); } catch (e) {}
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
  function playSound(kind, streak = 0) {
    if (kind === 'place') {                       // soft "tock"
      sound.tone(330, 0, 0.12, 0.18, 'triangle');
    } else if (kind === 'perfect') {              // climbs with the streak
      const f = 784 * Math.pow(2, Math.min(streak - 1, 7) / 12);
      sound.tone(f, 0, 0.18, 0.14, 'triangle');
      sound.tone(f * 1.5, 0.05, 0.22, 0.1, 'triangle');
    } else if (kind === 'miss') {                 // falling tone
      sound.tone(220, 0, 0.25, 0.16, 'sawtooth');
      sound.tone(147, 0.12, 0.35, 0.14, 'sawtooth');
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
    const oldW = W;
    W = Math.max(MIN_W, Math.min(MAX_W, H * cw / ch));   // not rounded: avoids 1px bars
    // webviews often resize right after loading: keep the sandwich centered
    if (tower) {
      const dx = (W - oldW) / 2;
      for (const b of tower) b.x += dx;
      for (const p of pieces) p.x += dx;
      if (moving) { moving.x += dx; moving.prevX += dx; }
    }
    scale = Math.min(cw / W, ch / H);
    safeTop = (parseFloat(getComputedStyle(safeProbe).paddingTop) || 0) / scale;
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  // ---------- State ----------
  // Block positions are in world units: x from the left edge, level 0 is the base.
  let state, paused, tower, moving, pieces, score, best, streak, perfects, camY, prevCamY,
      overTimer, playTime, prize, flash;
  best = loadBest();

  function reset() {
    state = 'ready';               // ready | playing | over
    paused = false;
    const w = Math.min(BASE_W, W * 0.6);
    tower = [{ x: (W - w) / 2, w, layer: LAYERS[0] }];
    moving = null;
    pieces = [];                   // cut-off parts falling away
    score = 0;
    streak = 0;
    perfects = 0;
    camY = prevCamY = 0;           // how many px the view has risen
    overTimer = 0;
    playTime = 0;
    prize = null;                  // banner on screen: { kind, t }
    flash = null;                  // white outline after a perfect drop: { level, t }
  }

  function speed() {
    return Math.min(SPEED_MAX, SPEED_START + SPEED_STEP * score);
  }

  // Next block enters from alternating sides with the width of the top block
  function spawnBlock() {
    const top = tower[tower.length - 1];
    const fromLeft = tower.length % 2 === 1;
    const x = fromLeft ? -top.w : W;
    moving = { x, prevX: x, w: top.w, dir: fromLeft ? 1 : -1, layer: LAYERS[tower.length % LAYERS.length] };
  }

  // Screen y of the top edge of a tower level
  function levelY(level, cam) {
    return GROUND_Y - level * BLOCK_H + cam;
  }

  // ---------- Input ----------
  function tap() {
    if (paused) {
      paused = false;              // resume without dropping the block
    } else if (state === 'ready') {
      state = 'playing';
      spawnBlock();
    } else if (state === 'playing') {
      drop();
    } else if (state === 'over' && overTimer > 0.6) {
      reset();                     // small delay prevents accidental restarts
    }
  }
  // Listen on the whole window so the letterbox bars also respond to taps
  window.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.button > 0) return;      // ignore right/middle mouse buttons
    sound.unlock();
    tap();
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') {
      e.preventDefault();
      sound.unlock();
      if (!e.repeat) tap();        // holding the key must not drop several blocks
    }
  });

  // ---------- Logic ----------
  function drop() {
    const top = tower[tower.length - 1];
    const b = moving;
    const level = tower.length;
    moving = null;

    const left = Math.max(b.x, top.x), right = Math.min(b.x + b.w, top.x + top.w);
    const overlap = right - left;
    if (overlap <= 0) {            // missed the tower completely
      pieces.push({ x: b.x, w: b.w, level, layer: b.layer, y: 0, prevY: 0, vy: 0, rot: 0, prevRot: 0, vr: b.dir * 1.5 });
      gameOver();
      return;
    }

    let placed;
    if (Math.abs(b.x - top.x) <= PERFECT) {
      streak++;
      perfects++;
      let w = top.w;
      if (streak >= PERFECT_STREAK) w = Math.min(BASE_W, w + PERFECT_GROW);   // reward streaks
      placed = { x: top.x - (w - top.w) / 2, w, layer: b.layer };
      flash = { level, t: 0 };
      playSound('perfect', streak);
    } else {
      streak = 0;
      placed = { x: left, w: overlap, layer: b.layer };
      // the overhanging part falls off
      const cutX = b.x < top.x ? b.x : right;
      const cutW = b.w - overlap;
      pieces.push({ x: cutX, w: cutW, level, layer: b.layer, y: 0, prevY: 0, vy: 0, rot: 0, prevRot: 0,
                    vr: (b.x < top.x ? -1 : 1) * (1 + Math.random()) });
      playSound('place');
    }
    tower.push(placed);
    score++;

    const kind = PRIZE_BLOCKS[score];
    if (kind) {
      prize = { kind, t: 0 };
      playSound(kind);
    }
    spawnBlock();
  }

  function gameOver() {
    state = 'over';
    overTimer = 0;
    playSound('miss');
    if (score > best) { best = score; saveBest(best); }
    window.notify({
      type: 'game_over',
      game: GAME_ID,
      score,
      perfects,
      durationMs: Math.round(playTime * 1000),   // excludes time spent paused
      token,
      ts: new Date().toISOString()
    });
  }

  function savePrevious() {
    // positions before this step, used to interpolate when drawing
    prevCamY = camY;
    if (moving) moving.prevX = moving.x;
    for (const p of pieces) { p.prevY = p.y; p.prevRot = p.rot; }
  }

  function update(dt) {
    savePrevious();
    if (prize && (prize.t += dt) > PRIZE_TIME) prize = null;
    if (flash && (flash.t += dt) > 0.4) flash = null;

    // camera follows the tower top; smooth catch-up instead of a jump
    const targetCam = Math.max(0, (tower.length - 1) * BLOCK_H - (GROUND_Y - TOP_Y));
    camY += (targetCam - camY) * Math.min(1, dt * 6);

    for (const p of pieces) {
      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    pieces = pieces.filter(p => levelY(p.level, camY) + p.y < H + 200);

    if (state === 'over') { overTimer += dt; return; }
    if (state !== 'playing') return;

    playTime += dt;
    if (moving) {
      moving.x += moving.dir * speed() * dt;
      // bounce a little past the screen edges so the block can be dropped anywhere
      const minX = -moving.w * 0.5, maxX = W - moving.w * 0.5;
      if (moving.x < minX) { moving.x = minX; moving.dir = 1; }
      if (moving.x > maxX) { moving.x = maxX; moving.dir = -1; }
    }
  }

  // ---------- Drawing ----------
  const lerp = (a, b, t) => a + (b - a) * t;

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, getVar('--sky-top'));
    g.addColorStop(1, getVar('--sky-bottom'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // One sandwich layer; the pattern starts at x so it moves with the block
  function drawBlock(x, y, w, h, layer) {
    const radius = Math.min(layer === 'bread' ? 12 : 6, w / 2, h / 2);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
    else ctx.rect(x, y, w, h);                                 // iOS < 16
    ctx.fillStyle = getVar('--' + layer);
    ctx.fill();
    ctx.clip();
    if (layer === 'bread') {                   // golden crust with diagonal cuts
      ctx.fillStyle = getVar('--bread-top');
      ctx.fillRect(x, y, w, 9);
      ctx.fillStyle = getVar('--bread-score');
      for (let sx = x + 16; sx < x + w - 6; sx += 28) {
        ctx.beginPath(); ctx.ellipse(sx, y + h * 0.42, 9, 3, -0.45, 0, Math.PI * 2); ctx.fill();
      }
    } else if (layer === 'cheese') {           // holes
      ctx.fillStyle = getVar('--cheese-hole');
      for (let i = 0, hx = x + 10; hx < x + w; i++, hx += 22) {
        ctx.beginPath(); ctx.arc(hx, y + h * (i % 2 ? 0.32 : 0.66), 3.5 + (i % 3), 0, Math.PI * 2); ctx.fill();
      }
    } else if (layer === 'tomato') {           // slices with seeds
      ctx.fillStyle = getVar('--tomato-in');
      for (let tx = x + 4; tx < x + w; tx += 34) {
        ctx.beginPath(); ctx.ellipse(tx + 13, y + h / 2, 12, h / 2 - 5, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = getVar('--tomato-seed');
      for (let tx = x + 4; tx < x + w; tx += 34) {
        for (const d of [-5, 0, 5]) {
          ctx.beginPath(); ctx.ellipse(tx + 13 + d, y + h / 2 + (d ? 2 : -2), 1.6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (layer === 'lettuce') {          // curly top edge and veins
      ctx.fillStyle = getVar('--lettuce-light');
      for (let lx = x; lx < x + w + 8; lx += 14) {
        ctx.beginPath(); ctx.arc(lx, y + 3, 8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let lx = x + 10; lx < x + w; lx += 20) { ctx.moveTo(lx, y + h - 3); ctx.lineTo(lx + 6, y + 9); }
      ctx.stroke();
    } else if (layer === 'ham') {              // wavy strip of fat
      ctx.strokeStyle = getVar('--ham-fat');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.5);
      for (let i = 0, hx = x; hx < x + w; i++, hx += 12) ctx.quadraticCurveTo(hx + 6, y + h * (i % 2 ? 0.3 : 0.7), hx + 12, y + h * 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.15)';        // shade at the bottom for depth
    ctx.fillRect(x, y + h - 4, w, 4);
    ctx.restore();
  }

  function drawTower(cam) {
    // only the levels that are on screen
    const first = Math.max(0, Math.floor((cam - (H - GROUND_Y)) / BLOCK_H) - 1);
    for (let i = first; i < tower.length; i++) {
      const b = tower[i];
      const y = levelY(i, cam);
      if (y > H) continue;
      drawBlock(b.x, y, b.w, BLOCK_H, b.layer);
    }
    // the base continues down to the bottom of the screen
    const baseBottom = levelY(0, cam) + BLOCK_H;
    if (baseBottom < H) {
      ctx.fillStyle = getVar('--ground');           // counter the sandwich sits on
      ctx.fillRect(0, baseBottom, W, H - baseBottom);
      ctx.fillStyle = getVar('--ground-stripe');
      ctx.fillRect(0, baseBottom, W, 5);
    }
    if (flash) {
      const b = tower[flash.level];
      ctx.save();
      ctx.globalAlpha = 1 - flash.t / 0.4;
      ctx.strokeStyle = getVar('--flash');
      ctx.lineWidth = 3;
      const grow = flash.t * 30;
      ctx.strokeRect(b.x - grow, levelY(flash.level, cam) - grow, b.w + grow * 2, BLOCK_H + grow * 2);
      ctx.restore();
    }
  }

  function drawMoving(alpha, cam) {
    if (!moving) return;
    drawBlock(lerp(moving.prevX, moving.x, alpha), levelY(tower.length, cam), moving.w, BLOCK_H, moving.layer);
  }

  function drawPieces(alpha, cam) {
    for (const p of pieces) {
      const y = levelY(p.level, cam) + lerp(p.prevY, p.y, alpha);
      ctx.save();
      ctx.translate(p.x + p.w / 2, y + BLOCK_H / 2);
      ctx.rotate(lerp(p.prevRot, p.rot, alpha));
      drawBlock(-p.w / 2, -BLOCK_H / 2, p.w, BLOCK_H, p.layer);
      ctx.restore();
    }
  }

  function text(str, x, y, size, align = 'center') {
    ctx.font = `bold ${size}px ${getVar('--brand-font')}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = getVar('--text-outline');
    ctx.strokeText(str, x, y, W - 32);   // shrinks to fit narrow screens
    ctx.fillStyle = getVar('--text');
    ctx.fillText(str, x, y, W - 32);
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
    ctx.fillStyle = getVar(`--prize-${prize.kind}-dark`);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    else ctx.rect(-w / 2, -h / 2, w, h);                       // iOS < 16
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = getVar(`--prize-${prize.kind}`);
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
      text('Sándwich gigante', W / 2, top + 150, 42);
      text('Toca para soltar el ingrediente', W / 2, top + 215, 20);
      if (best > 0) text(`Récord: ${best}`, W / 2, top + 250, 18);
    } else if (state === 'over') {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(0, 0, W, H);
      text('¡Fin!', W / 2, top + 150, 50);
      text(`Capas: ${score}`, W / 2, top + 225, 28);
      text(`Récord: ${best}`, W / 2, top + 265, 22);
      if (overTimer > 0.6) text('Toca para reintentar', W / 2, top + 330, 20);
    }
  }

  function render(alpha) {
    const cam = lerp(prevCamY, camY, alpha);
    drawBackground();
    drawTower(cam);
    drawPieces(alpha, cam);
    drawMoving(alpha, cam);
    drawUI();
  }

  resize();
  reset();

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
