import gsap from 'gsap';
import { CUBE_REST, HANDHELD, SHOTS, TIMING, TRUCK, type Layout, type Shot } from './config';

/**
 * Plain numbers the scene reads on every frame. GSAP writes them; React never
 * re-renders for them, so the intro costs nothing outside the canvas.
 */
export type Rig = {
  layout: Layout;
  /** Road speed in m/s and how far it has rolled. */
  speed: number;
  distance: number;
  /** 0–1: brake lights, nose-down pitch while braking. */
  brake: number;
  pitch: number;
  /** 0 closed, 1 open at TRUCK.doorAngle. */
  doors: number;
  /** Emblem strokes in drawing order: square, horizontal, vertical, triangle, arc. */
  strokes: [number, number, number, number, number];
  glow: number;
  flash: number;
  /** Warm light inside the trailer. */
  interior: number;
  /** The brand cube's path out of the trailer, and its spin through the faces. */
  cube: number;
  spin: number;
  cam: { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number };
  /** Handheld camera drift in metres. */
  shake: number;
  /** Background blur of the last shot. */
  dof: number;
  /** Idle loop once the intro is over. */
  calm: number;
  /** After signing in: the truck pulls away. */
  leave: number;
};

export const shotCam = ({ position: [x, y, z], target: [tx, ty, tz], fov }: Shot) => ({ x, y, z, tx, ty, tz, fov });

export function createRig(layout: Layout): Rig {
  return {
    layout, speed: TRUCK.cruiseSpeed, distance: 0, brake: 0, pitch: 0, doors: 0,
    strokes: [0, 0, 0, 0, 0], glow: 0, flash: 0, interior: 0, cube: 0, spin: 0,
    cam: shotCam(SHOTS[layout].persecucion), shake: HANDHELD.chase, dof: 0, calm: 0, leave: 0,
  };
}

/** Where the cube is along its way out: a curve from inside the trailer to its resting place. */
export function cubePosition(rig: Rig, out: [number, number, number]) {
  const t = rig.cube;
  const start = [0, 2.05, -0.95], mid = [0, 2.55, 1.9], end = CUBE_REST[rig.layout];
  for (let i = 0; i < 3; i++) out[i] = (1 - t) * (1 - t) * start[i] + 2 * t * (1 - t) * mid[i] + t * t * end[i];
  return out;
}

type Hooks = { onPanel: () => void; onComplete: () => void };

/**
 * The whole intro on one timeline, chapters as labels. The short version for
 * returning visitors is the same timeline started at «logo» and played faster.
 */
export function buildIntro(rig: Rig, hooks: Hooks) {
  const shots = SHOTS[rig.layout];
  const T = TIMING;
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' }, onComplete: hooks.onComplete });
  tl.addLabel('persecucion', T.persecucion).addLabel('frenada', T.frenada).addLabel('logo', T.logo)
    .addLabel('puertas', T.puertas).addLabel('panel', T.panel).addLabel('final', T.final);

  // Starting state, so seeking anywhere (or replaying) always lands right.
  tl.set(rig, { speed: TRUCK.cruiseSpeed, brake: 0, pitch: 0, doors: 0, glow: 0, flash: 0, interior: 0, cube: 0, spin: 0, shake: HANDHELD.chase, dof: 0, calm: 0, leave: 0 }, 0);
  tl.set(rig.strokes, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, 0);
  tl.set(rig.cam, shotCam(shots.persecucion), 0);

  // 1 · Low, three-quarters behind the truck, creeping in towards the doors.
  const chase = shotCam(shots.persecucion);
  tl.to(rig.cam, { x: chase.x - 0.9, y: chase.y + 0.1, z: chase.z - 1.6, duration: T.frenada - T.persecucion, ease: 'none' }, 'persecucion');

  // 2 · Braking: lights, nose down, the road slows to a stop while the camera closes in on the doors.
  const braking = T.logo - T.frenada;
  tl.to(rig, { speed: 0, duration: braking, ease: 'power2.out' }, 'frenada');
  tl.to(rig, { brake: 1, duration: 0.18, ease: 'power1.out' }, 'frenada');
  tl.to(rig, { pitch: 1, duration: braking * 0.6, ease: 'power2.out' }, 'frenada');
  tl.to(rig, { pitch: 0, duration: 1, ease: 'elastic.out(1, 0.45)' }, `frenada+=${braking * 0.85}`);
  tl.to(rig.cam, { ...shotCam(shots.frenada), duration: braking + 0.1 }, 'frenada');
  tl.to(rig, { shake: HANDHELD.still, duration: braking }, 'frenada');
  tl.to(rig, { brake: 0.3, duration: 0.8 }, 'logo+=0.6');

  // 3 · The emblem lights up stroke by stroke, then flashes once.
  rig.strokes.forEach((_, i) => tl.to(rig.strokes, { [i]: 1, duration: 0.3, ease: 'power2.out' }, `logo+=${i * T.trazo}`));
  tl.to(rig, { glow: 1, duration: 0.25, ease: 'power1.out' }, 'logo');
  const flashAt = 4 * T.trazo + 0.3;
  tl.to(rig, { flash: 1, duration: 0.08, ease: 'power2.out' }, `logo+=${flashAt}`);
  tl.to(rig, { flash: 0, duration: 0.7, ease: 'power2.in' }, `logo+=${flashAt + 0.08}`);

  // 4 · Doors swing open with a damped bounce, warm light inside, the cube floats out.
  tl.to(rig, { doors: 1, duration: 1.1, ease: 'back.out(1.5)' }, 'puertas');
  tl.to(rig, { interior: 1, duration: 0.7, ease: 'power1.inOut' }, 'puertas+=0.12');
  tl.to(rig, { cube: 1, duration: 1.45, ease: 'power2.inOut' }, 'puertas+=0.35');
  tl.to(rig, { spin: 1, duration: 1.45, ease: 'power3.out' }, 'puertas+=0.35');
  tl.to(rig.cam, { ...shotCam(shots.puertas), duration: T.panel - T.puertas }, 'puertas');

  // 5 · Truck and cube to one side, the panel arrives, the background softens.
  tl.to(rig.cam, { ...shotCam(shots.final), duration: T.final - T.panel + 0.2 }, 'panel');
  tl.call(() => hooks.onPanel(), [], 'panel+=0.3');
  tl.to(rig, { dof: 1, duration: 0.9, ease: 'power1.inOut' }, 'panel+=0.3');
  tl.to(rig, { calm: 1, duration: 0.6, ease: 'power1.inOut' }, `final-=0.4`);
  return tl;
}

/** Last frame of the intro, for reduced motion, the skip button and window resizes. */
export function finalState(rig: Rig) {
  Object.assign(rig, { speed: 0, brake: 0.3, pitch: 0, doors: 1, glow: 1, flash: 0, interior: 1, cube: 1, spin: 1, shake: HANDHELD.still, dof: 1, calm: 1, leave: 0 });
  rig.strokes.fill(1);
  Object.assign(rig.cam, shotCam(SHOTS[rig.layout].final));
}

export function setLayout(rig: Rig, layout: Layout) {
  rig.layout = layout;
}

/** Puts the camera on the last shot for the current layout. */
export function frameFinal(rig: Rig) {
  Object.assign(rig.cam, shotCam(SHOTS[rig.layout].final));
}

/** After a successful sign-in: cube back in, doors shut, the truck drives off. */
export function buildExit(rig: Rig) {
  const d = TIMING.salida;
  const tl = gsap.timeline({ defaults: { ease: 'power2.in' } });
  tl.to(rig, { cube: 0, spin: 0.6, duration: d * 0.35 }, 0);
  tl.to(rig, { doors: 0, duration: d * 0.45 }, d * 0.12);
  tl.to(rig, { interior: 0, dof: 0, calm: 0, duration: d * 0.4 }, d * 0.12);
  tl.to(rig, { brake: 0, glow: 0.35, duration: d * 0.25, ease: 'power1.out' }, d * 0.35);
  tl.to(rig, { leave: 1, duration: d * 0.62 }, d * 0.38);
  return tl;
}
