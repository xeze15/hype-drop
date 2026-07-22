/* Plays a short alert tone on request (service workers can't play audio). */
'use strict';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'play-sound') beep();
});

function beep() {
  try {
    const Ctx = self.AudioContext || self.webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    // Two quick rising tones — an attention-grabbing "ding-ding".
    [0, 0.18].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1175;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.16);
    });
    setTimeout(() => ctx.close(), 600);
  } catch (e) {
    /* ignore */
  }
}
