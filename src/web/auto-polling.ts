/** Conservative workload feedback; never changes the simulation's 1 ms clock. */
export class AutoPolling {
  private readonly rates = [125, 250, 500, 1000] as const;
  private index = 2;
  private since: number | null = null;
  private work = 0;
  private quietWindows = 0;

  get rate(): number { return this.rates[this.index]; }

  resetMeasurement(): void {
    this.since = null;
    this.work = 0;
    this.quietWindows = 0;
  }

  addInputWork(ms: number): void { this.work += Math.max(0, ms); }

  /** Evaluate two seconds of main-thread work, not the monitor's refresh rate. */
  frame(now: number, ms: number): boolean {
    if (this.since === null) this.since = now;
    this.work += Math.max(0, ms);
    const elapsed = now - this.since;
    if (elapsed < 2000) return false;
    const load = this.work / elapsed;
    const before = this.index;
    if (load > 0.35) {
      this.index = Math.max(0, this.index - 1);
      this.quietWindows = 0;
    } else if (load < 0.12) {
      // Raise only after ten seconds of headroom; avoid oscillating under borderline load.
      if (++this.quietWindows >= 5) {
        this.index = Math.min(this.rates.length - 1, this.index + 1);
        this.quietWindows = 0;
      }
    } else this.quietWindows = 0;
    this.since = now;
    this.work = 0;
    return this.index !== before;
  }
}
