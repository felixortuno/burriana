/**
 * Everything that sets the look and the timing of the sign-in scene.
 * Units are metres and seconds. The truck's rear doors sit at z = 0 and it
 * drives towards -z; the road moves under it instead of the truck moving.
 */

export const BRAND = {
  negro: '#1C1C1A',
  lima: '#D9E33B',
  azul: '#2C49A6',
  naranja: '#EE7B47',
  turquesa: '#4DB9A8',
  carton: '#B07A3B',
  fondoCarga: '#141413',
} as const;

/** Blue hour: deep blue above, a warm band left on the horizon ahead. */
export const SKY = {
  zenith: '#0a1430',
  middle: '#1f2f62',
  horizon: '#6b6a8f',
  glow: '#e0936c',
  fog: '#3f4670',
  fogNear: 24,
  fogFar: 210,
  ground: '#11141c',
} as const;

export const LIGHTS = {
  moon: '#9fb2ff',
  sodium: '#ffac55',
  interior: '#ffbf7a',
  brake: '#ff2a1a',
  environmentIntensity: 0.55,
} as const;

/** Paths are public without a session: the proxy lets /brand/ through. */
export const ASSETS = {
  hdri: '/brand/escena/cielo-hora-azul-1k.hdr',
  asphalt: {
    color: '/brand/escena/asfalto-color.webp',
    normal: '/brand/escena/asfalto-normal.webp',
    roughness: '/brand/escena/asfalto-rugosidad.webp',
  },
  /** Stills of the last shot, for devices without WebGL. */
  fallback: { wide: '/brand/escena/final-1920x1080.webp', tall: '/brand/escena/final-1080x1920.webp' },
  /**
   * Drop a semi-trailer at this path to replace the procedural one (see truck.tsx).
   * Left empty on purpose: there is no model in public/models/ yet.
   */
  truckModel: '',
} as const;

export const TRUCK = {
  /** Box semi-trailer. */
  length: 13.6,
  width: 2.55,
  floor: 1.22,
  boxHeight: 2.74,
  wheelRadius: 0.54,
  /** Rear doors open to this many degrees, then settle. */
  doorAngle: 106,
  cruiseSpeed: 22, // m/s, about 80 km/h
} as const;

/** The intro, in seconds. Labels are the scene's chapters. */
export const TIMING = {
  persecucion: 0,
  frenada: 2.5,
  logo: 4,
  puertas: 5.5,
  panel: 7,
  final: 8,
  /** Delay between the emblem strokes lighting up. */
  trazo: 0.12,
  /** The short version for people who have already seen it. */
  cortaVelocidad: 2,
  /** Doors close and the truck leaves after signing in; the redirect waits at most this long (under 600 ms). */
  salida: 0.56,
};

export type Vec3 = [number, number, number];
export type Shot = { position: Vec3; target: Vec3; fov: number };
export type Layout = 'ancho' | 'alto';

/**
 * Camera shots. «ancho» leaves the right side free for the panel; «alto» (phones)
 * keeps the truck in the upper half, above the bottom sheet.
 */
export const SHOTS: Record<Layout, Record<'persecucion' | 'frenada' | 'puertas' | 'final', Shot>> = {
  ancho: {
    persecucion: { position: [3.9, 1.2, 10.5], target: [0.2, 2.0, -6], fov: 38 },
    frenada: { position: [0.2, 2.15, 6.4], target: [0, 2.55, 0], fov: 37 },
    puertas: { position: [1.4, 2.3, 8.6], target: [0.5, 2.5, 0], fov: 38 },
    final: { position: [4.4, 2.0, 12.2], target: [3.3, 2.4, -1.5], fov: 38 },
  },
  alto: {
    persecucion: { position: [1.9, 1.5, 19.5], target: [0.2, 1.9, -6], fov: 40 },
    frenada: { position: [0.1, 2.4, 10.8], target: [0, 2.3, 0], fov: 40 },
    puertas: { position: [0.6, 2.4, 15.5], target: [0.15, 1.3, 0], fov: 40 },
    final: { position: [0.9, 2.3, 19.5], target: [0.35, -0.55, 0], fov: 40 },
  },
};

/** Where the brand cube ends up next to the open doors. */
export const CUBE_REST: Record<Layout, Vec3> = {
  ancho: [2.15, 2.95, 2.3],
  alto: [1.05, 3.45, 2.0],
};

/** Handheld camera: metres of drift, larger while chasing the truck. */
export const HANDHELD = { chase: 0.05, still: 0.014 };

export type Tier = 0 | 1 | 2 | 3;

/**
 * Quality steps that PerformanceMonitor moves between. Desktops start at 2 and
 * climb to 3 when frames are to spare; phones start at 2 or 1 and never pass
 * DPR 1.5. 1 and 0 strip reflections, shadows and post-processing. The depth of
 * field only runs in the last shot, where the scene drops to 30 fps anyway.
 */
export const QUALITY: Record<Tier, { dpr: number; shadows: number; reflector: number; bloom: boolean; dof: boolean; smaa: boolean }> = {
  3: { dpr: 1.75, shadows: 2048, reflector: 512, bloom: true, dof: true, smaa: true },
  2: { dpr: 1.5, shadows: 1024, reflector: 512, bloom: true, dof: true, smaa: true },
  1: { dpr: 1.25, shadows: 0, reflector: 256, bloom: true, dof: false, smaa: false },
  0: { dpr: 1, shadows: 0, reflector: 0, bloom: false, dof: false, smaa: false },
};

export const INTRO_SEEN_KEY = 'tm-intro-vista';
export const REMEMBER_USER_KEY = 'tm-usuario-recordado';
