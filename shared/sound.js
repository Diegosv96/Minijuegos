// Small synthesized sounds (Web Audio, no audio files) shared by every game.
// Exposes window.sound = { unlock(), tone() }.
// Browsers (iOS above all) only allow audio after a user gesture, so each
// game calls sound.unlock() from its first tap or key press.
(() => {
  let audio = null;

  function unlock() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { audio = new AC(); } catch (e) { return; }
    }
    if (audio.state === 'suspended') audio.resume();
  }

  // Plays one note `delay` seconds from now. Silently does nothing until unlocked.
  function tone(freq, delay, dur, vol, type = 'sine') {
    if (!audio || audio.state !== 'running') return;
    const start = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  window.sound = { unlock, tone };
})();
