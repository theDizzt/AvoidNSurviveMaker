/**
 * 고정밀 포인터 입력 수집.
 *
 * - pointerrawupdate (Chromium, HTTPS/localhost): 화면 프레임에 묶이지 않고 입력 즉시 발생
 * - 그 외: pointermove
 * - 두 경우 모두 getCoalescedEvents()로 묶여 있던 원본 샘플을 전부 꺼낸다.
 *   → 1000Hz 마우스라면 약 1ms 간격의 샘플을 모두 받음
 */
export type InputSource = 'pointerrawupdate' | 'pointermove';

export class HighResPointer {
  readonly source: InputSource;
  readonly coalesced: boolean;
  private readonly handler = (e: Event) => this.onEvent(e as PointerEvent);
  private attached = false;

  constructor(private readonly onSamples: (samples: readonly PointerEvent[]) => void) {
    this.source = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
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

/** 실제로 들어오는 샘플 간격을 측정해서 폴링 레이트를 추정 */
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
      // 마우스를 멈춘 구간(긴 간격)은 제외
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
