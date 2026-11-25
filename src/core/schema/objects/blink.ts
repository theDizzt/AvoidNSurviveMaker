import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/**
 * Blinking path / wall (#75–82): there for `onMs`, gone for `offMs`, over and over. Before `delay`
 * ms it is there (a negative delay starts partway through the cycle).
 */
export interface Blink {
  onMs: number;
  offMs: number;
  delay: number;
}

export function createBlinkSchema(context: ValidationContext) {
  const { obj, num } = context;

  /** A new blinking path / wall (#75–82) */
  const DEFAULT_BLINK: Readonly<Blink> = { onMs: 1500, offMs: 1000, delay: 0 };
  function validateBlink(o: Record<string, unknown>, out: MapObject, name: string): void {
    if ((out.role === 'path' || out.role === 'wall') && o.blink !== undefined) {
      const b = obj(o.blink, `${name}.blink`);
      out.blink = {
        onMs: num(b.onMs, `${name}.blink.onMs`, 50, LIMITS.maxDelay),
        offMs: num(b.offMs, `${name}.blink.offMs`, 0, LIMITS.maxDelay),
        delay: num(b.delay, `${name}.blink.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      };
      // Ice never blinks (#71–74, #100–110)
      if (out.ice) delete out.blink;
    }
  }

  return { validateBlink, DEFAULT_BLINK };
}
