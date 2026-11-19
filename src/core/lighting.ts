import { toWorld, transformAt, type CompiledObject } from './object';
import { shapeCenter } from './shape';

export interface LightSource { x: number; y: number; r: number; intensity?: number }

/** Shared by the editor and play renderer. Attach MapObject.light to future light objects. */
export function objectLights(
  objects: readonly CompiledObject[], time: number,
  state: { hidden?: ArrayLike<number | boolean>; clock?: ArrayLike<number> } = {},
): LightSource[] {
  const lights: LightSource[] = [];
  objects.forEach((o, i) => {
    const source = o.src?.light;
    if (!source || source.radius <= 0 || source.intensity === 0 || state.hidden?.[i]) return;
    const center = shapeCenter(o.src!.shape);
    const position = toWorld(o, transformAt(o, state.clock?.[i] ?? time, { dx: 0, dy: 0, cos: 1, sin: 0 }), center.x, center.y, { x: 0, y: 0 });
    lights.push({ ...position, r: source.radius, intensity: source.intensity });
  });
  return lights;
}
