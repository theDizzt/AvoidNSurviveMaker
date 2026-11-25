import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

export interface Laser {
  /** Beam color (SWITCH_COLORS index) */
  color: number;
  /** Beam direction in degrees (0 = right, 90 = down); turns with the emitter's rotation */
  angle: number;
  /** Beam on at the start */
  on: boolean;
  /** While this switch color is ON, the beam is flipped (on ↔ off) */
  switchColor?: number;
}

export function createLaserSchema(context: ValidationContext) {
  const { obj, num, colorIndex } = context;

  function validateLaser(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'laser') {
      const l = obj(o.laser, `${name}.laser`);
      out.laser = { color: colorIndex(l.color, `${name}.laser.color`), angle: num(l.angle, `${name}.laser.angle`, -720, 720), on: l.on !== false };
      if (l.switchColor !== undefined) out.laser.switchColor = colorIndex(l.switchColor, `${name}.laser.switchColor`);
    }
  }

  return { validateLaser };
}
