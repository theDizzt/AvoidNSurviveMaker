import { toWorld, transformAt, type CompiledObject } from './object';
import { shapeCenter } from './shape';

export interface LightSource { x: number; y: number; r: number; intensity?: number }

/** Shared by the editor and play renderer. Attach MapObject.light to future light objects. */
export function objectLights(
  objects: readonly CompiledObject[], time: number,
<<<<<<< HEAD
  state: { hidden?: ArrayLike<number | boolean>; clock?: ArrayLike<number> } = {},
=======
  state: {
    hidden?: ArrayLike<number | boolean>; clock?: ArrayLike<number>;
    /** Per object: 1 while the cursor carries it (#58 torch); it then lights from `cursor` */
    carried?: ArrayLike<number>; cursor?: { x: number; y: number };
  } = {},
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
): LightSource[] {
  const lights: LightSource[] = [];
  objects.forEach((o, i) => {
    const source = o.src?.light;
    if (!source || source.radius <= 0 || source.intensity === 0 || state.hidden?.[i]) return;
<<<<<<< HEAD
=======
    if (state.carried?.[i] && state.cursor) {
      lights.push({ x: state.cursor.x, y: state.cursor.y, r: source.radius, intensity: source.intensity });
      return;
    }
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
    const center = shapeCenter(o.src!.shape);
    const position = toWorld(o, transformAt(o, state.clock?.[i] ?? time, { dx: 0, dy: 0, cos: 1, sin: 0 }), center.x, center.y, { x: 0, y: 0 });
    lights.push({ ...position, r: source.radius, intensity: source.intensity });
  });
  return lights;
}
