(() => {
  // ---------- Configuration ----------
  const GAME_ID = 'reinas';

  // size: board is size x size with as many colour regions
  // prizes: max seconds for gold, silver and bronze
  const LEVELS = {
    easy:   { label: 'Fácil',   size: 6, prizes: [45, 90, 180] },
    medium: { label: 'Medio',   size: 7, prizes: [75, 150, 300] },
    hard:   { label: 'Difícil', size: 8, prizes: [120, 240, 480] }
  };
  const PRIZES = [
    { id: 'gold',   name: 'Premio oro',    icon: '🥇' },
    { id: 'silver', name: 'Premio plata',  icon: '🥈' },
    { id: 'bronze', name: 'Premio bronce', icon: '🥉' }
  ];
  const EMPTY = 0, MARK = 1, QUEEN = 2;   // a tap cycles empty -> mark -> queen -> empty
  const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>';

  // ---------- Token supplied by the app (?token=...), see shared/bridge.js ----------
  const token = window.getToken();

  // ---------- Per-device storage ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function save(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (e) {}
  }

  // ---------- Generator ----------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Orthogonal neighbours of cell i
  function neighbours(n, i) {
    const r = Math.floor(i / n), c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }

  // One queen per row and column, never touching the one in the row above.
  // Returns the column of the queen in each row.
  function placeQueens(n) {
    const cols = [], used = new Array(n).fill(false);
    (function rec(r) {
      if (r === n) return true;
      for (const c of shuffle([...Array(n).keys()])) {
        if (used[c] || (r > 0 && Math.abs(cols[r - 1] - c) <= 1)) continue;
        used[c] = true; cols[r] = c;
        if (rec(r + 1)) return true;
        used[c] = false;
      }
      return false;
    })(0);
    return cols;
  }

  // Each queen seeds a region; regions grow at random until they fill the board
  function growRegions(n, sol) {
    const reg = new Array(n * n).fill(-1);
    sol.forEach((c, r) => { reg[r * n + c] = r; });
    let left = n * n - n;
    while (left) {
      const k = Math.floor(Math.random() * n);
      const free = [];
      for (let i = 0; i < n * n; i++) {
        if (reg[i] === k) for (const j of neighbours(n, i)) if (reg[j] < 0) free.push(j);
      }
      if (!free.length) continue;
      reg[free[Math.floor(Math.random() * free.length)]] = k;
      left--;
    }
    return reg;
  }

  // A valid placement other than `sol`, or null if `sol` is the only one
  function findOther(n, reg, sol) {
    const cols = [], usedC = new Array(n).fill(false), usedR = new Array(n).fill(false);
    return (function rec(r) {
      if (r === n) return cols.some((c, i) => c !== sol[i]) ? cols.slice() : null;
      for (let c = 0; c < n; c++) {
        if (usedC[c] || (r > 0 && Math.abs(c - cols[r - 1]) <= 1)) continue;
        const g = reg[r * n + c];
        if (usedR[g]) continue;
        usedC[c] = usedR[g] = true; cols[r] = c;
        const s = rec(r + 1);
        usedC[c] = usedR[g] = false;
        if (s) return s;
      }
      return null;
    })(0);
  }

  // Whether region k stays in one piece once cell `without` leaves it
  function staysConnected(n, reg, k, without) {
    const cells = [];
    for (let i = 0; i < n * n; i++) if (reg[i] === k && i !== without) cells.push(i);
    const seen = new Set([cells[0]]), stack = [cells[0]];
    while (stack.length) {
      const i = stack.pop();
      for (const j of neighbours(n, i)) {
        if (j !== without && reg[j] === k && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    return seen.size === cells.length;
  }

  // Random regions, then repairs them while another solution exists: a cell used by
  // the other solution moves to a neighbouring region, which usually breaks it
  function makePuzzle(n) {
    for (;;) {
      const sol = placeQueens(n), reg = growRegions(n, sol);
      const queenCells = new Set(sol.map((c, r) => r * n + c));
      for (let step = 0; step < 200; step++) {
        const other = findOther(n, reg, sol);
        if (!other) return reg;
        let moved = false;
        for (const x of shuffle(other.map((c, r) => r * n + c).filter(i => !queenCells.has(i)))) {
          if (!staysConnected(n, reg, reg[x], x)) continue;
          const j = shuffle(neighbours(n, x)).find(j => reg[j] !== reg[x]);
          if (j !== undefined) { reg[x] = reg[j]; moved = true; break; }
        }
        if (!moved) break;           // stuck: start over with new regions
      }
    }
  }

  // ---------- DOM ----------
  const boardEl = document.getElementById('board');
  const timerEl = document.getElementById('timer');
  const pauseEl = document.getElementById('pause');
  const winEl = document.getElementById('win');
  const levelBtns = [...document.querySelectorAll('#levels button')];
  let cells = [];

  function buildBoard() {
    boardEl.textContent = '';
    boardEl.style.setProperty('--n', size);
    boardEl.setAttribute('aria-label', `Tablero de ${size} por ${size}`);
    cells = [];
    for (let i = 0; i < size * size; i++) {
      const r = Math.floor(i / size), c = i % size;
      const el = document.createElement('div');
      el.className = 'cell rg' + regions[i];
      // thick line where the region changes
      if (c < size - 1) el.classList.add(regions[i + 1] === regions[i] ? 'lr' : 'er');
      if (r < size - 1) el.classList.add(regions[i + size] === regions[i] ? 'lb' : 'eb');
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');
      el.style.setProperty('--wave-delay', ((r + c) * 0.04) + 's');   // diagonal wave when solved
      boardEl.appendChild(el);
      cells.push(el);
    }
  }

  // ---------- State ----------
  let level = LEVELS[load('reinas_level', 'easy')] ? load('reinas_level', 'easy') : 'easy';
  let size, regions, marks, history, won, paused;
  let elapsedMs, startedAt;        // timer: accumulated time + start of the running stretch
  let winTimeout = null;

  function newGame(lvl = level) {
    level = lvl;
    save('reinas_level', level);
    levelBtns.forEach(b => b.classList.toggle('active', b.dataset.level === level));
    size = LEVELS[level].size;
    regions = makePuzzle(size);
    marks = new Array(size * size).fill(EMPTY);
    history = [];
    won = false;
    paused = false;
    elapsedMs = 0;
    startedAt = performance.now();
    clearTimeout(winTimeout);
    boardEl.classList.remove('solved');
    pauseEl.hidden = true;
    winEl.hidden = true;
    buildBoard();
    render();
    renderTimer();
  }

  // ---------- Timer ----------
  function elapsed() {
    return elapsedMs + (startedAt === null ? 0 : performance.now() - startedAt);
  }
  function stopTimer() {
    elapsedMs = elapsed();
    startedAt = null;
  }
  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  function renderTimer() { timerEl.textContent = formatTime(elapsed()); }
  setInterval(renderTimer, 250);

  // Pause when the webview goes to background and hide the board meanwhile
  function pause() {
    if (won || paused) return;
    paused = true;
    stopTimer();
    pauseEl.hidden = false;
  }
  function resume() {
    if (!paused) return;
    paused = false;
    startedAt = performance.now();
    pauseEl.hidden = true;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);

  // ---------- Rules ----------
  // Queens that share a row, column or region with another queen, or touch it
  function conflicts() {
    const queens = [];
    marks.forEach((m, i) => { if (m === QUEEN) queens.push(i); });
    const bad = new Set();
    for (let a = 0; a < queens.length; a++) {
      for (let b = a + 1; b < queens.length; b++) {
        const i = queens[a], j = queens[b];
        const ri = Math.floor(i / size), ci = i % size, rj = Math.floor(j / size), cj = j % size;
        if (ri === rj || ci === cj || regions[i] === regions[j] ||
            (Math.abs(ri - rj) <= 1 && Math.abs(ci - cj) <= 1)) {
          bad.add(i); bad.add(j);
        }
      }
    }
    return { queens, bad };
  }

  // ---------- Rendering ----------
  function render() {
    const { bad } = conflicts();
    cells.forEach((el, i) => {
      const m = marks[i];
      if (+el.dataset.m !== m) {
        el.dataset.m = m;
        el.innerHTML = m === QUEEN ? CROWN : m === MARK ? '×' : '';
      }
      el.classList.toggle('conflict', bad.has(i));
    });
  }

  // ---------- Moves ----------
  function canEdit() {
    return !won && !paused;
  }

  function cycle(i) {
    const prev = marks[i];
    marks[i] = (prev + 1) % 3;
    history.push([{ i, prev }]);
    if (marks[i] === QUEEN) {
      const el = cells[i];
      el.classList.remove('pop');
      void el.offsetWidth;           // restart the animation
      el.classList.add('pop');
      sound.tone(880, 0, 0.12, 0.1, 'triangle');
    }
    render();
    checkWin();
  }

  function undo() {
    if (!canEdit() || !history.length) return;
    for (const { i, prev } of history.pop().reverse()) marks[i] = prev;
    render();
  }

  function clearBoard() {
    if (!canEdit()) return;
    const changes = [];
    marks.forEach((m, i) => { if (m !== EMPTY) changes.push({ i, prev: m }); });
    if (!changes.length) return;
    history.push(changes);
    marks.fill(EMPTY);
    render();
  }

  // ---------- Win ----------
  function checkWin() {
    const { queens, bad } = conflicts();
    if (queens.length !== size || bad.size) return;
    won = true;
    stopTimer();
    renderTimer();
    boardEl.classList.add('solved');

    const ms = elapsedMs, secs = ms / 1000;
    const tier = LEVELS[level].prizes.findIndex(limit => secs <= limit);
    const prize = tier >= 0 ? PRIZES[tier] : null;

    const bestKey = 'reinas_best_' + level;
    const prevBest = parseInt(load(bestKey, '0'), 10) || 0;
    const isRecord = !prevBest || ms < prevBest;
    if (isRecord) save(bestKey, Math.round(ms));

    document.getElementById('win-medal').textContent = prize ? prize.icon : '👑';
    document.getElementById('win-time').textContent = formatTime(ms);
    const prizeEl = document.getElementById('win-prize');
    prizeEl.textContent = prize ? prize.name : 'Sin premio esta vez';
    prizeEl.className = 'prize' + (prize ? ' ' + prize.id : '');
    document.getElementById('win-best').textContent = isRecord
      ? `¡Nuevo récord en ${LEVELS[level].label}!`
      : `Récord en ${LEVELS[level].label}: ${formatTime(prevBest)}`;
    winTimeout = setTimeout(() => { winEl.hidden = false; }, 700);   // let the board wave first

    playVictory(prize);
    window.notify({
      type: 'game_over',
      game: GAME_ID,
      score: Math.round(secs),                 // seconds to solve (lower is better)
      durationMs: Math.round(ms),              // excludes time spent paused
      difficulty: level,
      prize: prize ? prize.id : null,
      puzzle: regions.join(''),                // region of each cell, row by row
      answer: queens.map(i => i % size).join(''),   // queen column in each row
      token,
      ts: new Date().toISOString()
    });
  }

  function playVictory(prize) {
    // rising C major arpeggio, then a held chord (shorter without a prize)
    [523, 659, 784, 1047].forEach((f, i) => sound.tone(f, i * 0.1, 0.25, 0.15, 'triangle'));
    if (prize) [1047, 1319, 1568].forEach(f => sound.tone(f, 0.45, 1.0, 0.09, 'triangle'));
  }

  // ---------- Input ----------
  // Any first touch or key unlocks audio (required by iOS)
  window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

  // Tap cycles a cell; dragging across cells marks every empty one with ×
  let drag = null;                 // { start, last, moved, changes }

  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest('.cell');
    return cell && boardEl.contains(cell) ? +cell.dataset.i : -1;
  }
  function paintMark(i) {
    if (marks[i] !== EMPTY) return;
    drag.changes.push({ i, prev: EMPTY });
    marks[i] = MARK;
    render();
  }

  boardEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.cell');
    if (!el || !canEdit() || e.button > 0) return;
    e.preventDefault();
    const i = +el.dataset.i;
    drag = { start: i, last: i, moved: false, changes: [] };
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0 || i === drag.last) return;
    if (!drag.moved) { drag.moved = true; paintMark(drag.start); }
    paintMark(i);
    drag.last = i;
  });
  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) cycle(d.start);
    else if (d.changes.length) history.push(d.changes);
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', () => {
    if (drag && drag.changes.length) history.push(drag.changes);
    drag = null;
  });

  document.getElementById('tools').addEventListener('pointerdown', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.action === 'undo') undo();
    else if (btn.dataset.action === 'clear') clearBoard();
    else if (btn.dataset.action === 'new') newGame();
  });

  levelBtns.forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    newGame(b.dataset.level);
  }));

  pauseEl.addEventListener('pointerdown', e => { e.preventDefault(); resume(); });
  document.getElementById('again').addEventListener('click', () => newGame());

  window.addEventListener('keydown', e => {
    sound.unlock();
    if (paused) { resume(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  newGame();
})();
