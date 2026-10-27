let audioCtx = null;

export function playSound(tones, volume = 0.25) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const master = Math.max(0, Math.min(1, volume));
    let t = audioCtx.currentTime;
    for (const tone of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(master, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + tone.dur);
      t += tone.dur;
    }
  } catch (e) { console.warn('[sound] failed', e); }
}

export const SOUNDS = {
  mug:    [{ freq: 880, dur: 0.18 }, { freq: 660, dur: 0.18 }, { freq: 880, dur: 0.18 }, { freq: 660, dur: 0.18 }],
  drug:   [{ freq: 523, dur: 0.12 }, { freq: 659, dur: 0.12 }, { freq: 784, dur: 0.20 }],
  bazaar: [{ freq: 660, dur: 0.10 }, { freq: 880, dur: 0.10 }, { freq: 1320, dur: 0.22 }],
};