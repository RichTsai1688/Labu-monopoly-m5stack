/** Looped local background music. Playback only starts after an explicit user toggle. */
export class GameMusic {
  enabled = false;
  private element: HTMLAudioElement | null = null;
  private disposed = false;
  private generation = 0;
  private readonly onVisibility = () => {
    if (document.hidden) {
      this.generation++;
      this.element?.pause();
    } else if (this.enabled) {
      void this.playIfVisible();
    }
  };

  constructor(private readonly src: string, private readonly volume = 0.16) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  async toggle(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.enabled) {
      this.enabled = false;
      this.generation++;
      this.element?.pause();
      return false;
    }
    if (typeof Audio === 'undefined' || !this.src) return false;
    try {
      if (!this.element) {
        this.element = new Audio();
        this.element.preload = 'none';
        this.element.loop = true;
        this.element.volume = Number.isFinite(this.volume) ? Math.min(1, Math.max(0, this.volume)) : 0.16;
        this.element.src = this.src;
      }
      this.enabled = true;
      await this.playIfVisible();
      return this.enabled;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  /** Idempotent teardown for pagehide or app unmount. A disposed instance stays silent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.generation++;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.element) {
      this.element.pause();
      this.element.removeAttribute('src');
      // Cancel loading and release the decoded media buffer.
      this.element.load();
      this.element = null;
    }
  }

  private async playIfVisible(): Promise<void> {
    if (!this.enabled || this.disposed || !this.element || typeof document !== 'undefined' && document.hidden) return;
    const element = this.element;
    const generation = ++this.generation;
    try {
      await element.play();
      if (!this.enabled || this.disposed || typeof document !== 'undefined' && document.hidden) element.pause();
    } catch {
      // A stale play promise may reject because the user hid the page or muted music.
      if (generation === this.generation) {
        this.enabled = false;
        element.pause();
      }
    }
  }
}
