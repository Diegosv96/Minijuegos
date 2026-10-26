(() => {
  // ---------- Configuration ----------
  const GAME_ID = 'sudoku';
  const N = 6;                     // 6x6 board, digits 1-6
  const BOX_R = 2, BOX_C = 3;      // blocks of 2 rows x 3 columns

  // givens: numbers shown at the start (fewer = harder)
  // prizes: max seconds for gold, silver and bronze
  const LEVELS = {
    easy:   { label: 'Fácil',   givens: 20, prizes: [45, 90, 180] },
    medium: { label: 'Medio',   givens: 15, prizes: [75, 150, 300] },
    hard:   { label: 'Difícil', givens: 11, prizes: [120, 240, 480] }
  };
  const PRIZES = [
    { id: 'gold',   name: 'Premio oro',    icon: '🥇' },
    { id: 'silver', name: 'Premio plata',  icon: '🥈' },
    { id: 'bronze', name: 'Premio bronce', icon: '🥉' }
  ];

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
  // peers[i]: indices sharing a row, column or block with cell i
  const peers = [];
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N;
    const br = r - r % BOX_R, bc = c - c % BOX_C;
    const set = new Set();
    for (let k = 0; k < N; k++) { set.add(r * N + k); set.add(k * N + c); }
    for (let y = br; y < br + BOX_R; y++)
      for (let x = bc; x < bc + BOX_C; x++) set.add(y * N + x);
    set.delete(i);
    peers.push([...set]);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function candidates(g, i) {
    const used = new Set(peers[i].map(j => g[j]));
    const out = [];
    for (let d = 1; d <= N; d++) if (!used.has(d)) out.push(d);
    return out;
  }

  // Empty cell with the fewest candidates (-1 if the board is full)
  function bestEmpty(g) {
    let best = -1, bestCands = null;
    for (let i = 0; i < g.length; i++) {
      if (g[i]) continue;
      const cands = candidates(g, i);
      if (!bestCands || cands.length < bestCands.length) {
        best = i; bestCands = cands;
        if (cands.length <= 1) break;
      }
    }
    return [best, bestCands];
  }

  // Counts solutions up to `limit` (2 is enough to know if it is unique)
  function countSolutions(g, limit) {
    const [i, cands] = bestEmpty(g);
    if (i < 0) return 1;
    let total = 0;
    for (const d of cands) {
      g[i] = d;
      total += countSolutions(g, limit - total);
      if (total >= limit) break;
    }
    g[i] = 0;
    return total;
  }

  function fill(g) {
    const [i, cands] = bestEmpty(g);
    if (i < 0) return true;
    for (const d of shuffle(cands)) {
      g[i] = d;
      if (fill(g)) return true;
    }
    g[i] = 0;
    return false;
  }

  // Random full board, then removes numbers while the solution stays unique
  function makePuzzle(givens) {
    const solution = new Array(N * N).fill(0);
    fill(solution);
    const puzzle = solution.slice();
    let filled = N * N;
    for (const i of shuffle([...puzzle.keys()])) {
      if (filled <= givens) break;
      const v = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle, 2) === 1) filled--;
      else puzzle[i] = v;
    }
    return puzzle;
  }

  // ---------- DOM ----------
  const boardEl = document.getElementById('board');
  const timerEl = document.getElementById('timer');
  const pauseEl = document.getElementById('pause');
  const winEl = document.getElementById('win');
  const levelBtns = [...document.querySelectorAll('#levels button')];

  const cells = [];
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N;
    const el = document.createElement('div');
    el.className = `cell r${r} c${c}`;
    el.dataset.i = i;
    el.setAttribute('role', 'gridcell');
    el.style.setProperty('--wave-delay', ((r + c) * 0.04) + 's');   // diagonal wave when solved
    boardEl.appendChild(el);
    cells.push(el);
  }

  // ---------- State ----------
  let level = LEVELS[load('sudoku_level', 'easy')] ? load('sudoku_level', 'easy') : 'easy';
  let puzzle, grid, selected, history, won, paused;
  let elapsedMs, startedAt;        // timer: accumulated time + start of the running stretch
  let winTimeout = null;

  function newGame(lvl = level) {
    level = lvl;
    save('sudoku_level', level);
    levelBtns.forEach(b => b.classList.toggle('active', b.dataset.level === level));
    puzzle = makePuzzle(LEVELS[level].givens);
    grid = puzzle.slice();
    selected = grid.indexOf(0);
    history = [];
    won = false;
    paused = false;
    elapsedMs = 0;
    startedAt = performance.now();
    clearTimeout(winTimeout);
    boardEl.classList.remove('solved');
    pauseEl.hidden = true;
    winEl.hidden = true;
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

  // ---------- Rendering ----------
  function isConflict(i) {
    return grid[i] !== 0 && peers[i].some(j => grid[j] === grid[i]);
  }

  function render() {
    const selPeers = selected >= 0 ? new Set(peers[selected]) : new Set();
    const selValue = selected >= 0 ? grid[selected] : 0;
    cells.forEach((el, i) => {
      el.textContent = grid[i] || '';
      el.classList.toggle('given', puzzle[i] !== 0);
      el.classList.toggle('selected', i === selected);
      el.classList.toggle('peer', selPeers.has(i));
      el.classList.toggle('same', selValue !== 0 && i !== selected && grid[i] === selValue);
      el.classList.toggle('conflict', isConflict(i));
    });
  }

  // ---------- Moves ----------
  function canEdit() {
    return !won && !paused && selected >= 0 && puzzle[selected] === 0;
  }

  function setCell(v) {
    if (!canEdit() || grid[selected] === v) return;
    history.push({ i: selected, prev: grid[selected] });
    grid[selected] = v;
    if (v) {
      const el = cells[selected];
      el.classList.remove('pop');
      void el.offsetWidth;         // restart the animation
      el.classList.add('pop');
    }
    render();
    checkWin();
  }

  function undo() {
    if (won || paused || !history.length) return;
    const { i, prev } = history.pop();
    grid[i] = prev;
    selected = i;
    render();
  }

  function select(i) {
    if (won || paused) return;
    selected = i;
    render();
  }

  function move(dr, dc) {
    if (selected < 0) return select(0);
    const r = (Math.floor(selected / N) + dr + N) % N;
    const c = (selected % N + dc + N) % N;
    select(r * N + c);
  }

  // ---------- Win ----------
  function checkWin() {
    if (grid.some(v => v === 0) || grid.some((v, i) => isConflict(i))) return;
    won = true;
    stopTimer();
    renderTimer();
    selected = -1;
    render();
    boardEl.classList.add('solved');

    const ms = elapsedMs, secs = ms / 1000;
    const tier = LEVELS[level].prizes.findIndex(limit => secs <= limit);
    const prize = tier >= 0 ? PRIZES[tier] : null;

    const bestKey = 'sudoku_best_' + level;
    const prevBest = parseInt(load(bestKey, '0'), 10) || 0;
    const isRecord = !prevBest || ms < prevBest;
    if (isRecord) save(bestKey, Math.round(ms));

    document.getElementById('win-medal').textContent = prize ? prize.icon : '🧩';
    document.getElementById('win-time').textContent = formatTime(ms);
    const prizeEl = document.getElementById('win-prize');
    prizeEl.textContent = prize ? prize.name : 'Sin premio esta vez';
    prizeEl.className = 'prize' + (prize ? ' ' + prize.id : '');
    document.getElementById('win-best').textContent = isRecord
      ? `¡Nuevo récord en ${LEVELS[level].label}!`
      : `Récord en ${LEVELS[level].label}: ${formatTime(prevBest)}`;
    winTimeout = setTimeout(() => { winEl.hidden = false; }, 600);   // let the board wave first

    playVictory(prize);
    window.notify({
      type: 'game_over',
      game: GAME_ID,
      score: Math.round(secs),                 // seconds to solve (lower is better)
      durationMs: Math.round(ms),              // excludes time spent paused
      difficulty: level,
      prize: prize ? prize.id : null,
      puzzle: puzzle.join(''),                 // starting board, 0 = empty
      answer: grid.join(''),                   // lets the backend check the solution
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

  boardEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.cell');
    if (el) { e.preventDefault(); select(+el.dataset.i); }
  });

  document.getElementById('pad').addEventListener('pointerdown', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.n) setCell(+btn.dataset.n);
    else if (btn.dataset.action === 'erase') setCell(0);
    else if (btn.dataset.action === 'undo') undo();
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
    if (e.key >= '1' && e.key <= String(N)) setCell(+e.key);
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') setCell(0);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') undo();
    else if (e.key === 'ArrowUp') move(-1, 0);
    else if (e.key === 'ArrowDown') move(1, 0);
    else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key === 'ArrowRight') move(0, 1);
    else return;
    e.preventDefault();
  });

  newGame();
})();
