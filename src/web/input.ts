/**
 * High-precision pointer input collection.
 *
 * pointermove is delivered once per display frame, and getCoalescedEvents() recovers every raw
 * sample batched into it, each with its own timestamp: with a 1000 Hz mouse we still get every
 * sample at ~1 ms intervals, so collision checks are exactly as precise.
 *
 * pointerrawupdate is deliberately NOT used: it dispatches one main-thread task per hardware
 * sample (1000–8000 per second on gaming mice), which starved rendering and made the game stutter
 * at high polling rates. The run is only drawn once per frame anyway, so it bought no visible
 * latency.
 */
export type InputSource = 'pointermove';

export class HighResPointer {
  readonly source: InputSource;
  readonly coalesced: boolean;
  private readonly handler = (e: Event) => this.onEvent(e as PointerEvent);
  private attached = false;

  constructor(private readonly onSamples: (samples: readonly PointerEvent[]) => void) {
    this.source = 'pointermove';
    this.coalesced = typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype;
  }

  attach(): void {
    if (this.attached) return;
    window.addEventListener(this.source, this.handler, { passive: true });
    this.attached = true;
  }

  detach(): void {
    window.removeEventListener(this.source, this.handler);
    this.attached = false;
  }

  private onEvent(e: PointerEvent): void {
    const list = this.coalesced ? e.getCoalescedEvents() : [];
    this.onSamples(list.length > 0 ? list : [e]);
  }
}

export interface InputSummary {
  total: number;
  hz: number | null;
  medianMs: number | null;
  minMs: number | null;
  avgPerEvent: number;
  maxPerEvent: number;
}

/** Measure the actual sample interval to estimate the polling rate */
export class InputStats {
  private readonly times = new Float64Array(512);
  private head = 0;
  private count = 0;
  private readonly perEvent: number[] = [];
  total = 0;

  record(list: readonly PointerEvent[]): void {
    for (const ev of list) {
      this.times[this.head] = ev.timeStamp;
      this.head = (this.head + 1) % this.times.length;
      this.count = Math.min(this.count + 1, this.times.length);
      this.total++;
    }
    this.perEvent.push(list.length);
    if (this.perEvent.length > 120) this.perEvent.shift();
  }

  summary(): InputSummary {
    const n = this.count;
    const L = this.times.length;
    const intervals: number[] = [];
    for (let i = 1; i < n; i++) {
      const a = this.times[(this.head - n + i - 1 + L) % L];
      const b = this.times[(this.head - n + i + L) % L];
      const iv = b - a;
      // Skip idle stretches (long gaps)
      if (iv > 0 && iv < 50) intervals.push(iv);
    }
    intervals.sort((x, y) => x - y);
    const median = intervals.length >= 20 ? intervals[intervals.length >> 1] : null;
    const pe = this.perEvent;
    return {
      total: this.total,
      hz: median ? 1000 / median : null,
      medianMs: median,
      minMs: intervals.length >= 20 ? intervals[0] : null,
      avgPerEvent: pe.length ? pe.reduce((s, v) => s + v, 0) / pe.length : 0,
      maxPerEvent: pe.length ? Math.max(...pe) : 0,
    };
  }
}
