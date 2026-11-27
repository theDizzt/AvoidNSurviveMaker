import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { shapeCenter } from '../../shape';

/**
 * Fixed turret (#121, `fixed`): the barrel never moves; it fires along it every `fireMs` while the
 * cursor is within `range` and inside `arc` (a sector centered on each barrel; 360 = all round).
 * Rotating turret (#122, `spin`): the barrel keeps turning at `turnSpeed` and fires along it every
 * `fireMs` while the cursor is within `range`; with `arc` < 360 it swings back and forth across the
 * arc centered on `angle`. Both can have 2 or 4 barrels (#123–126) and can fire nonstop (`always`).
 * Turret (#60, `gun`): turns its barrel toward the cursor while it is within `range` and fires a
 * bullet every `fireMs` once the barrel points at it. Missile launcher (#61, `missile`): fires a
 * homing missile every `fireMs` while the cursor is within `range`; the missile leaves along
 * `angle`, then steers toward the cursor in a smooth curve and explodes on a wall or the cursor.
 * Angles are degrees in map space (0 = right, 90 = down) and turn with the object's rotation.
 */
export interface Turret {
  kind: 'gun' | 'missile' | 'fixed' | 'spin';
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
  /** fixed / spin: 2 = two barrels back to back (#123 / #124), 4 = four at right angles (#125 / #126); omitted: one */
  barrels?: 2 | 4;
  /** fixed / spin: keep firing every interval even with no cursor detected */
  always?: boolean;
  /** spin: the barrel turns counter-clockwise first (default clockwise) */
  ccw?: boolean;
}

export function createTurretSchema(context: ValidationContext) {
  const { obj, num, oneOf } = context;

  /** A new turret (#60) / missile launcher (#61) */
  const DEFAULT_GUN: Readonly<Turret> = { kind: 'gun', range: 300, fireMs: 800, speed: 320, angle: 0, arc: 360, turnSpeed: 180, lifeMs: 5000, pierce: false };
  const DEFAULT_MISSILE: Readonly<Turret> = { kind: 'missile', range: 400, fireMs: 2500, speed: 200, angle: -90, arc: 360, turnSpeed: 120, lifeMs: 5000, pierce: false };
  /** A new fixed (#121) / rotating (#122) turret */
  const DEFAULT_FIXED: Readonly<Turret> = { kind: 'fixed', range: 300, fireMs: 800, speed: 320, angle: 0, arc: 60, turnSpeed: 0, lifeMs: 5000, pierce: false };
  const DEFAULT_SPIN: Readonly<Turret> = { kind: 'spin', range: 300, fireMs: 300, speed: 280, angle: 0, arc: 360, turnSpeed: 90, lifeMs: 5000, pierce: false };
  const DEFAULTS = { gun: DEFAULT_GUN, missile: DEFAULT_MISSILE, fixed: DEFAULT_FIXED, spin: DEFAULT_SPIN } as const;
  function validateTurret(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'turret') {
      // Always a 60×60 square, centered where the shape was
      const c = shapeCenter(out.shape);
      const h = LIMITS.turretSize / 2;
      out.shape = { type: 'rect', x: c.x - h, y: c.y - h, w: LIMITS.turretSize, h: LIMITS.turretSize };
      const tu = obj(o.turret, `${name}.turret`);
      const kind = oneOf(tu.kind, `${name}.turret.kind`, ['gun', 'missile', 'fixed', 'spin'] as const);
      const d = DEFAULTS[kind] ?? DEFAULT_GUN;
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
      // Only set when used, so older turrets keep the same data (and level hashes)
      if (kind === 'fixed' || kind === 'spin') {
        if (tu.barrels === 2 || tu.barrels === 4) out.turret.barrels = tu.barrels;
        if (tu.always === true) out.turret.always = true;
        if (kind === 'spin' && tu.ccw === true) out.turret.ccw = true;
      }
    }
  }

  return { validateTurret, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_FIXED, DEFAULT_SPIN };
}
