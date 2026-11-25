import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

export function createTorchSchema(context: ValidationContext) {
  const { obj } = context;

  /** Light radius of a new torch (#57 / #58) */
  const DEFAULT_TORCH_LIGHT = 120;
  function validateTorch(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'torch') {
      if (o.torch !== undefined && obj(o.torch, `${name}.torch`).carry === true) out.torch = { carry: true };
      // A torch always gives light
      out.light ??= { radius: DEFAULT_TORCH_LIGHT };
    }
  }

  return { validateTorch, DEFAULT_TORCH_LIGHT };
}
