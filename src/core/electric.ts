import { pointInPoly } from './geometry';
import { conveyorOutline } from './conveyor';
import type { CompiledObject } from './object';
import type { ElecAction, MapData, MapObject, Point, PolyPoint, Wire } from './types';

/**
 * Electricity (#91, #94–97): wires carry power from electric devices to the objects their ends lie
 * on. The network is fixed by where things are placed (at rest): each end of a wire connects to the
 * devices, other wires and objects it lies on. A connected group of wires and device ports is
 * powered while any source in it is on.
 */

/** Width of a wire (map units) */
export const WIRE_WIDTH = 8;
/** An electric pulley (#95) keeps powering this long (ms) after it was last turned */
export const GENERATOR_MS = 300;
/** A wire end this close (map units) to another wire's centerline joins it */
const JOIN_REACH = WIRE_WIDTH / 2 + 2;

/** The wire's outline (a thin belt along its points) */
export function wireOutline(w: Wire): PolyPoint[] {
  return conveyorOutline({ points: w.points, loop: false, width: WIRE_WIDTH, speed: 0 });
}

/** What a powered wire does to an object it ends on: a link action, or a door / laser's own reaction */
export type ElecEffect = ElecAction | 'door' | 'laser';

/** Objects a wire end can connect to (besides devices and other wires) */
function connectable(o: MapObject): boolean {
  switch (o.role) {
    case 'wall': case 'door': case 'laser': case 'spot': case 'torch': case 'turret': case 'mirror':
    case 'dark': case 'fog': case 'liquid': case 'lily': case 'secret': case 'rad': case 'magnet':
      return true;
    // A floor only when it is meant to react: it moves, blinks or has a setting
    case 'path':
      return !!(o.motion || o.rotation || o.blink || o.elec);
    default:
      return false;
  }
}

/** How an object reacts to power: its own setting, or the natural default for its kind */
export function elecEffect(o: MapObject): ElecEffect {
  if (o.role === 'door') return 'door';
  if (o.role === 'laser' && !o.elec) return 'laser';
  if (o.elec) return o.elec.action;
  if (o.role === 'spot' || o.role === 'torch') return 'show';
  // A wired magnet (#99) pulls while powered
  if (o.role === 'magnet') return 'start';
  return o.motion || o.rotation ? 'start' : 'remove';
}

/** Lights (spotlights, torches) only go dark when 'show' leaves them unpowered; they never vanish */
export function isLightRole(o: MapObject): boolean {
  return o.role === 'spot' || o.role === 'torch';
}

function distToPolyline(p: Point, pts: readonly Point[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y));
  }
  return best;
}

/** Is p inside the object at rest (its tilted outline)? */
function inside(o: CompiledObject, p: Point): boolean {
  return p.x >= o.minX && p.x <= o.maxX && p.y >= o.minY && p.y <= o.maxY && pointInPoly(p.x, p.y, o.poly);
}

export class Circuit {
  /** Wire object indices */
  readonly wires: readonly number[];
  /** Device object indices */
  readonly devices: readonly number[];
  /** Objects some wire ends on, with the groups they are connected to */
  readonly targets: readonly { i: number; comps: readonly number[] }[];
  /** Per object: 1 for a connected target */
  readonly isTarget: Uint8Array;
  /** Per wire end connection, for drawing in the editor: [wire, x, y] of each connected end */
  readonly joints: readonly { wire: number; x: number; y: number }[];
  private readonly compOf: Int32Array;
  private readonly nodeOf: Map<number, number>;
  private readonly compCount: number;
  private readonly inverters: { i: number; inComp: number; outComp: number }[] = [];
  private readonly sources: { i: number; comp: number }[] = [];
  private readonly compPower: Uint8Array;
  /** Per inverter: its output last time (kept, so a loop settles the same way every run) */
  private readonly invOut: Uint8Array;

  constructor(private readonly map: MapData, objects: readonly CompiledObject[]) {
    const wires: number[] = [];
    const devices: number[] = [];
    map.objects.forEach((o, i) => {
      if (o.role === 'wire' && o.wire && o.wire.points.length >= 2) wires.push(i);
      else if (o.role === 'power' && o.power) devices.push(i);
    });
    this.wires = wires;
    this.devices = devices;
    // Nodes: one per wire, one per device (an inverter has an input and an output node)
    const nodeOf = new Map<number, number>();
    let n = 0;
    for (const i of wires) nodeOf.set(i, n++);
    for (const i of devices) {
      nodeOf.set(i, n);
      n += map.objects[i].power!.kind === 'inverter' ? 2 : 1;
    }
    this.nodeOf = nodeOf;
    const parent = Int32Array.from({ length: n }, (_, k) => k);
    const find = (a: number): number => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    const targetNodes = new Map<number, Set<number>>();
    const joints: { wire: number; x: number; y: number }[] = [];
    for (const w of wires) {
      const pts = map.objects[w].wire!.points;
      for (const end of [pts[0], pts[pts.length - 1]]) {
        let joined = false;
        for (const d of devices) {
          const o = objects[d];
          if (!inside(o, end)) continue;
          let node = nodeOf.get(d)!;
          if (map.objects[d].power!.kind === 'inverter') {
            // Left half (in its own frame) is the input, right half the output
            const ax = Math.cos(o.tilt);
            const ay = Math.sin(o.tilt);
            if ((end.x - o.cx) * ax + (end.y - o.cy) * ay >= 0) node++;
          }
          union(nodeOf.get(w)!, node);
          joined = true;
        }
        for (const v of wires) {
          if (v === w || distToPolyline(end, map.objects[v].wire!.points) > JOIN_REACH) continue;
          union(nodeOf.get(w)!, nodeOf.get(v)!);
          joined = true;
        }
        map.objects.forEach((m, i) => {
          if (!connectable(m) || !inside(objects[i], end)) return;
          let set = targetNodes.get(i);
          if (!set) targetNodes.set(i, (set = new Set()));
          set.add(nodeOf.get(w)!);
          joined = true;
        });
        if (joined) joints.push({ wire: w, x: end.x, y: end.y });
      }
    }
    // Number the groups 0..count-1
    const compOf = new Int32Array(n);
    const ids = new Map<number, number>();
    for (let k = 0; k < n; k++) {
      const r = find(k);
      if (!ids.has(r)) ids.set(r, ids.size);
      compOf[k] = ids.get(r)!;
    }
    this.compOf = compOf;
    this.compCount = ids.size;
    this.compPower = new Uint8Array(this.compCount);
    for (const d of devices) {
      const node = nodeOf.get(d)!;
      if (map.objects[d].power!.kind === 'inverter') this.inverters.push({ i: d, inComp: compOf[node], outComp: compOf[node + 1] });
      else this.sources.push({ i: d, comp: compOf[node] });
    }
    this.invOut = new Uint8Array(this.inverters.length);
    this.isTarget = new Uint8Array(map.objects.length);
    this.targets = [...targetNodes].sort((a, b) => a[0] - b[0]).map(([i, nodes]) => {
      this.isTarget[i] = 1;
      return { i, comps: [...new Set([...nodes].map((k) => compOf[k]))] };
    });
    this.joints = joints;
  }

  get any(): boolean {
    return this.wires.length > 0 || this.devices.length > 0;
  }

  /** Forget the inverters' last outputs (a new run) */
  reset(): void {
    this.invOut.fill(0);
  }

  /**
   * Work out the power everywhere from the sources that are on (`active`), into `out` per object:
   * wires carrying power, devices whose output is on, targets receiving power.
   */
  evaluate(active: (i: number) => boolean, out: Uint8Array): void {
    const { compPower, invOut, inverters } = this;
    // Inverters feed back into the network: settle it, starting from their outputs last time
    for (let pass = 0; pass <= inverters.length + 1; pass++) {
      compPower.fill(0);
      for (const s of this.sources) if (active(s.i)) compPower[s.comp] = 1;
      inverters.forEach((v, k) => {
        if (invOut[k]) compPower[v.outComp] = 1;
      });
      let changed = false;
      inverters.forEach((v, k) => {
        const next = compPower[v.inComp] ? 0 : 1;
        if (next !== invOut[k]) {
          invOut[k] = next;
          changed = true;
        }
      });
      if (!changed) break;
    }
    // The last pass may have flipped an inverter in a loop: show the network as it now is
    compPower.fill(0);
    for (const s of this.sources) if (active(s.i)) compPower[s.comp] = 1;
    inverters.forEach((v, k) => {
      if (invOut[k]) compPower[v.outComp] = 1;
    });
    for (const w of this.wires) out[w] = compPower[this.compOf[this.nodeOf.get(w)!]];
    for (const s of this.sources) out[s.i] = active(s.i) ? 1 : 0;
    inverters.forEach((v, k) => (out[v.i] = invOut[k]));
    for (const t of this.targets) {
      let on = 0;
      for (const c of t.comps) if (compPower[c]) on = 1;
      out[t.i] = on;
    }
  }

  /** Power at the start of a run, before anything is touched: switches set to start ON, inverters */
  initial(out: Uint8Array): Uint8Array {
    this.reset();
    this.evaluate((i) => !!this.map.objects[i].power?.initial && this.map.objects[i].power!.kind === 'switch', out);
    return out;
  }
}

const initialCache = new WeakMap<readonly CompiledObject[], { map: MapData; power: Uint8Array; circuit: Circuit }>();

/** The circuit and its power before a run starts (editor and title screens), cached per compiled map */
export function initialPower(map: MapData, objects: readonly CompiledObject[]): { power: Uint8Array; circuit: Circuit } {
  const hit = initialCache.get(objects);
  if (hit && hit.map === map) return hit;
  const circuit = new Circuit(map, objects);
  const power = circuit.initial(new Uint8Array(map.objects.length));
  const entry = { map, power, circuit };
  initialCache.set(objects, entry);
  return entry;
}
