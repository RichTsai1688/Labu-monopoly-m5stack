export type GameSound = 'income' | 'expense' | 'upgrade' | 'roll' | 'step' | 'coin' | 'bank' | 'win' | 'click';

type Tone = readonly [frequency: number, offset: number, duration: number, volume: number];

const SOUNDS: Record<GameSound, readonly Tone[]> = {
  income: [[659,0,.12,.025],[880,.09,.16,.023],[1047,.19,.2,.018]],
  expense: [[659,0,.1,.02],[494,.1,.14,.02],[330,.21,.18,.015]],
  upgrade: [[392,0,.1,.02],[523,.1,.1,.023],[659,.2,.12,.023],[784,.32,.24,.02]],
  roll: [[180,0,.05,.016],[240,.14,.05,.016],[210,.32,.05,.016],[290,.55,.06,.016],[230,.85,.06,.015],[320,1.2,.06,.015],[260,1.65,.07,.014],[520,2.3,.14,.022]],
  step: [[340, 0, 0.055, 0.022]],
  coin: [[660, 0, 0.1, 0.035], [880, 0.1, 0.16, 0.03]],
  bank: [[440, 0, 0.12, 0.028], [554.37, 0.12, 0.12, 0.028], [659.25, 0.24, 0.22, 0.03]],
  win: [[523.25, 0, 0.17, 0.03], [659.25, 0.17, 0.17, 0.03], [783.99, 0.34, 0.17, 0.03], [1046.5, 0.51, 0.4, 0.03]],
  click: [[520, 0, 0.045, 0.02]],
};

/**
 * Soft synthesized audio. No downloads, microphones, media files, or network requests.
 * Call toggle() directly in a user's click/tap handler to unlock browser audio.
 */
export class GameAudio {
  enabled = false;
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private voices = new Map<OscillatorNode, GainNode>();

  toggle(): boolean {
    if (this.enabled) {
      this.enabled = false;
      this.stopVoices();
      return false;
    }

    if (typeof window === 'undefined') return false;
    const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContextClass();
        this.output = this.context.createGain();
        this.output.gain.value = 0.5;
        this.output.connect(this.context.destination);
      }
      this.enabled = true;
      const context = this.context;
      if (context.state === 'suspended') {
        void context.resume().catch(() => {
          if (this.context === context) {
            this.enabled = false;
            this.stopVoices();
          }
        });
      }
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  play(kind: GameSound): void {
    // play() never initializes or resumes audio outside an explicit user gesture.
    if (!this.enabled || !this.context || !this.output || this.context.state !== 'running') return;
    const context = this.context;
    const now = context.currentTime;
    try {
      for (const [frequency, offset, duration, volume] of SOUNDS[kind]) {
        // Prevent runaway sound queues during autoplay or fast UI interaction.
        if (this.voices.size >= 24) break;
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const start = now + offset;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(volume, start + Math.min(0.008, duration / 4));
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(envelope);
        envelope.connect(this.output);
        this.voices.set(oscillator, envelope);
        oscillator.onended = () => {
          this.voices.delete(oscillator);
          oscillator.disconnect();
          envelope.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
      }
    } catch {
      // Unsupported or suspended contexts must never interrupt gameplay.
      this.stopVoices();
    }
  }

  /** Release Web Audio resources on pagehide, HMR replacement, or app unmount. */
  async dispose(): Promise<void> {
    this.enabled = false;
    this.stopVoices();
    const context = this.context;
    this.context = null;
    this.output?.disconnect();
    this.output = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch { /* Already released or browser shutting down. */ }
    }
  }

  private stopVoices(): void {
    for (const [voice, envelope] of this.voices) {
      voice.onended = null;
      try { voice.stop(); } catch { /* A voice can already have ended. */ }
      voice.disconnect();
      envelope.disconnect();
    }
    this.voices.clear();
  }
}
