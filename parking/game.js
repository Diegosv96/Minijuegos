(() => {
  // ---------- Configuration ----------
  const H = 640;                   // logical height; the width follows the screen shape
  const MIN_W = 280, MAX_W = 480;  // beyond this range the game is letterboxed
  const GROUND_Y = 520;            // where wheels and feet touch the asphalt
  const GRAVITY = 2300;            // px/s²
  const JUMP_V = -840;             // px/s
  const SHORT_HOP_V = -380;        // letting go early caps the rise at this speed
  const JUMP_BUFFER = 0.12;        // s a tap just before landing is remembered
  const START_SPEED = 250;         // px/s
  const MAX_SPEED = 460;
  const ACCEL = 5;                 // px/s gained per second of play
  const CART_X = 80;               // centre of the cart
  const CART_S = 1.4;              // drawing scale of the cart
  const STEP = 1 / 60;             // fixed physics step
  const GAME_ID = 'parking';

  // Obstacles jumped that give a prize (score -> kind)
  const PRIZE_AT = { 10: 'gold', 25: 'gold', 50: 'gold', 100: 'super' };
  const PRIZE_TEXT = { gold: '¡Has ganado un premio!', super: '¡Premio superior!' };
  const PRIZE_TIME = 2.2;          // s the prize banner stays on screen

  // Hit boxes of the obstacles (the drawing is a little larger, so near misses count)
  const KINDS = {
    person: { w: 26, h: 50 },
    pair:   { w: 58, h: 50 },      // two customers chatting side by side
    car:    { w: 92, h: 44 },
    van:    { w: 96, h: 62 }
  };
  const CAR_COLORS = ['--car-1', '--car-2', '--car-3', '--car-4', '--car-5'];
  const SHIRT_COLORS = ['--shirt-1', '--shirt-2', '--shirt-3', '--shirt-4'];

  // ---------- Token supplied by the app (?token=...), see shared/bridge.js ----------
  const token = window.getToken();

  // ---------- Best score (per device) ----------
  function loadBest() {
    try { return parseInt(localStorage.getItem('parking_best') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('parking_best', String(v)); } catch (e) {}
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
    if (kind === 'jump') {                        // quick upward "boing"
      sound.tone(523, 0, 0.12, 0.1, 'triangle');  // C5
      sound.tone(784, 0.04, 0.12, 0.08, 'triangle'); // G5
    } else if (kind === 'point') {                // short "plim"
      sound.tone(1568, 0, 0.16, 0.16);            // G6
      sound.tone(2093, 0.05, 0.22, 0.12);         // C7
    } else if (kind === 'crash') {                // low thud
      sound.tone(160, 0, 0.3, 0.2, 'square');
      sound.tone(110, 0.05, 0.35, 0.18, 'square');
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
  const bgCanvas = document.createElement('canvas');   // sky and clouds, drawn once per resize
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
    safeTop = (parseFloat(getComputedStyle(safeProbe).paddingTop) || 0) / scale;
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
  let state, paused, cart, obstacles, toNext, speed, score, best, dist, prevDist, overTimer, playTime, prize, buffer;
  best = loadBest();

  function reset() {
    state = 'ready';               // ready | playing | over
    paused = false;
    cart = { y: GROUND_Y, vy: 0, rot: 0, onGround: true, t: 0 };
    cart.prevY = cart.y;
    cart.prevRot = cart.rot;
    obstacles = [];
    toNext = 320;                  // px of road before the first obstacle
    speed = START_SPEED;
    score = 0;
    dist = prevDist = 0;           // px travelled, moves the scenery
    overTimer = 0;
    playTime = 0;
    prize = null;                  // banner on screen: { kind, t }
    buffer = 0;                    // time left on a buffered jump
  }
  reset();

  // ---------- Input ----------
  function jump() {
    cart.vy = JUMP_V;
    cart.onGround = false;
    buffer = 0;
    playSound('jump');
  }

  function press() {
    if (paused) {
      paused = false;              // resume on the next tap, no jump
    } else if (state === 'ready') {
      state = 'playing';
      jump();
    } else if (state === 'playing') {
      if (cart.onGround) jump();
      else buffer = JUMP_BUFFER;   // jump as soon as it lands
    } else if (state === 'over' && overTimer > 0.6) {
      reset();                     // small delay prevents accidental restarts
    }
  }

  function release() {
    // short tap = short hop; holding keeps the full jump
    if (state === 'playing' && cart.vy < SHORT_HOP_V) cart.vy = SHORT_HOP_V;
  }

  // Listen on the whole window so the letterbox bars also respond to taps
  window.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.button > 0) return;      // ignore right/middle mouse buttons
    sound.unlock();
    press();
  }, { passive: false });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      sound.unlock();
      if (!e.repeat) press();      // holding the key must not auto-jump
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') release();
  });

  // ---------- Logic ----------
  const pick = list => list[Math.floor(Math.random() * list.length)];

  function spawn() {
    // vans and pairs of customers only show up once the player has warmed up
    const kinds = ['person', 'person', 'car'];
    if (score >= 5) kinds.push('van', 'car');
    if (score >= 8) kinds.push('pair');
    const kind = pick(kinds);
    const x = W + 20;
    obstacles.push({
      kind, x, prevX: x, w: KINDS[kind].w, h: KINDS[kind].h,
      color: kind === 'car' ? pick(CAR_COLORS) : pick(SHIRT_COLORS),
      color2: pick(SHIRT_COLORS),
      t: Math.random() * 10,       // animation phase so customers don't walk in step
      passed: false
    });
    // gap grows with speed so there is always time to land and jump again
    toNext = KINDS[kind].w + speed * (1 + Math.random() * 0.9) + 120;
  }

  function passObstacle(o) {
    o.passed = true;
    score++;
    const kind = PRIZE_AT[score];
    if (kind) {
      prize = { kind, t: 0 };
      playSound(kind);
    } else {
      playSound('point');
    }
  }

  function gameOver() {
    state = 'over';
    overTimer = 0;
    cart.vy = -420;                // bounce off the obstacle
    cart.onGround = false;
    playSound('crash');
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

  function hits(o) {
    // boxes shrunk a few px so grazing a bumper doesn't end the game
    const cl = CART_X - 15, cr = CART_X + 15, ct = cart.y - 30, cb = cart.y;
    const ol = o.x + 6, or = o.x + o.w - 6, ot = GROUND_Y - o.h + 6;
    return cr > ol && cl < or && cb > ot && ct < GROUND_Y;
  }

  function savePrevious() {
    // positions before this step, used to interpolate when drawing
    cart.prevY = cart.y;
    cart.prevRot = cart.rot;
    prevDist = dist;
    for (const o of obstacles) o.prevX = o.x;
  }

  function update(dt) {
    savePrevious();
    cart.t += dt;
    if (prize && (prize.t += dt) > PRIZE_TIME) prize = null;
    for (const o of obstacles) o.t += dt;

    if (state === 'ready') {
      dist += START_SPEED * 0.5 * dt;   // the cart rolls gently on the title screen
      return;
    }

    if (state === 'over') {
      overTimer += dt;
      // the cart flips over and lands on its side
      if (!cart.onGround) {
        cart.vy += GRAVITY * dt;
        cart.y += cart.vy * dt;
        cart.rot = Math.min(cart.rot + 7 * dt, Math.PI / 2);   // tips forward
        if (cart.y >= GROUND_Y) { cart.y = GROUND_Y; cart.onGround = true; }
      }
      return;
    }

    // playing
    playTime += dt;
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    dist += speed * dt;

    if (buffer > 0) buffer -= dt;
    if (!cart.onGround) {
      cart.vy += GRAVITY * dt;
      cart.y += cart.vy * dt;
      cart.rot = Math.max(-0.35, Math.min(0.35, cart.vy / 2400));   // nose up rising, down falling
      if (cart.y >= GROUND_Y) {
        cart.y = GROUND_Y;
        cart.vy = 0;
        cart.rot = 0;
        cart.onGround = true;
        if (buffer > 0) jump();
      }
    }

    toNext -= speed * dt;
    if (toNext <= 0) spawn();

    for (const o of obstacles) {
      o.x -= speed * dt;
      if (!o.passed && o.x + o.w < CART_X - 15) passObstacle(o);
      if (hits(o)) { gameOver(); return; }
    }
    obstacles = obstacles.filter(o => o.x + o.w > -20);
  }

  // ---------- Drawing ----------
  const lerp = (a, b, t) => a + (b - a) * t;

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);     // iOS < 16
    ctx.fill();
  }

  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, getVar('--sky-top'));
    g.addColorStop(0.6, getVar('--sky-bottom'));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // a few clouds high above the shop, spread over the current width
    c.fillStyle = getVar('--cloud');
    [[0.2, 110, 1], [0.7, 70, 0.8], [0.9, 190, 0.7], [0.45, 210, 0.9]].forEach(([fx, y, s]) => {
      const x = fx * W;
      c.beginPath();
      c.arc(x - 20 * s, y + 5 * s, 15 * s, 0, Math.PI * 2);
      c.arc(x, y - 4 * s, 20 * s, 0, Math.PI * 2);
      c.arc(x + 22 * s, y + 5 * s, 14 * s, 0, Math.PI * 2);
      c.rect(x - 20 * s, y + 5 * s, 42 * s, 14 * s);
      c.fill();
    });
  }

  // Supermarket front scrolling slower than the road (parallax): shop windows,
  // and every third bay the entrance with an awning and the sign
  const SHOP_TOP = 270, SHOP_BOTTOM = 420, BAY = 130;
  function drawShop(d) {
    const off = d * 0.35;
    ctx.fillStyle = getVar('--wall');
    ctx.fillRect(0, SHOP_TOP, W, SHOP_BOTTOM - SHOP_TOP);
    ctx.fillStyle = getVar('--wall-dark');
    ctx.fillRect(0, SHOP_TOP, W, 10);                     // roof edge
    ctx.fillRect(0, SHOP_BOTTOM - 8, W, 8);               // plinth
    const first = Math.floor(off / BAY);
    for (let i = first; i * BAY - off < W; i++) {
      const x = i * BAY - off;
      if (((i % 3) + 3) % 3 === 0) {
        // entrance: sliding glass doors, striped awning and the sign above
        ctx.fillStyle = getVar('--frame');
        ctx.fillRect(x + 20, SHOP_TOP + 62, 90, SHOP_BOTTOM - SHOP_TOP - 70);
        ctx.fillStyle = getVar('--glass');
        ctx.fillRect(x + 24, SHOP_TOP + 66, 40, SHOP_BOTTOM - SHOP_TOP - 74);
        ctx.fillRect(x + 66, SHOP_TOP + 66, 40, SHOP_BOTTOM - SHOP_TOP - 74);
        ctx.fillStyle = getVar('--glass-shine');
        ctx.fillRect(x + 30, SHOP_TOP + 72, 6, 40);
        ctx.fillRect(x + 72, SHOP_TOP + 72, 6, 40);
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = k % 2 ? getVar('--cloud') : getVar('--awning');
          ctx.fillRect(x + 10 + k * 18.3, SHOP_TOP + 44, 18.3, 14);
        }
        ctx.fillStyle = getVar('--awning');
        roundRect(x + 25, SHOP_TOP + 14, 80, 24, 6);
        ctx.fillStyle = getVar('--sign');
        ctx.font = `bold 16px ${getVar('--brand-font')}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SÚPER', x + 65, SHOP_TOP + 27);
      } else {
        // shop window with a couple of posters
        ctx.fillStyle = getVar('--frame');
        ctx.fillRect(x + 12, SHOP_TOP + 40, BAY - 24, 90);
        ctx.fillStyle = getVar('--glass');
        ctx.fillRect(x + 16, SHOP_TOP + 44, BAY - 32, 82);
        ctx.fillStyle = getVar('--glass-shine');
        ctx.beginPath();
        ctx.moveTo(x + 24, SHOP_TOP + 126); ctx.lineTo(x + 50, SHOP_TOP + 44);
        ctx.lineTo(x + 62, SHOP_TOP + 44); ctx.lineTo(x + 36, SHOP_TOP + 126);
        ctx.fill();
        ctx.fillStyle = getVar('--sign');
        roundRect(x + 70, SHOP_TOP + 56, 30, 38, 4);
        ctx.fillStyle = getVar('--item-red');
        roundRect(x + 76, SHOP_TOP + 64, 18, 8, 2);
      }
    }
  }

  // Car park: pavement, kerb, painted bays behind the lane and a dashed lane line
  function drawParking(d) {
    ctx.fillStyle = getVar('--sidewalk');
    ctx.fillRect(0, SHOP_BOTTOM, W, 18);
    ctx.fillStyle = getVar('--curb');
    ctx.fillRect(0, SHOP_BOTTOM + 18, W, 6);
    ctx.fillStyle = getVar('--asphalt');
    ctx.fillRect(0, SHOP_BOTTOM + 24, W, H - SHOP_BOTTOM - 24);

    ctx.fillStyle = getVar('--paint');
    // bay lines behind the lane, slightly slanted
    const bay = 70, offB = d % bay;
    for (let x = -offB - bay; x < W + bay; x += bay) {
      ctx.beginPath();
      ctx.moveTo(x, SHOP_BOTTOM + 28); ctx.lineTo(x + 4, SHOP_BOTTOM + 28);
      ctx.lineTo(x + 18, GROUND_Y - 28); ctx.lineTo(x + 14, GROUND_Y - 28);
      ctx.fill();
    }
    ctx.fillRect(0, GROUND_Y - 28, W, 3);
    // dashed lane line in front of the cart
    const dash = 48, offD = d % dash;
    for (let x = -offD; x < W; x += dash) ctx.fillRect(x, GROUND_Y + 40, 26, 5);
    // bays at the front edge of the screen
    for (let x = -offB; x < W + bay; x += bay) ctx.fillRect(x, H - 50, 4, 50);
    ctx.fillRect(0, H - 50, W, 3);
  }

  // Street lamps on the pavement, moving with the road
  function drawLamps(d) {
    const gap = 360, off = d % gap;
    for (let x = gap - off - 60; x < W + 40; x += gap) {
      ctx.fillStyle = getVar('--lamp');
      ctx.fillRect(x - 2, SHOP_BOTTOM - 130, 5, 148);
      roundRect(x - 2, SHOP_BOTTOM - 134, 26, 7, 3);
      ctx.fillStyle = getVar('--lamp-light');
      roundRect(x + 12, SHOP_BOTTOM - 128, 12, 4, 2);
    }
  }

  // Smiling face, as on the products in "Carro volador"
  function face(cx, cy, w) {
    ctx.fillStyle = getVar('--face');
    circle(cx - w * 0.22, cy, 1.2);
    circle(cx + w * 0.22, cy, 1.2);
    ctx.strokeStyle = getVar('--face');
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy + 1.5, w * 0.18, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }

  // Customer standing at x (left edge) with a shopping bag
  function drawPerson(x, shirt, t, flip) {
    const g = GROUND_Y, cx = x + 13;
    const swing = Math.sin(t * 6) * 3;                     // idle sway of the legs
    ctx.fillStyle = getVar('--trousers');
    roundRect(cx - 7 + swing * 0.3, g - 20, 6, 20, 3);
    roundRect(cx + 1 - swing * 0.3, g - 20, 6, 20, 3);
    ctx.fillStyle = getVar(shirt);
    roundRect(cx - 9, g - 40, 18, 23, 6);
    // arm holding the bag on the side facing the cart
    const side = flip ? 1 : -1;
    ctx.fillStyle = getVar('--bag');
    roundRect(cx + side * 13 - 6, g - 26, 12, 13, 2);
    ctx.strokeStyle = getVar('--frame');
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx + side * 13, g - 26, 3.5, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = getVar(shirt);
    roundRect(cx + side * 8 - 2.5, g - 38, 5, 14, 2.5);
    // head and hair
    ctx.fillStyle = getVar('--skin');
    circle(cx, g - 48, 9);
    ctx.fillStyle = getVar('--hair');
    ctx.beginPath();
    ctx.arc(cx, g - 50, 9, Math.PI, 0);
    ctx.fill();
    face(cx, g - 47, 16);
  }

  function wheel(x, y, r) {
    ctx.fillStyle = getVar('--tyre');
    circle(x, y, r);
    ctx.fillStyle = getVar('--hubcap');
    circle(x, y, r * 0.45);
  }

  function drawCar(x, w, color) {
    const g = GROUND_Y;
    ctx.fillStyle = getVar(color);
    // cabin, then body
    ctx.beginPath();
    ctx.moveTo(x + 18, g - 30); ctx.lineTo(x + 28, g - 48);
    ctx.lineTo(x + w - 30, g - 48); ctx.lineTo(x + w - 16, g - 30);
    ctx.fill();
    roundRect(x, g - 34, w, 24, 8);
    ctx.fillStyle = getVar('--glass');
    ctx.beginPath();
    ctx.moveTo(x + 24, g - 32); ctx.lineTo(x + 31, g - 45);
    ctx.lineTo(x + w / 2 - 2, g - 45); ctx.lineTo(x + w / 2 - 2, g - 32);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w / 2 + 2, g - 32); ctx.lineTo(x + w / 2 + 2, g - 45);
    ctx.lineTo(x + w - 32, g - 45); ctx.lineTo(x + w - 21, g - 32);
    ctx.fill();
    ctx.fillStyle = getVar('--lamp-light');
    roundRect(x + 2, g - 28, 7, 5, 2);                   // headlight
    ctx.fillStyle = getVar('--item-red');
    roundRect(x + w - 6, g - 28, 5, 5, 2);               // tail light
    wheel(x + 20, g - 9, 9);
    wheel(x + w - 20, g - 9, 9);
  }

  function drawVan(x, w) {
    const g = GROUND_Y;
    ctx.fillStyle = getVar('--van');
    roundRect(x, g - 66, w, 56, 8);
    // sloped front with the windscreen
    ctx.fillStyle = getVar('--glass');
    ctx.beginPath();
    ctx.moveTo(x + 4, g - 40); ctx.lineTo(x + 12, g - 60);
    ctx.lineTo(x + 30, g - 60); ctx.lineTo(x + 30, g - 40);
    ctx.fill();
    ctx.fillStyle = getVar('--van-stripe');
    ctx.fillRect(x + 34, g - 36, w - 34, 8);
    ctx.strokeStyle = getVar('--hubcap');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 33, g - 62); ctx.lineTo(x + 33, g - 12);     // door seam
    ctx.stroke();
    ctx.fillStyle = getVar('--lamp-light');
    roundRect(x + 1, g - 26, 7, 6, 2);
    wheel(x + 20, g - 9, 10);
    wheel(x + w - 20, g - 9, 10);
  }

  function drawObstacles(alpha) {
    for (const o of obstacles) {
      const x = lerp(o.prevX, o.x, alpha);
      if (o.kind === 'person') drawPerson(x, o.color, o.t, false);
      else if (o.kind === 'pair') { drawPerson(x, o.color, o.t, true); drawPerson(x + 32, o.color2, o.t + 1, false); }
      else if (o.kind === 'car') drawCar(x, o.w, o.color);
      else drawVan(x, o.w);
    }
  }

  // Shopping cart with its shopping, wheels at (0, 0) before scaling
  function drawCart(alpha) {
    const y = lerp(cart.prevY, cart.y, alpha);
    // shadow on the asphalt shrinks as the cart rises
    const lift = Math.max(0, GROUND_Y - y);
    ctx.fillStyle = getVar('--shadow');
    ctx.beginPath();
    ctx.ellipse(CART_X, GROUND_Y + 2, Math.max(8, 22 - lift * 0.08), 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(CART_X, y);
    ctx.rotate(lerp(cart.prevRot, cart.rot, alpha));
    ctx.scale(CART_S, CART_S);
    ctx.translate(0, -16);
    // shopping peeking out of the basket
    ctx.fillStyle = getVar('--item-red');
    circle(-5, -9, 5);                                                        // apple
    ctx.fillStyle = getVar('--item-green');
    ctx.fillRect(1, -15, 4, 9);                                               // leek
    ctx.save();
    ctx.translate(8, -10); ctx.rotate(0.5);
    ctx.fillStyle = getVar('--bread');
    ctx.fillRect(-2.5, -8, 5, 14);                                            // baguette
    ctx.restore();
    // basket: trapezoid with a wire grid, handle at the back (left)
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
    ctx.strokeStyle = getVar('--cart');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-15, -6); ctx.lineTo(-19, -12); ctx.lineTo(-23, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-11, 7); ctx.lineTo(-9, 10); ctx.lineTo(9, 10); ctx.stroke();
    // wheels with a spoke that turns as the cart rolls
    const spin = state === 'over' ? 0 : lerp(prevDist, dist, alpha) / 3;
    for (const wx of [-7, 7]) {
      ctx.fillStyle = getVar('--cart');
      circle(wx, 13, 3);
      ctx.strokeStyle = getVar('--cart-wire');
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(wx - Math.cos(spin) * 2.2, 13 - Math.sin(spin) * 2.2);
      ctx.lineTo(wx + Math.cos(spin) * 2.2, 13 + Math.sin(spin) * 2.2);
      ctx.stroke();
    }
    ctx.restore();
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
    roundRect(-w / 2, -h / 2, w, h, h / 2);
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
      text('Carrito a la fuga', W / 2, top + 130, 40);
      text('Toca para saltar', W / 2, top + 190, 22);
      text('Mantén pulsado para saltar más alto', W / 2, top + 222, 16);
      if (best > 0) text(`Récord: ${best}`, W / 2, top + 256, 18);
    } else if (state === 'over') {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(0, 0, W, H);
      text('¡Choque!', W / 2, top + 150, 50);
      text(`Puntos: ${score}`, W / 2, top + 225, 28);
      text(`Récord: ${best}`, W / 2, top + 265, 22);
      if (overTimer > 0.6) text('Toca para reintentar', W / 2, top + 330, 20);
    }
  }

  function render(alpha) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.restore();
    const d = lerp(prevDist, dist, alpha);
    drawShop(d);
    drawParking(d);
    drawLamps(d);
    drawObstacles(alpha);
    drawCart(alpha);
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
