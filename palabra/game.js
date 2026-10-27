(() => {
  // ---------- Configuration ----------
  const GAME_ID = 'palabra';
  const LEN = 5, TRIES = 6;
  const FLIP_MS = 300;             // delay between tiles when a row is revealed
  const EPOCH = Date.UTC(2026, 0, 1);   // day 0 of the daily word

  // max attempts for gold, silver and bronze
  const PRIZE_TRIES = [2, 4, 6];
  const PRIZES = [
    { id: 'gold',   name: 'Premio oro',    icon: '🥇' },
    { id: 'silver', name: 'Premio plata',  icon: '🥈' },
    { id: 'bronze', name: 'Premio bronce', icon: '🥉' }
  ];
  const KEYS = ['qwertyuiop', 'asdfghjklñ', '<zxcvbnm>'];   // < enter, > backspace

  const { SOLUTIONS } = window.WORDS;

  // ---------- Token supplied by the app (?token=...), see shared/bridge.js ----------
  const token = window.getToken();

  // ---------- Per-device storage ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
  }

  // ---------- Daily word ----------
  // Day number from the local calendar date, so the word changes at local midnight
  function today() {
    const d = new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000);
  }
  function dailyWord(day) {
    return SOLUTIONS[((day % SOLUTIONS.length) + SOLUTIONS.length) % SOLUTIONS.length];
  }

  // Lowercase, accents removed (ñ kept)
  function normalize(s) {
    return s.toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/\u0001/g, 'ñ');
  }

  // 'correct' | 'present' | 'absent' per letter; repeated letters count only as often as in the answer
  function evaluate(guess, answer) {
    const result = new Array(LEN).fill('absent');
    const left = {};
    for (let i = 0; i < LEN; i++) {
      if (guess[i] === answer[i]) result[i] = 'correct';
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < LEN; i++) {
      if (result[i] !== 'correct' && left[guess[i]] > 0) {
        result[i] = 'present';
        left[guess[i]]--;
      }
    }
    return result;
  }

  // ---------- DOM ----------
  const boardEl = document.getElementById('board');
  const keyboardEl = document.getElementById('keyboard');
  const toastEl = document.getElementById('toast');
  const modeEl = document.getElementById('mode');
  const switchEl = document.getElementById('switch');
  const winEl = document.getElementById('win');

  const tiles = [];                // tiles[row][col]
  const rows = [];
  for (let r = 0; r < TRIES; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    tiles.push([]);
    for (let c = 0; c < LEN; c++) {
      const t = document.createElement('div');
      t.className = 'tile';
      row.appendChild(t);
      tiles[r].push(t);
    }
    boardEl.appendChild(row);
    rows.push(row);
  }

  const keyEls = {};
  KEYS.forEach(line => {
    const row = document.createElement('div');
    row.className = 'krow';
    for (const k of line) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.key = k === '<' ? 'enter' : k === '>' ? 'back' : k;
      b.textContent = k === '<' ? 'Enviar' : k === '>' ? '⌫' : k;
      if (k === '<' || k === '>') b.className = 'wide';
      if (k === '>') b.setAttribute('aria-label', 'Borrar');
      row.appendChild(b);
      keyEls[b.dataset.key] = b;
    }
    keyboardEl.appendChild(row);
  });

  // ---------- State ----------
  let practice, day, answer, guesses, current, done, busy;

  function start(isPractice) {
    practice = isPractice;
    day = today();
    answer = practice ? SOLUTIONS[Math.floor(Math.random() * SOLUTIONS.length)] : dailyWord(day);
    guesses = [];
    current = '';
    done = false;
    busy = false;
    winEl.hidden = true;
    modeEl.textContent = practice ? 'Práctica · sin premio' : formatDay();
    switchEl.textContent = practice ? 'Del día' : 'Practicar';
    tiles.flat().forEach(t => { t.textContent = ''; t.className = 'tile'; t.style.animationDelay = ''; });
    Object.values(keyEls).forEach(k => k.removeAttribute('data-state'));

    if (!practice) {
      // restore today's game: the daily word can only be played once
      const saved = load('palabra_daily', null);
      if (saved && saved.day === day) {
        saved.guesses.forEach(g => { guesses.push(g); paintRow(guesses.length - 1, g, false); });
        done = saved.done;
        if (done) setTimeout(() => showEnd(false), 300);
      }
    }
  }

  function formatDay() {
    return new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ---------- Rendering ----------
  function renderCurrent() {
    const row = guesses.length;
    for (let c = 0; c < LEN; c++) {
      const t = tiles[row][c];
      t.textContent = current[c] || '';
      t.classList.toggle('filled', c < current.length);
    }
  }

  const RANK = { absent: 1, present: 2, correct: 3 };
  function paintKeys(guess, result) {
    for (let i = 0; i < LEN; i++) {
      const k = keyEls[guess[i]];
      if (k && (RANK[result[i]] > (RANK[k.dataset.state] || 0))) k.dataset.state = result[i];
    }
  }

  // Shows a guess with its colours, flipping tile by tile when `animate`
  function paintRow(row, guess, animate) {
    const result = evaluate(guess, answer);
    tiles[row].forEach((t, c) => {
      t.textContent = guess[c];
      if (!animate) { t.className = 'tile ' + result[c]; return; }
      setTimeout(() => {
        t.classList.add('flip');
        setTimeout(() => { t.className = 'tile flip ' + result[c]; }, FLIP_MS / 2 + 50);
      }, c * FLIP_MS);
    });
    const delay = animate ? LEN * FLIP_MS + 150 : 0;
    setTimeout(() => paintKeys(guess, result), delay);
    return delay;
  }

  let toastTimer = null;
  function toast(msg, ms = 1500) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  function shake() {
    const row = rows[guesses.length];
    row.classList.remove('shake');
    void row.offsetWidth;          // restart the animation
    row.classList.add('shake');
  }

  // ---------- Moves ----------
  function type(letter) {
    if (done || busy || current.length >= LEN) return;
    current += letter;
    renderCurrent();
    const t = tiles[guesses.length][current.length - 1];
    t.classList.remove('pop');
    void t.offsetWidth;
    t.classList.add('pop');
  }

  function back() {
    if (done || busy || !current) return;
    current = current.slice(0, -1);
    renderCurrent();
  }

  function submit() {
    if (done || busy) return;
    if (current.length < LEN) { shake(); toast('Faltan letras'); return; }

    const guess = current;
    guesses.push(guess);
    current = '';
    busy = true;
    const delay = paintRow(guesses.length - 1, guess, true);
    const won = guess === answer;
    done = won || guesses.length === TRIES;
    if (!practice) save('palabra_daily', { day, guesses, done });

    setTimeout(() => {
      busy = false;
      if (!done) return;
      if (won) bounce(guesses.length - 1);
      showEnd(true);
    }, delay);
  }

  function bounce(row) {
    tiles[row].forEach((t, c) => {
      t.style.animationDelay = (c * 0.08) + 's';
      t.classList.add('bounce');
    });
  }

  // ---------- End ----------
  function showEnd(fresh) {
    const won = guesses[guesses.length - 1] === answer;
    const attempts = guesses.length;
    const tier = won ? PRIZE_TRIES.findIndex(max => attempts <= max) : -1;
    const prize = !practice && tier >= 0 ? PRIZES[tier] : null;

    document.getElementById('win-medal').textContent = prize ? prize.icon : won ? '🎉' : '🧺';
    document.getElementById('win-title').textContent = won ? '¡Acertaste!' : 'Otra vez será';
    document.getElementById('win-detail').textContent = won
      ? `En ${attempts} ${attempts === 1 ? 'intento' : 'intentos'}`
      : `El artículo era ${answer.toUpperCase()}`;
    const prizeEl = document.getElementById('win-prize');
    prizeEl.hidden = practice;
    prizeEl.textContent = prize ? prize.name : 'Sin premio esta vez';
    prizeEl.className = 'prize' + (prize ? ' ' + prize.id : '');
    document.getElementById('win-next').hidden = practice;
    renderCountdown();
    setTimeout(() => { winEl.hidden = false; }, won && fresh ? 700 : 0);   // let the row bounce first

    if (!fresh) return;            // restored from storage: already reported
    if (won) playVictory(prize);
    if (practice) return;          // practice words give nothing
    window.notify({
      type: 'game_over',
      game: GAME_ID,
      score: won ? attempts : 0,               // attempts used, 0 if not solved
      solved: won,
      day,                                     // daily word number (local date)
      prize: prize ? prize.id : null,
      guesses,                                 // lets the backend check every attempt
      token,
      ts: new Date().toISOString()
    });
  }

  function renderCountdown() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((midnight - now) / 1000));
    const pad = v => String(v).padStart(2, '0');
    document.getElementById('win-countdown').textContent =
      `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }
  setInterval(() => {
    // a new day started while the page was open and today's game is over
    if (!practice && done && !busy && today() !== day) start(false);
    else if (!winEl.hidden) renderCountdown();
  }, 1000);

  function playVictory(prize) {
    // rising C major arpeggio, then a held chord (shorter without a prize)
    [523, 659, 784, 1047].forEach((f, i) => sound.tone(f, i * 0.1, 0.25, 0.15, 'triangle'));
    if (prize) [1047, 1319, 1568].forEach(f => sound.tone(f, 0.45, 1.0, 0.09, 'triangle'));
  }

  // ---------- Input ----------
  // Any first touch or key unlocks audio (required by iOS)
  window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

  function press(key) {
    if (key === 'enter') submit();
    else if (key === 'back') back();
    else type(key);
  }

  keyboardEl.addEventListener('pointerdown', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    e.preventDefault();
    press(btn.dataset.key);
  });

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    sound.unlock();
    if (!winEl.hidden) return;
    if (e.key === 'Enter') press('enter');
    else if (e.key === 'Backspace') press('back');
    else {
      const k = normalize(e.key);
      if (k.length === 1 && /[a-zñ]/.test(k)) press(k);
      else return;
    }
    e.preventDefault();
  });

  document.getElementById('practice').addEventListener('click', () => start(true));
  switchEl.addEventListener('click', () => { if (!busy) start(!practice); });
  document.getElementById('close').addEventListener('click', () => { winEl.hidden = true; });

  start(false);
})();
