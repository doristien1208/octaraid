import { store } from './dom';

export type Sfx = 'click' | 'beep' | 'go' | 'chime' | 'join' | 'win' | 'lose' | 'error';

/** Sound effects synthesised with Web Audio (no sound files), as in 水球大亂鬥. */
export class Audio {
  sfxOn = store.get('octaraid.sfx') !== 'off';
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;

  /** Browsers only allow audio after a user gesture; call this from a click or key handler. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.4;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleSfx(): boolean {
    this.sfxOn = !this.sfxOn;
    store.set('octaraid.sfx', this.sfxOn ? 'on' : 'off');
    return this.sfxOn;
  }

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (name) {
      case 'click':
        this.tone(t, 1200, 1200, 0.03, 'square', 0.1);
        break;
      case 'beep':
        this.tone(t, 523, 523, 0.12, 'triangle', 0.35);
        break;
      case 'go':
        [523, 659, 784, 1047].forEach((f, k) => this.tone(t + k * 0.07, f, f, 0.16, 'triangle', 0.35));
        break;
      case 'chime':
        [880, 1175].forEach((f, k) => this.tone(t + k * 0.08, f, f, 0.14, 'sine', 0.25));
        break;
      case 'join':
        [392, 523].forEach((f, k) => this.tone(t + k * 0.09, f, f, 0.12, 'triangle', 0.3));
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, k) => this.tone(t + k * 0.11, f, f, 0.14, 'triangle', 0.3));
        break;
      case 'lose':
        [392, 349, 311, 262].forEach((f, k) => this.tone(t + k * 0.16, f, f, 0.18, 'triangle', 0.3));
        break;
      case 'error':
        this.tone(t, 220, 180, 0.15, 'square', 0.15);
        break;
    }
  }

  private tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.gain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.gain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
