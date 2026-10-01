'use client';
import type gsap from 'gsap';
import { button, folder, Leva, useControls } from 'leva';
import { useEffect, type RefObject } from 'react';
import { QUALITY, SHOTS, TIMING, type Shot, type Tier, type Vec3 } from './config';
import { finalState, shotCam, type Rig } from './intro-timeline';

type Props = {
  rig: Rig;
  timeline: RefObject<gsap.core.Timeline | null>;
  rebuild: () => gsap.core.Timeline;
  tier: Tier;
  setTier: (tier: Tier) => void;
};

const SHOT_NAMES = ['persecucion', 'frenada', 'puertas', 'final'] as const;
const vec = ([x, y, z]: Vec3) => ({ x, y, z });
const arr = ({ x, y, z }: { x: number; y: number; z: number }): Vec3 => [x, y, z];

/**
 * /login?debug=1: leva controls for timings and camera shots. Changes rebuild the
 * timeline and keep the current moment; they live in memory only, copy the
 * values you like into config.ts.
 */
export default function DebugPanel({ rig, timeline, rebuild, tier, setTier }: Props) {
  const restart = (at = 0) => {
    const next = rebuild();
    next.time(at, true).timeScale(1).play();
  };

  useControls('Reproducción', () => ({
    'Completa': button(() => restart(0)),
    'Versión corta': button(() => { const next = rebuild(); next.seek('logo', true).timeScale(TIMING.cortaVelocidad).play(); }),
    'Pausa / sigue': button(() => { const current = timeline.current; if (current) current.paused(!current.paused()); }),
    'Plano final': button(() => { timeline.current?.kill(); finalState(rig); }),
    tiempo: { value: 0, min: 0, max: TIMING.final, step: 0.05, onChange: (value: number, _path: string, context: { initial: boolean }) => {
      if (context.initial) return;
      const current = timeline.current ?? rebuild();
      current.pause().time(value, true);
    }, transient: true },
  }), [rig, rebuild]);

  const [timings] = useControls('Tiempos (s)', () => ({
    frenada: { value: TIMING.frenada, min: 0.5, max: 6, step: 0.05 },
    logo: { value: TIMING.logo, min: 1, max: 7, step: 0.05 },
    puertas: { value: TIMING.puertas, min: 2, max: 8, step: 0.05 },
    panel: { value: TIMING.panel, min: 3, max: 9, step: 0.05 },
    final: { value: TIMING.final, min: 4, max: 10, step: 0.05 },
    trazo: { value: TIMING.trazo, min: 0.02, max: 0.4, step: 0.01 },
  }));

  const layout = rig.layout;
  const [camera] = useControls(`Cámara (${layout})`, () => Object.fromEntries(SHOT_NAMES.map(name => [name, folder({
    [`${name}.posición`]: { value: vec(SHOTS[layout][name].position), step: 0.05 },
    [`${name}.mira a`]: { value: vec(SHOTS[layout][name].target), step: 0.05 },
    [`${name}.fov`]: { value: SHOTS[layout][name].fov, min: 20, max: 60, step: 0.5 },
  })])), [layout]);

  useControls('Calidad', () => ({
    nivel: { value: tier, options: { 'Alta (3)': 3, 'Media (2)': 2, 'Baja (1)': 1, 'Mínima (0)': 0 }, onChange: (value: Tier) => setTier(value) },
  }));

  // Write the values back into the shared config and rebuild from the same moment.
  useEffect(() => {
    Object.assign(TIMING, timings);
    for (const name of SHOT_NAMES) {
      const values = camera as Record<string, { x: number; y: number; z: number } | number>;
      const shot: Shot = {
        position: arr(values[`${name}.posición`] as { x: number; y: number; z: number }),
        target: arr(values[`${name}.mira a`] as { x: number; y: number; z: number }),
        fov: values[`${name}.fov`] as number,
      };
      SHOTS[layout][name] = shot;
    }
    const current = timeline.current;
    if (!current) return;
    const time = current.time(), paused = current.paused();
    const next = rebuild();
    next.time(time, true);
    if (!paused && time < TIMING.final) next.play();
    else if (time >= TIMING.final) Object.assign(rig.cam, shotCam(SHOTS[layout].final));
  }, [timings, camera, layout, rebuild, rig, timeline]);

  // Handle for scripted screenshots and fps runs.
  useEffect(() => {
    const handle = { rig, timeline: () => timeline.current, rebuild, finalState: () => finalState(rig), setTier, quality: QUALITY };
    (window as unknown as { __escena?: typeof handle }).__escena = handle;
    return () => { delete (window as unknown as { __escena?: typeof handle }).__escena; };
  }, [rig, timeline, rebuild, setTier]);

  // &leva=0 hides the panel for clean screenshots; the controls still work.
  const hidden = new URLSearchParams(window.location.search).get('leva') === '0';
  return <Leva hidden={hidden} collapsed={false} titleBar={{ title: 'Escena de acceso' }} />;
}
