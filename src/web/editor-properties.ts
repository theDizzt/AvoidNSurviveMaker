import type { CommandId } from './editor-shared';
import { t as tr } from './i18n';

import { objectsBounds, tiltObject } from '../core/arrange';

import { shapeCenter } from '../core/shape';
import { conveyorOutline } from '../core/conveyor';
import { Circuit, elecEffect, isLightRole } from '../core/electric';
import { compileMap } from '../core/object';
import { CompiledMotion } from '../core/motion';
import { GEAR_TEETH } from '../core/machines';
import { DEFAULT_MAGNET } from '../core/magnet';
import { LIQUID_KINDS } from '../core/schema/objects/liquid';

import type { ElecAction, Easing, FogKind, Liquid, LinkAction, MapData, MapObject, Motion, MotionType, Rect, Repeat, Role, Rotation } from '../core/types';
import { SWITCH_COLORS, switchColor } from './localized/colors';
import { setIcon, type IconName } from './icons';

import { DEFAULT_BLINK, DEFAULT_BOULDER_WAVE, DEFAULT_ICE_GRIP, DEFAULT_SECRET_RADIUS, DEFAULT_TORCH_LIGHT, defaultRotation, LIMITS } from './localized/validate';
import { TEXT_BASE_FONTS } from './render';

import { fontPicker } from './font-picker';

import type { EditorSelection } from '../core/editor-document';
import { POWER_NAMES, turretName, liquidName, radName, TRIGGER_NAMES, isButton, describeObject, objectToolId, ZONE_IDS, sizeText, REPEAT_OPTIONS, ROUTE_REPEAT_OPTIONS, EASING_OPTIONS, ROUTE_OPTIONS, DIRECTION_OPTIONS, newMotion, Command } from './editor-shared';

export interface EditorPropertiesHost {
  readonly map: MapData;
  readonly selection: EditorSelection;
  lastColor: number;
  alignToMap: boolean;
  edit(fn: () => void): void;
  selectedZone(): Rect | null;
  selectedObject(): MapObject | null;
  selIds(): number[];
  startMarkers(index: number): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  commands(): Record<CommandId, Command>;
}

/** DOM projection of an editor document, with explicit edit/navigation callbacks. */

/** Passes in one repeat cycle: ping-pong goes there and back */
const cycleSweeps = (repeat: Repeat) => (repeat === 'pingpong' ? 2 : 1);

export class EditorPropertiesPanel {
  constructor(private readonly root: HTMLElement, private readonly host: EditorPropertiesHost) {}
  field(label: string, control: HTMLElement, wide = false): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = wide ? 'field wide' : 'field';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(span, control);
    return wrap;
  }

  /** Conveyor belt (#69): speed, width, which way it runs, and whether it loops */
  private conveyorProps(o: MapObject): HTMLElement[] {
    const c = o.conveyor;
    if (!c) return [];
    // The belt's shape follows its centerline
    const set = (apply: () => void) => () => {
      apply();
      o.shape = { type: 'poly', points: conveyorOutline(c) };
    };
    return [
      this.heading(tr('ed.nameConveyor')),
      this.group(
        this.numField(tr('ed.speedPxS'), c.speed, (v) => set(() => (c.speed = Math.round(Math.min(LIMITS.maxSpeed, Math.max(1, v)))))(), 10),
        this.numField(tr('ed.beltWidth'), c.width, (v) => set(() => (c.width = Math.round(Math.min(LIMITS.maxBeltWidth, Math.max(LIMITS.minBeltWidth, v)))))(), 5),
      ),
      this.toggle(tr('ed.beltReverse'), !!c.reverse, (on) => set(() => {
        if (on) c.reverse = true;
        else delete c.reverse;
      })()),
      this.toggle(tr('ed.beltLoop'), c.loop, (on) => set(() => (c.loop = on))()),
      this.note(tr('ed.conveyorNote')),
    ];
  }

  /** Pond (#86) / radioactive water (#87) / lava (#118) / sulfur spring (#119) / oil (#120) */
  private liquidProps(o: MapObject): HTMLElement[] {
    const l = o.liquid ?? (o.liquid = { kind: 'pond' });
    return [
      this.heading(liquidName(l.kind)),
      this.group(this.selectField<Liquid['kind']>(tr('ed.liquidKind'), l.kind, LIQUID_KINDS.map((k): [Liquid['kind'], string] => [k, liquidName(k)]), (v) => (l.kind = v), true)),
      this.note(tr('ed.liquidNote')),
    ];
  }

  /** Magnet (#99): how far and how hard it pulls, and what */
  private magnetProps(o: MapObject): HTMLElement[] {
    const g = o.magnet ?? (o.magnet = { ...DEFAULT_MAGNET });
    return [
      this.heading(tr('ed.nameMagnet')),
      this.group(
        this.numField(tr('ed.magnetRange'), g.range, (v) => (g.range = Math.round(Math.min(LIMITS.maxMagnetRange, Math.max(1, v)))), 10),
        this.numField(tr('ed.magnetStrength'), g.strength, (v) => (g.strength = Math.round(Math.min(LIMITS.maxSpeed, Math.max(0, v)))), 10),
      ),
      this.toggle(tr('ed.magnetCursor'), g.cursor, (on) => (g.cursor = on)),
      this.toggle(tr('ed.magnetMetal'), g.metal, (on) => (g.metal = on)),
      this.note(tr('ed.magnetNote')),
    ];
  }

  /** Machines (#111–114): a gear's teeth, a pendulum's swing, a press's beats */
  private machineProps(o: MapObject): HTMLElement[] {
    const sec = (ms: number) => ms / 1000;
    const ms = (v: number, min = 0) => Math.round(Math.min(LIMITS.maxDelay, Math.max(min, v)) * 1000);
    const delay = (v: number) => Math.round(Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, v)) * 1000);
    if (o.gear) {
      const g = o.gear;
      return [
        this.heading(tr('ed.nameGear')),
        this.group(
          this.numField(tr('ed.gearTeeth'), g.teeth, (v) => (g.teeth = Math.round(Math.min(GEAR_TEETH.max, Math.max(GEAR_TEETH.min, v)))), 1),
          this.numField(tr('ed.gearDepth'), g.depth, (v) => (g.depth = Math.round(Math.min(80, Math.max(1, v)))), 2),
        ),
        this.note(tr('ed.gearNote')),
      ];
    }
    if (o.pendulum) {
      const p = o.pendulum;
      return [
        this.heading(tr('ed.namePendulum')),
        this.group(
          this.numField(tr('ed.pendAmplitude'), p.amplitude, (v) => (p.amplitude = Math.min(180, Math.max(0, v))), 5),
          this.numField(tr('ed.pendPeriodS'), sec(p.periodMs), (v) => (p.periodMs = ms(v, 0.05)), 0.1),
          this.numField(tr('ed.startDelayS'), sec(p.delay), (v) => (p.delay = delay(v)), 0.1),
        ),
        this.note(tr('ed.pendulumNote')),
      ];
    }
    if (o.press) {
      const p = o.press;
      return [
        this.heading(tr('ed.namePress')),
        this.group(
          this.numField(tr('ed.pressReach'), p.reach, (v) => (p.reach = Math.round(Math.max(1, Math.min(LIMITS.maxSize, v)))), 10),
          this.numField(tr('ed.pressDownS'), sec(p.downMs), (v) => (p.downMs = ms(v)), 0.05),
          this.numField(tr('ed.pressHoldS'), sec(p.holdMs), (v) => (p.holdMs = ms(v)), 0.1),
          this.numField(tr('ed.pressUpS'), sec(p.upMs), (v) => (p.upMs = ms(v)), 0.1),
          this.numField(tr('ed.pressWaitS'), sec(p.waitMs), (v) => (p.waitMs = ms(v)), 0.1),
          this.numField(tr('ed.startDelayS'), sec(p.delay), (v) => (p.delay = delay(v)), 0.1),
        ),
        this.note(tr('ed.pressNote')),
      ];
    }
    return [this.heading(tr('ed.nameHand')), this.note(tr('ed.handNote'))];
  }

  /** Radioactive zone (#115) / waste (#116 / #117): the waste's growing and shrinking aura */
  private radProps(o: MapObject): HTMLElement[] {
    const r = o.rad ?? (o.rad = { kind: 'zone' });
    const out: HTMLElement[] = [this.heading(radName(r.kind))];
    const a = r.aura;
    if (r.kind === 'zone' || !a) return [...out, this.note(tr('ed.radZoneNote'))];
    const px = (v: number) => Math.round(Math.min(LIMITS.maxAura, Math.max(0, v)));
    const sec = (ms: number) => ms / 1000;
    const ms = (v: number) => Math.round(Math.min(LIMITS.maxDelay, Math.max(0, v)) * 1000);
    out.push(
      this.group(
        this.numField(tr('ed.auraMin'), a.min, (v) => (a.min = px(v)), 5),
        this.numField(tr('ed.auraMax'), a.max, (v) => (a.max = px(v)), 5),
        this.numField(tr('ed.auraGrowS'), sec(a.growMs), (v) => (a.growMs = ms(v)), 0.1),
        this.numField(tr('ed.auraHoldS'), sec(a.holdMs), (v) => (a.holdMs = ms(v)), 0.1),
        this.numField(tr('ed.auraShrinkS'), sec(a.shrinkMs), (v) => (a.shrinkMs = ms(v)), 0.1),
        this.numField(tr('ed.auraRestS'), sec(a.restMs), (v) => (a.restMs = ms(v)), 0.1),
        this.numField(tr('ed.startDelayS'), sec(a.delay), (v) => (a.delay = Math.round(Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, v)) * 1000)), 0.1),
      ),
      this.note(tr('ed.radWasteNote')),
    );
    return out;
  }

  /** Spotlight (#88–90): direction, beam width, reach and brightness */
  private spotProps(o: MapObject): HTMLElement[] {
    const s = o.spot!;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    return [
      this.heading(tr('ed.nameSpot')),
      this.group(
        this.numField(tr('ed.spotAngle'), s.angle, (v) => (s.angle = ((Math.round(v) % 360) + 360) % 360), 15),
        this.numField(tr('ed.spotSweep'), s.sweep, (v) => (s.sweep = Math.round(clamp(v, 1, 360))), 5),
        this.numField(tr('ed.spotRange'), s.range, (v) => (s.range = Math.round(clamp(v, 1, LIMITS.maxLight))), 20),
        this.numField(tr('ed.spotIntensity'), s.intensity ?? 100, (v) => {
          const k = Math.round(clamp(v, 0, 100));
          if (k === 100) delete s.intensity;
          else s.intensity = k;
        }, 5),
      ),
      this.note(tr('ed.spotNote')),
    ];
  }

  /** Wire (#91): how many of its ends are connected */
  private wireProps(idx: number): HTMLElement[] {
    const circuit = new Circuit(this.host.map, compileMap(this.host.map));
    const n = circuit.joints.filter((j) => j.wire === idx).length;
    return [this.heading(tr('ed.nameWire')), this.note(tr('ed.wireJoints', { n })), this.note(tr('ed.wireNote'))];
  }

  /** Electric devices (#94–97) */
  private powerProps(o: MapObject): HTMLElement[] {
    const p = o.power!;
    const s = o.shape;
    const out: HTMLElement[] = [this.heading(POWER_NAMES[p.kind])];
    if (s.type === 'rect') {
      out.push(this.group(
        this.numField(tr('ed.centerX'), s.x + s.w / 2, (v) => (s.x = Math.round(v - s.w / 2))),
        this.numField(tr('ed.centerY'), s.y + s.h / 2, (v) => (s.y = Math.round(v - s.h / 2))),
        this.numField(tr('common.width'), s.w, (v) => (s.w = Math.max(8, Math.round(v)))),
        this.numField(tr('common.height'), s.h, (v) => (s.h = Math.max(8, Math.round(v)))),
      ));
    } else if (s.type === 'ellipse') {
      out.push(this.group(
        this.numField(tr('ed.centerX'), s.cx, (v) => (s.cx = Math.round(v))),
        this.numField(tr('ed.centerY'), s.cy, (v) => (s.cy = Math.round(v))),
        this.numField(tr('ed.radius'), s.rx, (v) => (s.rx = s.ry = Math.max(8, Math.round(v)))),
      ));
    }
    if (p.kind === 'inverter') {
      out.push(this.group(this.numField(tr('ed.tilt'), o.tilt ?? 0, (v) => {
        const next = tiltObject(o, v - (o.tilt ?? 0));
        Object.assign(o, next);
        if (next.tilt === undefined) delete o.tilt;
      }, 15)));
    }
    const fields: HTMLElement[] = [];
    if (p.kind === 'switch' || p.kind === 'timer') {
      const modes: ['touch' | 'click' | 'plate', string][] = [['touch', tr('ed.touchingIt')], ['click', tr('ed.clickingOnIt')]];
      if (p.kind === 'switch') modes.push(['plate', tr('ed.whileTouching')]);
      fields.push(this.selectField(tr('ed.pressedBy'), p.momentary ? 'plate' : p.click ? 'click' : 'touch', modes, (v) => {
        delete p.click;
        delete p.momentary;
        if (v === 'click') p.click = true;
        if (v === 'plate') {
          p.momentary = true;
          delete p.initial;
          delete p.once;
        }
      }));
    }
    if (p.kind === 'timer') {
      fields.push(this.numField(tr('ed.powerFor'), (p.duration ?? 3000) / 1000, (v) => (p.duration = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.1));
    }
    if (fields.length) out.push(this.group(...fields));
    if (p.kind === 'switch' && !p.momentary) {
      out.push(this.toggle(tr('ed.startsOn'), !!p.initial, (on) => {
        if (on) p.initial = true;
        else delete p.initial;
      }));
    }
    if ((p.kind === 'switch' || p.kind === 'timer') && !p.momentary) {
      out.push(this.toggle(tr('ed.canBeSwitchedBack'), !p.once, (on) => {
        if (on) delete p.once;
        else p.once = true;
      }));
    }
    out.push(this.note(tr(p.momentary ? 'ed.elecPlateNote' : p.kind === 'switch' ? 'ed.elecSwitchNote' : p.kind === 'timer' ? 'ed.elecTimerNote' : p.kind === 'pulley' ? 'ed.elecPulleyNote' : 'ed.inverterNote')));
    return out;
  }

  /** An object a wire (#91) ends on: what it does while powered */
  private elecProps(o: MapObject, idx: number): HTMLElement[] {
    if (!this.host.map.objects.some((m) => m.role === 'wire')) return [];
    const circuit = new Circuit(this.host.map, compileMap(this.host.map));
    if (!circuit.isTarget[idx]) return [];
    const out: HTMLElement[] = [this.heading(tr('ed.electricity'))];
    if (o.role === 'door') return [...out, this.note(tr('ed.elecDoorNote'))];
    const effect = elecEffect(o);
    if (o.role === 'laser' && effect === 'laser') return [...out, this.note(tr('ed.elecLaserNote'))];
    const options: [ElecAction, string][] = isLightRole(o)
      ? [['show', tr('ed.elecShine')], ['remove', tr('ed.elecDark')]]
      : [['start', tr('ed.movesStartsMoving')], ['stop', tr('ed.stopsMoving')], ['remove', tr('ed.isRemoved')], ['show', tr('ed.elecShow')]];
    const current = (effect === 'door' || effect === 'laser' ? 'remove' : effect) as ElecAction;
    out.push(
      this.group(this.selectField<ElecAction>(tr('ed.whilePowered'), current, options, (v) => (o.elec = { action: v }), true)),
      this.note(tr('ed.elecWiredNote')),
    );
    return out;
  }

  /** Crate (#70): its box, and how belts carry it */
  private luggageProps(o: MapObject): HTMLElement[] {
    const s = o.shape;
    const out: HTMLElement[] = [this.heading(tr('ed.nameLuggage'))];
    if (s.type === 'rect') {
      out.push(this.group(
        this.numField('X', s.x, (v) => (s.x = Math.round(v))),
        this.numField('Y', s.y, (v) => (s.y = Math.round(v))),
        this.numField(tr('common.width'), s.w, (v) => (s.w = Math.max(1, Math.round(v)))),
        this.numField(tr('common.height'), s.h, (v) => (s.h = Math.max(1, Math.round(v)))),
      ));
    }
    out.push(this.note(tr('ed.luggageNote')));
    return out;
  }

  /** Route speed as the seconds one cycle takes (one pass; there and back for ping-pong); none without a route */
  private motionCycleField(o: MapObject, m: Motion): HTMLElement[] {
    // Seconds per cycle at 1 px/s: the route length (× 2 for ping-pong)
    const perSpeed = (new CompiledMotion({ ...m, speed: 1 }, shapeCenter(o.shape)).pass / 1000) * cycleSweeps(m.repeat);
    if (!(perSpeed > 0) || !Number.isFinite(perSpeed)) return [];
    return [this.numField(tr('ed.cycleTimeS'), m.speed > 0 ? perSpeed / m.speed : 0, (v) => {
      if (v > 0) m.speed = Math.min(LIMITS.maxSpeed, Math.max(0.01, perSpeed / v));
    }, 0.1)];
  }

  numField(label: string, value: number, apply: (v: number) => void, step = 1): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(Math.round(value * 100) / 100);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) {
        input.value = String(value);
        return;
      }
      this.host.edit(() => apply(v));
    });
    return this.field(label, input);
  }

  selectField<T extends string>(label: string, value: T, options: [T, string][], apply: (v: T) => void, wide = false): HTMLElement {
    const sel = document.createElement('select');
    for (const [v, text] of options) sel.append(new Option(text, v, false, v === value));
    sel.addEventListener('change', () => this.host.edit(() => apply(sel.value as T)));
    return this.field(label, sel, wide);
  }

  toggle(label: string, checked: boolean, apply: (on: boolean) => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => this.host.edit(() => apply(input.checked)));
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(input, span);
    return wrap;
  }

  button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }

  group(...children: HTMLElement[]): HTMLElement {
    const g = document.createElement('div');
    g.className = 'fields';
    g.append(...children);
    return g;
  }

  note(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    return p;
  }

  actions(...children: HTMLElement[]): HTMLElement {
    const d = document.createElement('div');
    d.className = 'actions';
    d.append(...children);
    return d;
  }

  heading(text: string): HTMLElement {
    const h = document.createElement('h5');
    h.textContent = text;
    return h;
  }

  rectFields(r: Rect): HTMLElement {
    return this.group(
      this.numField('X', r.x, (v) => (r.x = Math.round(v))),
      this.numField('Y', r.y, (v) => (r.y = Math.round(v))),
      this.numField(tr('common.width'), r.w, (v) => (r.w = Math.max(1, Math.round(v)))),
      this.numField(tr('common.height'), r.h, (v) => (r.h = Math.max(1, Math.round(v)))),
    );
  }

  renderProps(): void {
    const box = this.root;
    const zone = this.host.selectedZone();
    if (zone) {
      const title = document.createElement('h4');
      const z = this.host.selection?.kind === 'start' ? 'start' : 'goal';
      title.textContent = `ID ${ZONE_IDS[z]} · ${tr(z === 'start' ? 'ed.startArea' : 'ed.goalArea')}`;
      box.replaceChildren(title, this.rectFields(zone));
      return;
    }
    const ids = this.host.selIds();
    if (ids.length > 1) {
      box.replaceChildren(...this.multiProps(ids));
      return;
    }
    const o = this.host.selectedObject();
    if (!o) {
      box.replaceChildren(this.note(tr('ed.pickAToolFromThe')));
      return;
    }
    const idx = ids[0];
    const title = document.createElement('h4');
    title.textContent = `#${o.id ?? idx + 1} · ID ${objectToolId(o)} · ${describeObject(o)}${o.group !== undefined ? ` · ${tr('ed.groupN', { n: o.group })}` : ''}`;
    const parts: HTMLElement[] = [title];

    // Wires (#91) and electric devices (#94–97) have only their own settings
    if (o.role === 'wire' || o.role === 'power') {
      parts.push(...(o.role === 'wire' ? this.wireProps(idx) : this.powerProps(o)), ...this.arrangeProps(false), this.editActions());
      box.replaceChildren(...parts);
      return;
    }

    // Conveyor belts (#69) and crates (#70) have only their own settings
    if (o.role === 'conveyor' || o.role === 'luggage') {
      parts.push(...(o.role === 'conveyor' ? this.conveyorProps(o) : this.luggageProps(o)), ...this.arrangeProps(false), this.editActions());
      box.replaceChildren(...parts);
      return;
    }

    if (o.vine) {
      parts.push(this.heading(tr('ed.nameVine')), this.note(tr('ed.vineNote')));
    } else if (o.role === 'liquid') {
      parts.push(...this.liquidProps(o));
    } else if (o.role === 'rad') {
      parts.push(...this.radProps(o));
    } else if (o.gear || o.hand || o.pendulum || o.press) {
      parts.push(...this.machineProps(o));
    } else if (o.role === 'magnet') {
      parts.push(...this.magnetProps(o));
    } else if (o.role === 'metal') {
      parts.push(this.heading(tr('ed.nameMetal')), this.note(tr('ed.metalNote')));
    } else if (o.role === 'lily') {
      parts.push(this.heading(tr('ed.nameLily')), this.note(tr('ed.lilyNote')));
    } else if ((o.role === 'path' || o.role === 'wall') && !o.saw) {
      parts.push(this.group(
        this.selectField<Role>(tr('ed.type'), o.role, [['path', tr('ed.pathSafeFloor')], ['wall', tr('ed.wallDeadly')]], (v) => (o.role = v), true),
      ));
    } else if (o.role === 'coin' || o.role === 'dark' || o.role === 'crystal') {
      parts.push(this.note(o.role === 'coin'
        ? tr('ed.coinNote')
        : o.role === 'crystal' ? tr('ed.crystalNote') : tr('ed.darkNote')));
    } else if (o.role === 'safe') {
      parts.push(this.note(tr('ed.nothingCanHurtTheCursor')));
    } else if (o.fog) {
      parts.push(...this.fogProps(o));
    }

    // Shape
    const s = o.shape;
    if ((o.role === 'crystal' || o.role === 'turret') && s.type === 'rect') {
      // Always 48×48 / 60×60: only its position
      parts.push(this.group(
        this.numField(tr('ed.centerX'), s.x + s.w / 2, (v) => (s.x = Math.round(v - s.w / 2))),
        this.numField(tr('ed.centerY'), s.y + s.h / 2, (v) => (s.y = Math.round(v - s.h / 2))),
      ));
    } else if (s.type === 'rect') {
      parts.push(this.group(
        this.numField('X', s.x, (v) => (s.x = Math.round(v))),
        this.numField('Y', s.y, (v) => (s.y = Math.round(v))),
        this.numField(tr('common.width'), s.w, (v) => (s.w = Math.max(1, Math.round(v)))),
        this.numField(tr('common.height'), s.h, (v) => (s.h = Math.max(1, Math.round(v)))),
      ));
    } else if (o.role === 'lily' && s.type === 'ellipse') {
      parts.push(this.group(
        this.numField(tr('ed.centerX'), s.cx, (v) => (s.cx = Math.round(v))),
        this.numField(tr('ed.centerY'), s.cy, (v) => (s.cy = Math.round(v))),
        this.numField(tr('ed.lilySize'), s.rx * 2, (v) => (s.rx = s.ry = Math.max(4, Math.round(v)) / 2), 10),
      ));
    } else if (o.role === 'coin' && s.type === 'ellipse') {
      parts.push(this.group(
        this.numField(tr('ed.centerX'), s.cx, (v) => (s.cx = Math.round(v))),
        this.numField(tr('ed.centerY'), s.cy, (v) => (s.cy = Math.round(v))),
      ));
    } else if (s.type === 'ellipse') {
      parts.push(this.group(
        this.numField(tr('ed.centerX'), s.cx, (v) => (s.cx = Math.round(v))),
        this.numField(tr('ed.centerY'), s.cy, (v) => (s.cy = Math.round(v))),
        this.numField(tr('ed.radiusX'), s.rx, (v) => (s.rx = Math.max(1, Math.round(v)))),
        this.numField(tr('ed.radiusY'), s.ry, (v) => (s.ry = Math.max(1, Math.round(v)))),
      ));
    } else if (s.type === 'sector') {
      parts.push(this.group(
        this.numField(tr('ed.apexX'), s.cx, (v) => (s.cx = Math.round(v))),
        this.numField(tr('ed.apexY'), s.cy, (v) => (s.cy = Math.round(v))),
        this.numField(tr('ed.radius'), s.r, (v) => {
          s.r = Math.max(1, Math.round(v));
          if (s.inner && s.inner >= s.r) s.inner = Math.max(1, s.r - 2);
        }),
        ...(s.inner !== undefined ? [this.numField(tr('ed.innerRadius'), s.inner, (v) => (s.inner = Math.min(s.r - 1, Math.max(1, Math.round(v)))))] : []),
        this.numField(tr('ed.startAngle'), s.start, (v) => (s.start = ((Math.round(v) % 360) + 360) % 360), 15),
        this.numField(tr('ed.sweep'), s.sweep, (v) => (s.sweep = Math.min(360, Math.max(1, Math.round(v)))), 15),
      ));
      parts.push(this.note(tr('ed.0PointsRight90Down')));
    } else {
      const curved = s.points.filter((p) => p.smooth).length;
      parts.push(this.note(tr('ed.vertices', { n: s.points.length, curved })));
    }

    // Tilt: turns about the center (route markers stay; the pivot and beam / thrust turn with it)
    parts.push(
      this.group(this.numField(tr('ed.tilt'), o.tilt ?? 0, (v) => {
        const next = tiltObject(o, v - (o.tilt ?? 0));
        Object.assign(o, next);
        if (next.tilt === undefined) delete o.tilt;
      }, 15)),
      this.note(tr('ed.tiltNote')),
    );

    if (o.trigger) parts.push(...this.triggerProps(o));
    if (o.door) parts.push(...this.doorProps(o));
    if (o.spike) parts.push(...this.spikeProps(o));
    if (o.fall) parts.push(...this.fallProps(o));
    if (o.pulley) parts.push(...this.pulleyProps(o));
    if (o.saw) parts.push(...this.sawProps(o));
    if (o.text) parts.push(...this.textProps(o));
    if (o.boulder) {
      parts.push(this.heading(tr('ed.rollingBoulder')), this.note(o.motion ? tr('ed.boulderRolls') : tr('ed.boulderNoRoute')));
      const m = o.motion;
      if (m) {
        // Wavy route: the boulder weaves across its route as it rolls (height 0 = straight)
        const w = m.wave ?? { amplitude: 0, wavelength: DEFAULT_BOULDER_WAVE.wavelength };
        const setWave = (next: { amplitude: number; wavelength: number }) => {
          if (next.amplitude > 0) m.wave = next;
          else delete m.wave;
        };
        parts.push(
          this.group(
            this.numField(tr('ed.waveAmplitude'), w.amplitude, (v) => setWave({ ...w, amplitude: Math.round(Math.min(LIMITS.maxWaveAmplitude, Math.max(0, v))) }), 2),
            this.numField(tr('ed.waveLength'), w.wavelength, (v) => setWave({ ...w, wavelength: Math.round(Math.min(LIMITS.maxWavelength, Math.max(LIMITS.minWavelength, v))) }), 10),
          ),
          this.note(tr('ed.waveNote')),
        );
      }
    }
    if (o.role === 'torch') {
      const light = o.light ?? (o.light = { radius: DEFAULT_TORCH_LIGHT });
      parts.push(
        this.heading(tr(o.torch?.carry ? 'ed.nameCarryTorch' : 'ed.nameTorch')),
        this.group(
          this.numField(tr('ed.torchRadius'), light.radius, (v) => (light.radius = Math.round(Math.min(LIMITS.maxLight, Math.max(0, v)))), 10),
          this.numField(tr('ed.torchIntensity'), light.intensity ?? 100, (v) => {
            const k = Math.round(Math.min(100, Math.max(0, v)));
            if (k === 100) delete light.intensity;
            else light.intensity = k;
          }, 5),
        ),
        this.toggle(tr('ed.torchCarry'), !!o.torch?.carry, (on) => {
          if (on) o.torch = { carry: true };
          else delete o.torch;
        }),
        this.note(tr('ed.torchNote')),
      );
    }
    if (o.role === 'secret') {
      const sw = o.secret ?? (o.secret = { radius: DEFAULT_SECRET_RADIUS });
      parts.push(
        this.heading(tr('ed.nameSecret')),
        this.group(this.numField(tr('ed.secretRadius'), sw.radius, (v) => (sw.radius = Math.round(Math.min(LIMITS.maxLight, Math.max(1, v)))), 10)),
        this.note(tr('ed.secretNote')),
      );
    }
    if (o.spot) parts.push(...this.spotProps(o));
    if (o.laser) parts.push(...this.laserProps(o));
    if (o.turret) parts.push(...this.turretProps(o));
    if (o.portal) parts.push(...this.portalProps(o));
    if (o.role === 'mirror') parts.push(this.heading(tr('ed.mirror')), this.note(tr('ed.laserBeamsBounceOffEvery')));
    if (o.role === 'path') {
      parts.push(this.toggle(tr('ed.pierceWalls'), !!o.pierce, (on) => {
        if (on) o.pierce = true;
        else delete o.pierce;
      }));
      // Ice (#71–74)
      parts.push(this.toggle(tr('ed.iceToggle'), !!o.ice, (on) => {
        if (on) {
          o.ice = { grip: DEFAULT_ICE_GRIP };
          // Ice never blinks
          delete o.blink;
        } else delete o.ice;
      }));
      const ice = o.ice;
      if (ice) {
        parts.push(
          this.group(this.numField(tr('ed.iceGrip'), ice.grip, (v) => (ice.grip = Math.round(Math.min(100, Math.max(1, v)))), 5)),
          this.note(tr('ed.iceNote')),
        );
      }
    }
    if ((o.role === 'path' || o.role === 'wall') && !o.saw && !o.fall && !o.ice) parts.push(...this.blinkProps(o));
    if (o.role === 'path' || o.role === 'wall' || o.role === 'coin' || o.role === 'dark' || o.role === 'fog' || o.role === 'mirror' || o.role === 'laser' || o.role === 'turret'
      || o.role === 'liquid' || o.role === 'lily' || o.role === 'spot' || o.role === 'rad' || o.role === 'magnet') parts.push(...this.linkProps(o));
    parts.push(...this.elecProps(o, idx));

    // Movement (a spike's thrust is its movement; liquids stay put)
    if (!o.spike && !o.fall && !o.press && o.role !== 'liquid' && o.role !== 'metal') {
    // Movement
    parts.push(this.heading(tr('ed.movement')), this.toggle(tr('ed.movesAlongARoute'), !!o.motion, (on) => {
      if (on) {
        o.motion = newMotion(o);
        queueMicrotask(() => this.host.startMarkers(idx));
      } else {
        delete o.motion;
      }
    }));
    if (o.motion) {
      const m: Motion = o.motion;
      const fields = [
        this.selectField<MotionType>(tr('ed.route'), m.type, ROUTE_OPTIONS, (v) => {
          if (v === 'circle' && m.type !== 'circle') {
            const c = shapeCenter(o.shape);
            m.points = [m.points[0] ?? { x: c.x, y: c.y - 80 }];
            m.repeat = 'loop';
            m.easing = 'none';
          }
          m.type = v;
          delete m.segmentTypes;
        }),
        this.selectField<Repeat>(tr('ed.repeat'), m.repeat, ROUTE_REPEAT_OPTIONS, (v) => {
          m.repeat = v;
          if (v !== 'slam') delete m.returnSpeed;
        }),
        this.numField(tr(m.repeat === 'slam' ? 'ed.slamSpeed' : 'ed.speedPxS'), m.speed, (v) => (m.speed = Math.min(LIMITS.maxSpeed, Math.max(0, v))), 10),
        // The same speed as the time of one cycle (a slam's cycle also holds its rest and slow way back)
        ...(m.repeat === 'slam' ? [] : this.motionCycleField(o, m)),
        // A slam has its own fixed easing: rushing in, easing back
        ...(m.repeat === 'slam'
          ? [this.numField(tr('ed.slamReturnSpeed'), m.returnSpeed ?? m.speed / 4, (v) => (m.returnSpeed = Math.min(LIMITS.maxSpeed, Math.max(1, Math.round(v)))), 10)]
          : [this.selectField<Easing>(tr('ed.smooth'), m.easing, EASING_OPTIONS, (v) => (m.easing = v))]),
        this.numField(tr('ed.startDelayMs'), m.delay, (v) => (m.delay = Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, Math.round(v)))), 100),
      ];
      if (m.type === 'circle') {
        fields.push(this.selectField(tr('ed.direction'), m.clockwise ? 'cw' : 'ccw', DIRECTION_OPTIONS, (v) => (m.clockwise = v === 'cw')));
      }
      parts.push(this.group(...fields));
      if (m.type !== 'circle' && m.points.length) {
        parts.push(this.heading(tr('ed.routeSegments')), this.note(tr('ed.routeSegmentsHint')));
        const count = m.points.length + (m.repeat === 'loop' ? 1 : 0);
        for (let i = 0; i < count; i++) {
          const from = i === 0 ? tr('ed.routeStart') : String(i);
          const to = i === m.points.length ? tr('ed.routeStart') : String(i + 1);
          parts.push(this.selectField<'linear' | 'curve'>(`${from} → ${to}`,
            m.segmentTypes?.[i] ?? m.type,
            [['linear', tr('ed.straight')], ['curve', tr('ed.curve')]], (v) => {
              m.segmentTypes = Array.from({ length: m.points.length + 1 }, (_, j) =>
                m.segmentTypes?.[j] ?? (m.type === 'curve' ? 'curve' : 'linear'));
              m.segmentTypes[i] = v;
            }));
        }
      }
      parts.push(this.toggle(tr('ed.showPath'), !!m.showPath, (on) => {
        if (on) m.showPath = true;
        else delete m.showPath;
      }));
      parts.push(this.note(
        m.type === 'circle'
          ? m.points.length ? tr('ed.orbitSet') : tr('ed.orbitUnset')
          : tr(m.points.length === 1 ? 'ed.markersOne' : 'ed.markersMany', { n: m.points.length }),
      ));
      parts.push(this.actions(
        this.button(m.type === 'circle' ? tr('ed.setOrbit') : tr('ed.placeMarkers'), () => this.host.startMarkers(idx)),
        this.button(tr('ed.removeLast'), () => m.points.length && this.host.edit(() => {
          m.segmentTypes?.splice(m.points.length - 1, 1);
          m.points.pop();
        })),
        this.button(tr('ed.clear'), () => m.points.length && this.host.edit(() => {
          m.points = [];
          delete m.segmentTypes;
        })),
      ));
    }

    }

    // Rotation (a boulder spins by rolling; a saw keeps its own spin / sawing on top of it, #62)
    if (!o.boulder && !o.fall && !o.press && !o.pendulum && o.role !== 'liquid' && o.role !== 'metal') {
    // Rotation
    parts.push(this.heading(tr('ed.rotation')), this.toggle(tr('ed.rotatesAroundAPivot'), !!o.rotation, (on) => {
      if (on) o.rotation = defaultRotation(o);
      else delete o.rotation;
    }));
    if (o.rotation) {
      const r: Rotation = o.rotation;
      const tk = r.tick;
      const sec = (ms: number) => ms / 1000;
      const ms = (v: number) => Math.round(Math.min(LIMITS.maxDelay, Math.max(0, v)) * 1000);
      // Beat by beat (#111 / #113): each beat's angle and timing replace the speed
      const pace = tk
        ? [
          this.numField(tr('ed.tickAngle'), tk.angle, (v) => (tk.angle = Math.min(360, Math.max(0.1, v))), 1),
          this.numField(tr('ed.tickMoveS'), sec(tk.moveMs), (v) => (tk.moveMs = ms(v)), 0.05),
          this.numField(tr('ed.tickWaitS'), sec(tk.waitMs), (v) => (tk.waitMs = ms(v)), 0.05),
        ]
        : [
          this.numField(tr('ed.speedS'), r.speed, (v) => (r.speed = Math.min(LIMITS.maxRotSpeed, Math.max(0, v))), 5),
          // The same speed as the time of one cycle: one sweep of `angle` (there and back for ping-pong)
          this.numField(tr('ed.cycleTimeS'), r.speed > 0 ? (r.angle * cycleSweeps(r.repeat)) / r.speed : 0, (v) => {
            if (v > 0 && r.angle > 0) r.speed = Math.min(LIMITS.maxRotSpeed, Math.max(0.01, (r.angle * cycleSweeps(r.repeat)) / v));
          }, 0.1),
        ];
      parts.push(this.toggle(tr('ed.tick'), !!tk, (on) => {
        if (on) r.tick = { angle: 6, moveMs: 150, waitMs: 850 };
        else delete r.tick;
      }));
      parts.push(this.group(
        ...pace,
        this.numField(tr('common.angle'), r.angle, (v) => (r.angle = Math.min(LIMITS.maxAngle, Math.max(0, v))), 15),
        this.selectField(tr('ed.direction'), r.clockwise ? 'cw' : 'ccw', DIRECTION_OPTIONS, (v) => (r.clockwise = v === 'cw')),
        this.selectField<Repeat>(tr('ed.repeat'), r.repeat, REPEAT_OPTIONS, (v) => (r.repeat = v)),
        this.selectField<Easing>(tr('ed.smooth'), r.easing, EASING_OPTIONS, (v) => (r.easing = v)),
        this.numField(tr('ed.startDelayMs'), r.delay, (v) => (r.delay = Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, Math.round(v)))), 100),
        this.numField(tr('ed.pivotX'), r.pivot.x, (v) => (r.pivot = { ...r.pivot, x: Math.round(v) })),
        this.numField(tr('ed.pivotY'), r.pivot.y, (v) => (r.pivot = { ...r.pivot, y: Math.round(v) })),
      ));
      parts.push(this.toggle(tr('ed.showPivot'), !!r.showPivot, (on) => {
        if (on) r.showPivot = true;
        else delete r.showPivot;
      }));
      parts.push(this.note(tr('ed.angle360LoopContinuousSpin')));
      parts.push(this.actions(this.button(tr('ed.centerPivot'), () => this.host.edit(() => (r.pivot = defaultRotation(o).pivot)))));
    }

    }

    parts.push(...this.arrangeProps(false));
    parts.push(this.editActions());
    box.replaceChildren(...parts);
  }

  colorPicker(value: number, apply: (c: number) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    wrap.setAttribute('role', 'radiogroup');
    SWITCH_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === value));
      b.addEventListener('click', () => {
        this.host.lastColor = i;
        this.host.edit(() => apply(i));
      });
      wrap.append(b);
    });
    return wrap;
  }

  triggerProps(o: MapObject): HTMLElement[] {
    const t = o.trigger!;
    const out: HTMLElement[] = [this.heading(TRIGGER_NAMES[t.kind]), this.colorPicker(t.color, (c) => (t.color = c))];
    const fields: HTMLElement[] = [];
    if (t.kind === 'switch' || t.kind === 'timer') {
      const modes: ['touch' | 'click' | 'plate', string][] = [['touch', tr('ed.touchingIt')], ['click', tr('ed.clickingOnIt')]];
      if (t.kind === 'switch') modes.push(['plate', tr('ed.whileTouching')]);
      fields.push(this.selectField(tr('ed.pressedBy'), t.momentary ? 'plate' : t.click ? 'click' : 'touch', modes, (v) => {
        delete t.click;
        delete t.momentary;
        if (v === 'click') t.click = true;
        if (v === 'plate') {
          t.momentary = true;
          delete t.initial;
          delete t.once;
        }
      }));
    }
    if (t.kind === 'timer' || t.kind === 'hold') {
      fields.push(this.numField(t.kind === 'timer' ? tr('ed.onFor') : tr('ed.holdFor'), (t.duration ?? 1000) / 1000,
        (v) => (t.duration = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.1));
    }
    if (fields.length) out.push(this.group(...fields));
    if ((t.kind === 'switch' || t.kind === 'hold') && !t.momentary) {
      out.push(this.toggle(tr('ed.startsOn'), !!t.initial, (on) => {
        if (on) t.initial = true;
        else delete t.initial;
      }));
    }
    if (isButton(t.kind) && !t.momentary) {
      out.push(this.toggle(tr('ed.canBeSwitchedBack'), !t.once, (on) => {
        if (on) delete t.once;
        else t.once = true;
      }));
    }
    out.push(this.toggle(tr('ed.revertWhenOff'), !!t.revert, (on) => {
      if (on) t.revert = true;
      else delete t.revert;
    }));
    const linked = this.host.map.objects.filter((m) => m.link?.color === t.color || (m.door?.mode === 'switch' && m.door.color === t.color) || m.laser?.switchColor === t.color).length;
    const what = {
      switch: t.momentary ? tr('ed.whatPlate') : tr('ed.whatSwitch'),
      timer: tr('ed.whatTimer'),
      hold: tr('ed.whatHold'),
      startZone: tr('ed.whatStartZone'),
      stopZone: tr('ed.whatStopZone'),
    }[t.kind];
    out.push(this.note(`${what} ${tr(linked === 1 ? 'ed.linkedOne' : 'ed.linkedMany', { n: linked, color: switchColor(t.color).name })}`));
    return out;
  }

  fallProps(o: MapObject): HTMLElement[] {
    const f = o.fall!;
    const sec = (v: number) => v / 1000;
    const ms = (v: number, min: number) => Math.round(Math.min(LIMITS.maxDelay, Math.max(min, v)) * 1000);
    return [
      this.heading(tr('ed.nameFall')),
      this.group(
        this.numField(tr('ed.fallHeight'), f.height, (v) => (f.height = Math.max(1, Math.round(v))), 10),
        this.numField(tr('ed.fallTimeS'), sec(f.fallMs), (v) => (f.fallMs = ms(v, 0.05)), 0.1),
        this.numField(tr('ed.restS'), sec(f.waitMs), (v) => (f.waitMs = ms(v, 0)), 0.1),
        this.numField(tr('ed.startDelayS'), sec(f.delay), (v) => (f.delay = Math.round(Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, v)) * 1000)), 0.1),
      ),
      this.note(tr('ed.fallNote')),
    ];
  }

  pulleyProps(o: MapObject): HTMLElement[] {
    const p = o.pulley!;
    const linked = this.host.map.objects.filter((m) => m.link?.action === 'pulley' && m.link.color === p.color).length;
    const out: HTMLElement[] = [
      this.heading(tr('ed.namePulley')),
      this.colorPicker(p.color, (c) => (p.color = c)),
      this.group(
        this.selectField<'hold' | 'unwind'>(tr('ed.pulleyRelease'), p.mode, [['hold', tr('ed.pulleyHold')], ['unwind', tr('ed.pulleyUnwind')]], (v) => (p.mode = v), true),
        this.numField(tr('ed.pulleyTurnS'), p.turnMs / 1000, (v) => (p.turnMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.1),
        ...(p.mode === 'unwind' ? [this.numField(tr('ed.pulleyUnwindSpeed'), p.unwind, (v) => (p.unwind = Math.round(Math.min(100, Math.max(0, v)))), 10)] : []),
      ),
      this.note(tr('ed.pulleyNote')),
      this.note(tr(linked === 1 ? 'ed.linkedOne' : 'ed.linkedMany', { n: linked, color: switchColor(p.color).name })),
    ];
    return out;
  }

  spikeProps(o: MapObject): HTMLElement[] {
    const s = o.spike!;
    const sec = (v: number) => v / 1000;
    const ms = (v: number) => Math.round(Math.min(LIMITS.maxDelay, Math.max(0.01, v)) * 1000);
    return [
      this.heading(tr('ed.spikeStake')),
      this.group(
        this.numField(tr('ed.direction2'), s.angle, (v) => (s.angle = ((Math.round(v) % 360) + 360) % 360), 15),
        this.numField(tr('ed.reach'), s.reach, (v) => (s.reach = Math.max(1, Math.round(v))), 5),
        this.numField(tr('ed.thrustS'), sec(s.thrustMs), (v) => (s.thrustMs = ms(v)), 0.05),
        this.numField(tr('ed.returnS'), sec(s.returnMs), (v) => (s.returnMs = ms(v)), 0.1),
        this.numField(tr('ed.restS'), sec(s.waitMs), (v) => (s.waitMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0, v)) * 1000)), 0.1),
        this.numField(tr('ed.startDelayS'), sec(s.delay), (v) => (s.delay = Math.round(Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, v)) * 1000)), 0.1),
      ),
      this.note(tr('ed.restsThrustsOutFastThen')),
    ];
  }

  fogProps(o: MapObject): HTMLElement[] {
    const f = o.fog!;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '5';
    range.value = String(f.density);
    const out = document.createElement('output');
    out.textContent = `${f.density}%`;
    range.addEventListener('input', () => (out.textContent = `${range.value}%`));
    range.addEventListener('change', () => this.host.edit(() => (f.density = Math.max(0, Math.min(100, Number(range.value))))));
    const control = document.createElement('div');
    control.className = 'range-field';
    control.append(range, out);
    return [
      this.group(
        this.selectField<FogKind>(tr('ed.type'), f.kind, [['fog', tr('ed.nameFog')], ['sand', tr('ed.nameSand')]], (v) => (f.kind = v), true),
        this.field(tr('ed.fogDensity'), control, true),
      ),
      this.note(tr('ed.fogNote')),
    ];
  }

  sawProps(o: MapObject): HTMLElement[] {
    const s = o.saw!;
    if (s.kind === 'disc') {
      return [
        this.heading(tr('ed.circularGrinder')),
        this.group(
          this.selectField(tr('ed.spin'), s.clockwise ? 'cw' : 'ccw', DIRECTION_OPTIONS, (v) => (s.clockwise = v === 'cw')),
          this.numField(tr('ed.speedS'), s.spin, (v) => (s.spin = Math.min(LIMITS.maxRotSpeed, Math.max(0, Math.round(v)))), 90),
        ),
        this.note(tr('ed.deadlyThrowsDustWhereIt')),
      ];
    }
    const sec = (v: number) => v / 1000;
    return [
      this.heading(tr('ed.sawBlade')),
      this.group(
        this.numField(tr('ed.strokePx'), s.stroke, (v) => (s.stroke = Math.max(0, Math.round(v))), 4),
        this.numField(tr('ed.strokeTimeS'), sec(s.strokeMs), (v) => (s.strokeMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.05),
      ),
      this.note(tr('ed.deadlySawsBackAndForth')),
    ];
  }

  textProps(o: MapObject): HTMLElement[] {
    const t = o.text!;
    const area = document.createElement('textarea');
    area.rows = 3;
    area.maxLength = 500;
    area.value = t.text;
    area.addEventListener('change', () => this.host.edit(() => (t.text = area.value)));
    const colorInput = (value: string, apply: (v: string) => void) => {
      const c = document.createElement('input');
      c.type = 'color';
      c.value = value;
      c.addEventListener('change', () => this.host.edit(() => apply(c.value.toLowerCase())));
      return c;
    };
    const font = document.createElement('select');
    for (const [v, label] of TEXT_BASE_FONTS) font.append(new Option(label, v, false, v === t.font));
    fontPicker(font, t.font);
    font.addEventListener('change', () => this.host.edit(() => (t.font = font.value)));
    const out: HTMLElement[] = [
      this.heading(tr('ed.textBox')),
      this.field(tr('common.text'), area, true),
      this.group(
        this.field(tr('common.font'), font, true),
        this.numField(tr('common.size'), t.size, (v) => (t.size = Math.min(200, Math.max(6, Math.round(v)))), 2),
        this.field(tr('common.color'), colorInput(t.color, (v) => (t.color = v))),
        this.selectField(tr('common.align'), t.align, [['left', tr('common.left')], ['center', tr('common.center')], ['right', tr('common.right')]], (v) => (t.align = v)),
      ),
      this.toggle(tr('common.bold'), t.bold, (on) => (t.bold = on)),
      this.toggle(tr('common.outline'), !!t.outline, (on) => {
        if (on) t.outline = '#ffffff';
        else delete t.outline;
      }),
    ];
    if (t.outline) {
      out.push(this.group(
        this.field(tr('ed.outlineColor'), colorInput(t.outline, (v) => (t.outline = v))),
        this.numField(tr('ed.outlineWidth'), t.outlineWidth, (v) => (t.outlineWidth = Math.min(20, Math.max(0, v))), 0.5),
      ));
    }
    out.push(this.toggle(tr('common.background'), !!t.background, (on) => {
      if (on) t.background = '#ffffffb3';
      else delete t.background;
    }));
    if (t.background) {
      const bg = t.background;
      const alpha = parseInt(bg.slice(7, 9), 16) / 255;
      const hex2 = (a: number) => Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0');
      out.push(this.group(
        this.field(tr('common.background'), colorInput(bg.slice(0, 7), (v) => (t.background = v + bg.slice(7, 9)))),
        this.numField(tr('ed.opacity'), Math.round(alpha * 100), (v) => (t.background = bg.slice(0, 7) + hex2(v / 100)), 5),
      ));
    }
    // Effects: each one is a toggle that reveals its settings
    out.push(this.toggle(tr('fx.shadow'), !!t.shadow, (on) => {
      if (on) t.shadow = '#000000';
      else delete t.shadow;
    }));
    if (t.shadow) out.push(this.group(this.field(tr('fx.shadowColor'), colorInput(t.shadow, (v) => (t.shadow = v)))));
    out.push(this.toggle(tr('fx.glow'), !!t.glow, (on) => {
      if (on) t.glow = '#3ae8ff';
      else delete t.glow;
    }));
    if (t.glow) out.push(this.group(this.field(tr('fx.glowColor'), colorInput(t.glow, (v) => (t.glow = v)))));
    out.push(this.toggle(tr('fx.gradient'), !!t.gradient, (on) => {
      if (on) t.gradient = '#ff7a3a';
      else delete t.gradient;
    }));
    if (t.gradient) out.push(this.group(this.field(tr('fx.gradientColor'), colorInput(t.gradient, (v) => (t.gradient = v)))));
    out.push(this.toggle(tr('fx.depth'), !!t.depth, (on) => {
      if (on) {
        t.depth = 4;
        t.depthColor ??= '#1a2233';
      } else {
        delete t.depth;
        delete t.depthColor;
      }
    }));
    if (t.depth) {
      out.push(this.group(
        this.numField(tr('fx.depthSize'), t.depth, (v) => (t.depth = Math.min(30, Math.max(1, Math.round(v)))), 1),
        this.field(tr('fx.depthColor'), colorInput(t.depthColor ?? '#000000', (v) => (t.depthColor = v))),
      ));
    }
    out.push(this.note(tr('ed.onlyDecorationTheCursorCan')));
    return out;
  }

  laserProps(o: MapObject): HTMLElement[] {
    const l = o.laser!;
    const out: HTMLElement[] = [
      this.heading(tr('ed.laser')),
      this.colorPicker(l.color, (c) => (l.color = c)),
      this.group(this.numField(tr('ed.direction2'), l.angle, (v) => (l.angle = ((Math.round(v) % 360) + 360) % 360), 15)),
      this.toggle(tr('ed.beamOnAtTheStart'), l.on, (on) => (l.on = on)),
      this.toggle(tr('ed.aSwitchFlipsItOn'), l.switchColor !== undefined, (on) => {
        if (on) l.switchColor = this.host.lastColor;
        else delete l.switchColor;
      }),
    ];
    if (l.switchColor !== undefined) {
      const sc = l.switchColor;
      out.push(this.colorPicker(sc, (c) => (l.switchColor = c)), this.note(tr(l.on ? 'ed.laserSwitchOff' : 'ed.laserSwitchOn', { color: switchColor(sc).name })));
    }
    out.push(this.note(tr('ed.dragTheOrangeDiamondTo')));
    return out;
  }

  /** Blinking (#75–82): how long it is there, how long it is gone, and when the cycle starts */
  blinkProps(o: MapObject): HTMLElement[] {
    const out: HTMLElement[] = [
      this.heading(tr('ed.blinking')),
      this.toggle(tr('ed.blinks'), !!o.blink, (on) => {
        if (on) o.blink = { ...DEFAULT_BLINK };
        else delete o.blink;
      }),
    ];
    const b = o.blink;
    if (!b) return out;
    const sec = (ms: number) => ms / 1000;
    const ms = (v: number, min: number) => Math.round(Math.min(LIMITS.maxDelay, Math.max(min, v)) * 1000);
    out.push(
      this.group(
        this.numField(tr('ed.blinkOnS'), sec(b.onMs), (v) => (b.onMs = ms(v, 0.05)), 0.1),
        this.numField(tr('ed.blinkOffS'), sec(b.offMs), (v) => (b.offMs = ms(v, 0)), 0.1),
        this.numField(tr('ed.startDelayS'), sec(b.delay), (v) => (b.delay = Math.round(Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, v)) * 1000)), 0.1),
      ),
      this.note(tr(o.role === 'path' ? 'ed.blinkPathNote' : 'ed.blinkWallNote')),
    );
    return out;
  }

  /** Turret (#60) / missile launcher (#61): range, rate of fire, shot speed, aiming and anti-materiel rounds */
  turretProps(o: MapObject): HTMLElement[] {
    const t = o.turret!;
    if (t.kind === 'fixed' || t.kind === 'spin') return this.multiTurretProps(o);
    const gun = t.kind === 'gun';
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const deg = (v: number) => {
      const a = ((Math.round(v) % 360) + 360) % 360;
      return a > 180 ? a - 360 : a;
    };
    return [
      this.heading(tr(gun ? 'ed.nameTurret' : 'ed.nameMissile')),
      this.group(
        this.numField(tr('ed.turretRange'), t.range, (v) => (t.range = Math.round(clamp(v, 1, LIMITS.maxTurretRange))), 10),
        this.numField(tr('ed.turretFireS'), t.fireMs / 1000, (v) => (t.fireMs = Math.round(clamp(v, LIMITS.minFireMs / 1000, LIMITS.maxDelay / 1000) * 1000)), 0.1),
        this.numField(tr(gun ? 'ed.turretBulletSpeed' : 'ed.turretMissileSpeed'), t.speed, (v) => (t.speed = Math.round(clamp(v, 1, LIMITS.maxSpeed))), 10),
        this.numField(tr(gun ? 'ed.turretAngle' : 'ed.turretLaunchAngle'), t.angle, (v) => (t.angle = deg(v)), 15),
        ...(gun
          ? [
            this.numField(tr('ed.turretTurnSpeed'), t.turnSpeed, (v) => (t.turnSpeed = Math.round(clamp(v, 0, LIMITS.maxRotSpeed))), 15),
            this.numField(tr('ed.turretArc'), t.arc, (v) => (t.arc = Math.round(clamp(v, 0, 360))), 15),
          ]
          : [
            this.numField(tr('ed.turretHoming'), t.turnSpeed, (v) => (t.turnSpeed = Math.round(clamp(v, 0, LIMITS.maxRotSpeed))), 15),
            this.numField(tr('ed.turretLifeS'), t.lifeMs / 1000, (v) => (t.lifeMs = Math.round(clamp(v, 0.1, LIMITS.maxDelay / 1000) * 1000)), 0.5),
          ]),
      ),
      this.toggle(tr('ed.turretPierce'), t.pierce, (on) => (t.pierce = on)),
      this.note(tr(gun ? 'ed.turretNote' : 'ed.missileNote')),
    ];
  }

  /** Fixed (#121) / rotating (#122) turret, with 1, 2 or 4 barrels (#123–126) */
  private multiTurretProps(o: MapObject): HTMLElement[] {
    const t = o.turret!;
    const spin = t.kind === 'spin';
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const deg = (v: number) => {
      const a = ((Math.round(v) % 360) + 360) % 360;
      return a > 180 ? a - 360 : a;
    };
    return [
      this.heading(turretName(t.kind, t.barrels)),
      this.group(
        this.selectField<'1' | '2' | '4'>(tr('ed.turretBarrels'), String(t.barrels ?? 1) as '1' | '2' | '4', [['1', tr('ed.turretBarrels1')], ['2', tr('ed.turretBarrels2')], ['4', tr('ed.turretBarrels4')]], (v) => {
          if (v === '1') delete t.barrels;
          else t.barrels = Number(v) as 2 | 4;
        }, true),
        this.numField(tr('ed.turretRange'), t.range, (v) => (t.range = Math.round(clamp(v, 1, LIMITS.maxTurretRange))), 10),
        this.numField(tr('ed.turretFireS'), t.fireMs / 1000, (v) => (t.fireMs = Math.round(clamp(v, LIMITS.minFireMs / 1000, LIMITS.maxDelay / 1000) * 1000)), 0.1),
        this.numField(tr('ed.turretBulletSpeed'), t.speed, (v) => (t.speed = Math.round(clamp(v, 1, LIMITS.maxSpeed))), 10),
        this.numField(tr(spin ? 'ed.turretSpinCenter' : 'ed.turretAngle'), t.angle, (v) => (t.angle = deg(v)), 15),
        ...(spin
          ? [
            this.numField(tr('ed.turretTurnSpeed'), t.turnSpeed, (v) => (t.turnSpeed = Math.round(clamp(v, 0, LIMITS.maxRotSpeed))), 15),
            this.selectField<'cw' | 'ccw'>(tr('ed.turretSpinDir'), t.ccw ? 'ccw' : 'cw', [['cw', tr('ed.clockwise')], ['ccw', tr('ed.counterClockwise')]], (v) => {
              if (v === 'ccw') t.ccw = true;
              else delete t.ccw;
            }),
            this.numField(tr('ed.turretArc'), t.arc, (v) => (t.arc = Math.round(clamp(v, 0, 360))), 15),
          ]
          : [this.numField(tr('ed.turretSight'), t.arc, (v) => (t.arc = Math.round(clamp(v, 0, 360))), 15)]),
      ),
      this.toggle(tr('ed.turretPierce'), t.pierce, (on) => (t.pierce = on)),
      this.toggle(tr('ed.turretAlways'), !!t.always, (on) => {
        if (on) t.always = true;
        else delete t.always;
      }),
      this.note(tr(spin ? 'ed.spinTurretNote' : 'ed.fixedTurretNote')),
    ];
  }

  portalProps(o: MapObject): HTMLElement[] {
    const p = o.portal!;
    const same = this.host.map.objects.filter((m) => m.portal?.color === p.color).length;
    return [
      this.heading(tr('ed.teleportPortal')),
      this.colorPicker(p.color, (c) => (p.color = c)),
      this.group(
        this.selectField(tr('ed.direction'), p.mode, [['both', tr('ed.bothWays')], ['in', tr('ed.entranceOnly')], ['out', tr('ed.exitOnly')]], (v) => (p.mode = v), true),
        this.numField(tr('ed.order'), p.order + 1, (v) => (p.order = Math.max(0, Math.min(9999, Math.round(v) - 1)))),
      ),
      this.note(tr('ed.portalNote', { color: switchColor(p.color).name, n: same })),
    ];
  }

  doorProps(o: MapObject): HTMLElement[] {
    const d = o.door!;
    const out: HTMLElement[] = [
      this.heading(tr('ed.autoDoor')),
      this.group(
        this.selectField(tr('ed.opens'), d.mode, [['auto', tr('ed.byItselfCycle')], ['switch', tr('ed.whileASwitchIsOn')]], (v) => (d.mode = v), true),
        this.numField(tr('ed.openCloseTimeS'), d.moveMs / 1000, (v) => (d.moveMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.1),
        ...(d.mode === 'auto' ? [this.numField(tr('ed.staysOpenShutS'), d.waitMs / 1000, (v) => (d.waitMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0, v)) * 1000)), 0.1)] : []),
      ),
    ];
    if (d.mode === 'switch') out.push(this.colorPicker(d.color, (c) => (d.color = c)));
    out.push(this.note(tr('ed.theDoorSplitsAcrossIts')));
    return out;
  }

  linkProps(o: MapObject): HTMLElement[] {
    const out: HTMLElement[] = [this.heading(tr('ed.switchLink')), this.toggle(tr('ed.reactsToASwitch'), !!o.link, (on) => {
      if (on) o.link = { color: this.host.lastColor, action: o.motion || o.rotation ? 'start' : 'remove' };
      else delete o.link;
    })];
    const l = o.link;
    if (l) {
      out.push(
        this.colorPicker(l.color, (c) => (l.color = c)),
        this.group(this.selectField<LinkAction>(tr('ed.whileOn'), l.action, [
          ['start', tr('ed.movesStartsMoving')],
          ['stop', tr('ed.stopsMoving')],
          ['remove', tr('ed.isRemoved')],
          ['pulley', tr('ed.movesWithPulley')],
        ], (v) => (l.action = v), true)),
        this.note(tr(l.action === 'pulley' ? 'ed.movesWithPulleyNote' : 'ed.movesObjectsStayStillUntil')),
      );
    }
    return out;
  }

  cmdButton(c: Command, icon: IconName): HTMLButtonElement {
    const b = setIcon(this.button('', () => c.enabled && c.run(), 'cmd-btn'), icon, c.label, c.keys);
    b.disabled = !c.enabled;
    return b;
  }

  iconButton(icon: IconName, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    return setIcon(this.button('', onClick, cls), icon, label);
  }

  /** Duplicate / delete for the current selection */
  editActions(): HTMLElement {
    const d = this.actions(
      this.iconButton('duplicate', tr('common.duplicate'), () => this.host.duplicateSelected(), 'cmd-btn'),
      this.iconButton('trash', tr('common.delete'), () => this.host.deleteSelected(), 'cmd-btn danger'),
    );
    d.classList.add('cmd-row');
    return d;
  }

  arrangeProps(multi: boolean): HTMLElement[] {
    const c = this.host.commands();
    const row = (...b: HTMLButtonElement[]) => {
      const d = this.actions(...b);
      d.classList.add('cmd-row');
      return d;
    };
    const out: HTMLElement[] = [
      this.heading(tr('ed.arrange')),
      row(this.cmdButton(c.front, 'front'), this.cmdButton(c.forward, 'forward'), this.cmdButton(c.backward, 'backward'), this.cmdButton(c.back, 'back')),
      row(
        this.cmdButton(c.alignLeft, 'alignLeft'), this.cmdButton(c.alignCenter, 'alignCenter'), this.cmdButton(c.alignRight, 'alignRight'),
        this.cmdButton(c.alignTop, 'alignTop'), this.cmdButton(c.alignMiddle, 'alignMiddle'), this.cmdButton(c.alignBottom, 'alignBottom'),
      ),
    ];
    if (multi) {
      out.push(row(this.cmdButton(c.distH, 'distH'), this.cmdButton(c.distV, 'distV')));
      // A view preference, not a map edit: no undo step
      const wrap = document.createElement('label');
      wrap.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this.host.alignToMap;
      input.addEventListener('change', () => {
        this.host.alignToMap = input.checked;
        this.renderProps();
      });
      const span = document.createElement('span');
      span.textContent = tr('ed.alignToTheMapInstead');
      wrap.append(input, span);
      out.push(wrap);
    } else {
      out.push(this.note(tr('ed.aSingleObjectAlignsTo')));
    }
    out.push(
      row(this.cmdButton(c.rotCW, 'rotCW'), this.cmdButton(c.rotCCW, 'rotCCW'), this.cmdButton(c.flipH, 'flipH'), this.cmdButton(c.flipV, 'flipV')),
    );
    return out;
  }

  multiProps(ids: number[]): HTMLElement[] {
    const c = this.host.commands();
    const objs = ids.map((i) => this.host.map.objects[i]);
    const title = document.createElement('h4');
    const g = objs[0].group;
    title.textContent = g !== undefined && objs.every((o) => o.group === g) ? tr('ed.groupTitle', { g, n: ids.length }) : tr('ed.selectedTitle', { n: ids.length });
    const b = objectsBounds(objs);
    const row = (...bs: HTMLButtonElement[]) => {
      const d = this.actions(...bs);
      d.classList.add('cmd-row');
      return d;
    };
    return [
      title,
      this.note(tr('ed.multiNote', { paths: objs.filter((o) => o.role === 'path').length, walls: objs.filter((o) => o.role === 'wall').length, size: sizeText(b.w, b.h), first: objs[0].id ?? ids[0] + 1 })),
      ...this.arrangeProps(true),
      this.heading(tr('ed.group')),
      row(this.cmdButton(c.group, 'group'), this.cmdButton(c.ungroup, 'ungroup'), this.cmdButton(c.regroup, 'regroup')),
      this.heading(tr('ed.mergeShapes')),
      row(
        this.cmdButton(c.union, 'union'), this.cmdButton(c.combine, 'combine'), this.cmdButton(c.fragment, 'fragment'),
        this.cmdButton(c.intersect, 'intersect'), this.cmdButton(c.subtract, 'subtract'),
      ),
      this.note(tr('ed.theResultIsAFreeform')),
      this.heading(tr('ed.type')),
      row(this.cmdButton(c.makePath, 'makePath'), this.cmdButton(c.makeWall, 'makeWall')),
      this.editActions(),
    ];
  }
}
