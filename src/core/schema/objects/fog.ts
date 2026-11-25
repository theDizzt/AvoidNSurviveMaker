import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

/** fog: grey-white fog (#49) · sand: blowing sand dust (#50) */
export type FogKind = 'fog' | 'sand';

/** Fog / sand dust area: no effect on play, only hides what lies under it */
export interface Fog {
  kind: FogKind;
  /** How much it hides, 0–100 (100 = nothing under it shows) */
  density: number;
}

export function createFogSchema(context: ValidationContext) {
  const { obj, num, oneOf } = context;

  function validateFog(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'fog') {
      const f = obj(o.fog, `${name}.fog`);
      out.fog = { kind: oneOf(f.kind, `${name}.fog.kind`, ['fog', 'sand'] as const), density: num(f.density, `${name}.fog.density`, 0, 100) };
    }
  }

  return { validateFog };
}
