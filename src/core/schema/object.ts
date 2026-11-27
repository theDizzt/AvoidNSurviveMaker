import { type Shape } from './common';
import { type Motion, type Rotation, createMotionSchema } from './motion';
import { type Magnet, createMagnetSchema } from './objects/magnet';
import { type Rad, createRadiationSchema } from './objects/radiation';
import { type Liquid, createLiquidSchema } from './objects/liquid';
import { type Spot, createSpotSchema } from './objects/spot';
import { type Wire, type Power, type ElecAction, createElectricSchema } from './objects/electric';
import { type Conveyor, createConveyorSchema } from './objects/conveyor';
import { type Fog, createFogSchema } from './objects/fog';
import { type Saw, createSawSchema } from './objects/saw';
import { type TextBox, createTextSchema } from './objects/text';
import { type Spike, createSpikeSchema } from './objects/spike';
import { type Laser, createLaserSchema } from './objects/laser';
import { type Turret, createTurretSchema } from './objects/turret';
import { type Portal, createPortalSchema } from './objects/portal';
import { type SwitchColor, type Trigger, createTriggerSchema } from './objects/trigger';
import { type Door, createDoorSchema } from './objects/door';
import { type Fall, createFallSchema } from './objects/fall';
import { type Pulley, createPulleySchema } from './objects/pulley';
import { type Blink, createBlinkSchema } from './objects/blink';
import { type Ice, createPathSchema } from './objects/path';
import { type Gear, type Pendulum, type Press, createMachinesSchema } from './objects/machines';
import { type ValidationContext } from './validation';
import { LIMITS } from './limits';
import { createCoinSchema } from './objects/coin';
import { createCrystalSchema } from './objects/crystal';
import { createLuggageSchema } from './objects/luggage';
import { createLilySchema } from './objects/lily';
import { createMetalSchema } from './objects/metal';
import { createBoulderSchema } from './objects/boulder';
import { createVineSchema } from './objects/vine';
import { createTorchSchema } from './objects/torch';
import { createSecretSchema } from './objects/secret';
import { normalizeTilt } from '../shape';
import { MAX_OBJECT_ID } from '../object-ids';

/**
 * path: safe floor (once a map has any path, everything outside paths is deadly). wall: deadly.
 * coin: must all be collected (touched) before GOAL counts. dark: hides the cursor and its trail.
 * trigger: a switch or event zone (see `trigger`). door: a sliding door, deadly like a wall (see `door`).
 * laser: an emitter whose beam is deadly (see `laser`). mirror: reflects laser beams.
 * portal: teleports the cursor to the next portal of its color (see `portal`).
 * text: words drawn on the map, no effect on play (see `text`).
 * safe: a safe zone — nothing can kill the cursor while it is inside (it also counts as floor).
 * fog: fog or sand dust drifting over the area, covering the cursor, obstacles and walls (see `fog`).
 * torch: a harmless light source (#57 / #58, see `torch` and `light`).
 * secret: a secret wall (#55): covers what lies under it like a wall, harmless (see `secret`).
 * pulley: a pulley (#52) in a switch color: circling the cursor inside it turns it, which drives the
 *   objects linked to its color with the 'pulley' action (see `pulley`).
 * crystal: a crystal star (#59), at most one per map: picked up like a coin, it earns a bonus star
 *   when the cursor carries it to GOAL.
 * turret: a gun turret (#60) or homing missile launcher (#61), always 60×60, whose body is deadly
 *   like a wall and which shoots at the cursor once it comes within range (see `turret`).
 * conveyor: a conveyor belt (#69): safe floor like a path (without turning the rest of the map into
 *   wall) that carries the cursor and luggage along its centerline (see `conveyor`).
 * luggage: a wooden crate (#70), deadly like a wall, carried along the conveyor belt it sits on;
 *   it stops against walls, doors and luggage that doesn't move, and at the end of a one-way belt.
 * liquid: a pond (#86), radioactive water (#87), lava (#118), a sulfur spring (#119) or oil
 *   (#120), deadly except on a lily pad (see `liquid`).
 * lily: a lily pad (#85) floating on a liquid: safe floor (like a belt, it doesn't turn the rest
 *   of the map into wall) that also keeps the cursor out of the liquid under it.
 * spot: a spotlight (#88–90), a harmless cone of light (see `spot`).
 * wire: an electric wire (#91): deadly while it carries power (see `wire`).
 * power: an electric device (#94–97): switch, pulley, timer or inverter feeding the wires touching
 *   it (see `power`).
 * metal: a metal box (#98): deadly like a wall, dragged toward magnets that pull it.
 * magnet: a magnet (#99): a deadly block that, while on, pulls the cursor and metal boxes (see `magnet`).
 * rad: a radioactive zone (#115, deadly to touch) or a piece of radioactive waste (#116 box /
 *   #117 drum) whose round radioactive area grows and shrinks around it (see `rad`).
 */
export type Role = 'path' | 'wall' | 'coin' | 'dark' | 'trigger' | 'door' | 'laser' | 'mirror' | 'portal' | 'text' | 'safe' | 'fog' | 'torch' | 'secret' | 'crystal' | 'pulley' | 'turret' | 'conveyor' | 'luggage'
  | 'liquid' | 'lily' | 'spot' | 'wire' | 'power' | 'rad' | 'metal' | 'magnet';

/** pulley: the object's motion / rotation runs only as a pulley (#52) of its color is turned */
export type LinkAction = 'start' | 'stop' | 'remove' | 'pulley';

export interface Link {
  color: SwitchColor;
  /** start: moves only while ON · stop: moves only while OFF · remove: gone while ON */
  action: LinkAction;
}

export interface MapObject {
  /**
   * The object's own number, unique in its map (shown as "#id" in the editor). Given when it is
   * placed and kept through edits, reordering and the removal of other objects; copies get a new one.
   */
  id?: number;
  role: Role;
  shape: Shape;
  /**
   * Static tilt in degrees, clockwise on screen, -180–180 (omitted = 0): the shape is placed turned
   * about its center (`shapeCenter`). Route markers, the rotation pivot and laser / spike angles
   * are in map space and are not turned by it.
   */
  tilt?: number;
  motion?: Motion;
  rotation?: Rotation;
  /** Editor-only grouping: objects sharing a group id are selected and moved together */
  group?: number;
  /** role 'path': cuts through static walls, which are harmless (and hidden) inside it */
  pierce?: boolean;
  /** role 'path': slippery ice (#71–74) */
  ice?: Ice;
  /** role 'trigger' */
  trigger?: Trigger;
  /** role 'door' */
  door?: Door;
  /** Reacts to a switch color (paths, walls, coins, darkness / fog areas, liquids, lily pads, spotlights) */
  link?: Link;
  /** Wall that thrusts like a spear (#29) */
  spike?: Spike;
  /** Wall that rolls (spins with the distance it travels) along its route (#30) */
  boulder?: boolean;
  /** Falling rock (#51): drops from `height` above its resting (landing) place, then shatters */
  fall?: Fall;
  /** Blinking path / wall (#75–82): appears and disappears on a cycle */
  blink?: Blink;
  /** role 'pulley' (#52) */
  pulley?: Pulley;
  /** role 'laser' */
  laser?: Laser;
  /** role 'portal' */
  portal?: Portal;
  /** role 'turret' (#60 / #61) */
  turret?: Turret;
  /** role 'conveyor' (#69) */
  conveyor?: Conveyor;
  /** Grinder / saw blade (#43–46), on a wall */
  saw?: Saw;
  /** role 'text' */
  text?: TextBox;
  /** role 'fog' */
  fog?: Fog;
  /** role 'torch' (#57): a harmless light source (see `light`); `carry` (#58): the cursor picks it up and carries it */
  torch?: { carry?: boolean };
  /** role 'secret' (#55): looks like a wall, harmless; only `radius` px around the cursor shows what lies under it */
  secret?: { radius: number };
  /** Future light-source objects: clear global darkness around the moving shape center. */
  light?: { radius: number; intensity?: number };
  /** Thorn vine (#83 / #84), on a wall: thorns all around its outline (part of its shape) */
  vine?: boolean;
  /** Gear (#111), on a wall: its teeth are part of its outline */
  gear?: Gear;
  /** Clock hand (#113), on a wall: a tapered hand along its box's long side, its hub at one end */
  hand?: boolean;
  /** Pendulum (#114), on a wall */
  pendulum?: Pendulum;
  /** Hydraulic press (#112), on a wall */
  press?: Press;
  /** role 'liquid' (#86 / #87) */
  liquid?: Liquid;
  /** role 'spot' (#88–90) */
  spot?: Spot;
  /** role 'wire' (#91) */
  wire?: Wire;
  /** role 'power' (#94–97) */
  power?: Power;
  /** role 'rad' (#115–117) */
  rad?: Rad;
  /** role 'magnet' (#99) */
  magnet?: Magnet;
  /** How the object reacts to a powered wire ending on it (omitted = a default for its kind) */
  elec?: { action: ElecAction };
}

export function createObjectSchema(context: ValidationContext) {
  const { obj, num, oneOf, shape, colorIndex } = context;
  const { motion, rotation, DEFAULT_MOTION, defaultRotation } = createMotionSchema(context);
  const { validateCoin } = createCoinSchema(context);
  const { validateCrystal } = createCrystalSchema(context);
  const { validateTurret, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_FIXED, DEFAULT_SPIN } = createTurretSchema(context);
  const { validateConveyor } = createConveyorSchema(context);
  const { validateLuggage } = createLuggageSchema(context);
  const { validateElectric } = createElectricSchema(context);
  const { validateLiquid } = createLiquidSchema(context);
  const { validateLily } = createLilySchema(context);
  const { validateMetal } = createMetalSchema(context);
  const { validateMagnet } = createMagnetSchema(context);
  const { validateRadiation } = createRadiationSchema(context);
  const { validateSpot, DEFAULT_SPOT } = createSpotSchema(context);
  const { validatePath, DEFAULT_ICE_GRIP } = createPathSchema(context);
  const { validateTrigger } = createTriggerSchema(context);
  const { validateDoor } = createDoorSchema(context);
  const { validateSpike } = createSpikeSchema(context);
  const { validateFall, DEFAULT_FALL } = createFallSchema(context);
  const { validateBlink, DEFAULT_BLINK } = createBlinkSchema(context);
  const { validatePulley, DEFAULT_PULLEY } = createPulleySchema(context);
  const { validateBoulder, DEFAULT_BOULDER_WAVE } = createBoulderSchema(context);
  const { validateSaw } = createSawSchema(context);
  const { validateVine } = createVineSchema(context);
  const { validateMachines } = createMachinesSchema(context);
  const { validateText } = createTextSchema(context);
  const { validateLaser } = createLaserSchema(context);
  const { validatePortal } = createPortalSchema(context);
  const { validateFog } = createFogSchema(context);
  const { validateTorch, DEFAULT_TORCH_LIGHT } = createTorchSchema(context);
  const { validateSecret, DEFAULT_SECRET_RADIUS } = createSecretSchema(context);

  function mapObject(v: unknown, name: string, W: number, H: number): MapObject {
    const o = obj(v, name);
    const out: MapObject = {
      role: oneOf(o.role, `${name}.role`, ['path', 'wall', 'coin', 'dark', 'trigger', 'door', 'laser', 'mirror', 'portal', 'text', 'safe', 'fog', 'torch', 'secret', 'crystal', 'pulley', 'turret', 'conveyor', 'luggage', 'liquid', 'lily', 'spot', 'wire', 'power', 'rad', 'metal', 'magnet'] as const),
      shape: shape(o.shape, `${name}.shape`, W, H),
    };
    if (o.motion !== undefined) out.motion = motion(o.motion, `${name}.motion`, W, H);
    if (o.rotation !== undefined) out.rotation = rotation(o.rotation, `${name}.rotation`, W, H);
    if (o.tilt !== undefined) {
      const tilt = normalizeTilt(num(o.tilt, `${name}.tilt`, -720, 720));
      if (tilt) out.tilt = tilt;
    }
    if (o.group !== undefined) {
      const g = num(o.group, `${name}.group`, 1, 1e9);
      if (Number.isInteger(g)) out.group = g;
    }
    // A bad or repeated id is replaced (assignObjectIds), not an error
    if (typeof o.id === 'number' && Number.isInteger(o.id) && o.id >= 1 && o.id <= MAX_OBJECT_ID) out.id = o.id;
    // Keep component normalization ordered: later wall features depend on earlier ones,
    // blink depends on ice, and torch defaults must follow explicit light validation.
    validateCoin(out);
    validateCrystal(out);
    validateTurret(o, out, name);
    validateConveyor(o, out, name, W, H);
    validateLuggage(out);
    validateElectric(o, out, name, W, H);
    validateLiquid(o, out, name);
    validateLily(out);
    validateMetal(out);
    validateMagnet(o, out, name);
    validateRadiation(o, out, name);
    validateSpot(o, out, name);
    validatePath(o, out, name);
    validateTrigger(o, out, name);
    validateDoor(o, out, name);
    validateSpike(o, out, name, W, H);
    validateFall(o, out, name, W, H);
    validateBlink(o, out, name);
    validatePulley(o, out, name);
    validateBoulder(o, out);
    validateSaw(o, out, name, W, H);
    validateVine(o, out);
    validateMachines(o, out, name, W, H);
    validateText(o, out, name);
    validateLaser(o, out, name);
    validatePortal(o, out, name);
    validateFog(o, out, name);
    if (o.link !== undefined && (out.role === 'path' || out.role === 'wall' || out.role === 'coin' || out.role === 'dark' || out.role === 'fog' || out.role === 'mirror' || out.role === 'laser' || out.role === 'turret'
      || out.role === 'liquid' || out.role === 'lily' || out.role === 'spot' || out.role === 'rad' || out.role === 'magnet')) {
      const l = obj(o.link, `${name}.link`);
      out.link = { color: colorIndex(l.color, `${name}.link.color`), action: oneOf(l.action, `${name}.link.action`, ['start', 'stop', 'remove', 'pulley'] as const) };
    }
    if (o.elec !== undefined && out.role !== 'wire' && out.role !== 'power') {
      out.elec = { action: oneOf(obj(o.elec, `${name}.elec`).action, `${name}.elec.action`, ['start', 'stop', 'remove', 'show'] as const) };
    }
    if (o.light !== undefined) {
      const light = obj(o.light, `${name}.light`);
      out.light = {
        radius: num(light.radius, `${name}.light.radius`, 0, LIMITS.maxLight),
        ...(light.intensity !== undefined ? { intensity: num(light.intensity, `${name}.light.intensity`, 0, 100) } : {}),
      };
    }
    validateTorch(o, out, name);
    validateSecret(o, out, name);
    return out;
  }

  return { mapObject, DEFAULT_MOTION, defaultRotation, DEFAULT_BOULDER_WAVE, DEFAULT_FALL, DEFAULT_PULLEY, DEFAULT_ICE_GRIP, DEFAULT_BLINK, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_FIXED, DEFAULT_SPIN, DEFAULT_SPOT, DEFAULT_TORCH_LIGHT, DEFAULT_SECRET_RADIUS };
}
