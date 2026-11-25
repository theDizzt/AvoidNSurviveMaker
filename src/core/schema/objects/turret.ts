import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { shapeCenter } from '../../shape';

/**
 * Turret (#60, `gun`): turns its barrel toward the cursor while it is within `range` and fires a
 * bullet every `fireMs` once the barrel points at it. Missile launcher (#61, `missile`): fires a
 * homing missile every `fireMs` while the cursor is within `range`; the missile leaves along
 * `angle`, then steers toward the cursor in a smooth curve and explodes on a wall or the cursor.
 * Angles are degrees in map space (0 = right, 90 = down) and turn with the object's rotation.
 */
export interface Turret {
  kind: 'gun' | 'missile';
  /** Detection radius from the center (px) */
  range: number;
  /** Time between shots (ms) */
  fireMs: number;
  /** Bullet / missile speed (px/s) */
  speed: number;
  /** gun: the barrel's rest direction, the middle of its arc · missile: launch direction */
  angle: number;
  /** gun: how far the barrel can swing in all, centered on `angle` (360 = all the way round) */
  arc: number;
  /** gun: barrel turn speed (deg/s) · missile: how hard the missile steers (deg/s) */
  turnSpeed: number;
  /** missile: flight time before it blows up by itself (ms) */
  lifeMs: number;
  /** Anti-materiel rounds: bullets / missiles fly through walls */
  pierce: boolean;
}

export function createTurretSchema(context: ValidationContext) {
  const { obj, num, oneOf } = context;

  /** A new turret (#60) / missile launcher (#61) */
  const DEFAULT_GUN: Readonly<Turret> = { kind: 'gun', range: 300, fireMs: 800, speed: 320, angle: 0, arc: 360, turnSpeed: 180, lifeMs: 5000, pierce: false };
  const DEFAULT_MISSILE: Readonly<Turret> = { kind: 'missile', range: 400, fireMs: 2500, speed: 200, angle: -90, arc: 360, turnSpeed: 120, lifeMs: 5000, pierce: false };
  function validateTurret(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'turret') {
      // Always a 60×60 square, centered where the shape was
      const c = shapeCenter(out.shape);
      const h = LIMITS.turretSize / 2;
      out.shape = { type: 'rect', x: c.x - h, y: c.y - h, w: LIMITS.turretSize, h: LIMITS.turretSize };
      const tu = obj(o.turret, `${name}.turret`);
      const kind = oneOf(tu.kind, `${name}.turret.kind`, ['gun', 'missile'] as const);
      const d = kind === 'gun' ? DEFAULT_GUN : DEFAULT_MISSILE;
      const opt = (k: keyof Turret, min: number, max: number) => (tu[k] === undefined ? d[k] as number : num(tu[k], `${name}.turret.${k}`, min, max));
      out.turret = {
        kind,
        range: opt('range', 1, LIMITS.maxTurretRange),
        fireMs: opt('fireMs', LIMITS.minFireMs, LIMITS.maxDelay),
        speed: opt('speed', 1, LIMITS.maxSpeed),
        angle: opt('angle', -720, 720),
        arc: opt('arc', 0, 360),
        turnSpeed: opt('turnSpeed', 0, LIMITS.maxRotSpeed),
        lifeMs: opt('lifeMs', 100, LIMITS.maxDelay),
        pierce: tu.pierce === true,
      };
    }
  }

  return { validateTurret, DEFAULT_GUN, DEFAULT_MISSILE };
}
