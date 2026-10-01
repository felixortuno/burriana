'use client';
import { ContactShadows, Environment, PerformanceMonitor, Preload } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import type gsap from 'gsap';
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing';
import { lazy, Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { DirectionalLight, HalfFloatType, Vector3, type PerspectiveCamera } from 'three';
import { ASSETS, LIGHTS, QUALITY, SKY, TIMING, type Layout, type Tier } from './config';
import { buildExit, buildIntro, createRig, finalState, frameFinal, setLayout, type Rig } from './intro-timeline';
import LogoCube from './logo-cube';
import Road from './road';
import { loadBrandFonts } from './textures';
import Truck from './truck';

const DebugPanel = lazy(() => import('./debug-panel'));

export type SceneApi = {
  /** Jumps straight to the last shot. */
  skip: () => void;
  /** Doors close and the truck pulls away; resolves when it is gone. */
  exit: () => Promise<void>;
};

export type SceneProps = {
  /** Starts the intro; true once the loading screen has gone. */
  play: boolean;
  /** Returning visitors get the last chapters only, faster. */
  short: boolean;
  /** Reduced motion: the final shot, still. */
  still: boolean;
  /** Tab hidden: stop rendering. */
  paused: boolean;
  debug: boolean;
  initialTier: Tier;
  /** How far PerformanceMonitor may raise the quality (phones stop at 2). */
  maxTier: Tier;
  apiRef: RefObject<SceneApi | null>;
  onReady: () => void;
  onPanel: () => void;
  onDone: () => void;
  onFallback: () => void;
};

type Mode = 'intro' | 'calm' | 'still' | 'exit';

const layoutFor = (width: number, height: number): Layout => (width / Math.max(1, height) < 0.85 ? 'alto' : 'ancho');
// Focus between the doors and the cube, so both stay sharp.
const SUBJECT = new Vector3(1, 2.7, 1.2);

const lookAt = new Vector3();
/** Places the camera from the rig, with a slight handheld drift and road vibration while moving. */
function aim(camera: PerspectiveCamera, rig: Rig, time: number, still: boolean) {
  const a = still ? 0 : rig.shake;
  const wave = (f: number, p: number) => Math.sin(time * f + p);
  const x = a * (0.6 * wave(0.83, 0) + 0.3 * wave(1.91, 1.3) + 0.1 * wave(4.7, 2.1));
  const y = a * 0.7 * (0.6 * wave(0.71, 2) + 0.3 * wave(2.3, 0.4) + 0.1 * wave(5.3, 1)) + (still ? 0 : (rig.speed / 22) * 0.006 * wave(23, 0));
  camera.position.set(rig.cam.x + x, rig.cam.y + y, rig.cam.z);
  camera.lookAt(lookAt.set(rig.cam.tx + x * 0.4, rig.cam.ty + y * 0.4, rig.cam.tz));
  if (Math.abs(camera.fov - rig.cam.fov) > 0.001) { camera.fov = rig.cam.fov; camera.updateProjectionMatrix(); }
}

function CameraRig({ rig, still }: { rig: Rig; still: boolean }) {
  useFrame(state => aim(state.camera as PerspectiveCamera, rig, state.clock.elapsedTime, still), -1);
  return null;
}

function moonLight() {
  const light = new DirectionalLight(LIGHTS.moon, 0.85);
  light.position.set(10, 13, 3);
  light.target.position.set(0, 0, -7.5);
  Object.assign(light.shadow.camera, { left: -9, right: 9, top: 13, bottom: -13, near: 2, far: 45 });
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.03;
  return light;
}

/** 0 turns the shadow off; a new size rebuilds the shadow map. */
function shadowSize(light: DirectionalLight, size: number) {
  light.castShadow = size > 0;
  if (size > 0 && light.shadow.mapSize.x !== size) {
    light.shadow.mapSize.set(size, size);
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }
}

/** Cold light from behind and above; its shadow only covers the truck. */
function Moon({ size }: { size: number }) {
  const light = useMemo(() => moonLight(), []);
  useEffect(() => shadowSize(light, size), [light, size]);
  return <><primitive object={light} /><primitive object={light.target} /></>;
}

/** Focus on the doors; the blur only grows in the last shot. */
function focus(effect: DepthOfFieldEffect | null, rig: Rig, camera: PerspectiveCamera) {
  if (!effect) return;
  effect.bokehScale = rig.dof * 3.4;
  effect.cocMaterial.focusDistance = camera.position.distanceTo(SUBJECT);
  effect.cocMaterial.focusRange = 6;
}

function Effects({ rig, tier }: { rig: Rig; tier: Tier }) {
  const quality = QUALITY[tier];
  const dof = useRef<DepthOfFieldEffect>(null);
  // Mounted only once the blur is wanted: idle, its passes would still cost ~10 fps.
  const [blurring, setBlurring] = useState(false);
  useFrame(state => {
    if ((rig.dof > 0) !== blurring) setBlurring(rig.dof > 0);
    focus(dof.current, rig, state.camera as PerspectiveCamera);
  });
  if (tier === 0) return null;
  const effects = [
    quality.dof && blurring && <DepthOfField key="dof" ref={dof} focusDistance={10} focusRange={6} bokehScale={0} resolutionScale={0.5} />,
    quality.bloom && <Bloom key="bloom" mipmapBlur intensity={0.85} luminanceThreshold={1} luminanceSmoothing={0.2} radius={0.72} />,
    <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
    <Vignette key="vignette" offset={0.28} darkness={0.62} />,
    <Noise key="grain" opacity={0.05} blendFunction={BlendFunction.OVERLAY} />,
    quality.smaa && <SMAA key="smaa" />,
  ].filter(Boolean) as ReactElement[];
  return <EffectComposer multisampling={0} frameBufferType={HalfFloatType}>{effects}</EffectComposer>;
}

/** Fires once everything inside Suspense has loaded and drawn twice. */
function Ready({ onReady }: { onReady: () => void }) {
  const invalidate = useThree(state => state.invalidate);
  const frames = useRef(0);
  useEffect(() => { invalidate(); }, [invalidate]);
  useFrame(() => {
    if (frames.current > 2) return;
    frames.current += 1;
    if (frames.current === 2) onReady();
    else invalidate();
  });
  return null;
}

/** In the calm loop the scene only needs 30 frames a second. */
function Pacer({ fps }: { fps: number }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    if (!fps) return;
    const timer = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [fps, invalidate]);
  return null;
}

/** Keeps the camera framing right when the window changes between wide and tall. */
function LayoutWatcher({ rig, onChange }: { rig: Rig; onChange: (layout: Layout) => void }) {
  const size = useThree(state => state.size);
  const layout = layoutFor(size.width, size.height);
  useEffect(() => { if (layout !== rig.layout) onChange(layout); }, [layout, rig, onChange]);
  return null;
}

/** ?debug=1: the three.js scene on window, for scripted checks. */
function DebugBridge() {
  const { scene, gl, camera } = useThree();
  useEffect(() => {
    const target = window as unknown as { __three?: unknown };
    target.__three = { scene, gl, camera };
    return () => { delete target.__three; };
  }, [scene, gl, camera]);
  return null;
}

function Fonts() {
  use(loadBrandFonts());
  return null;
}

export default function LoginScene({ play, short, still, paused, debug, initialTier, maxTier, apiRef, onReady, onPanel, onDone, onFallback }: SceneProps) {
  const [rig] = useState(() => createRig(typeof window === 'undefined' ? 'ancho' : layoutFor(window.innerWidth, window.innerHeight)));
  const [tier, setTier] = useState<Tier>(initialTier);
  const [mode, setMode] = useState<Mode>(still ? 'still' : 'intro');
  const [detail] = useState(maxTier >= 3 ? 'alta' as const : 'baja' as const);
  const intro = useRef<gsap.core.Timeline | null>(null);
  const callbacks = useRef({ onPanel, onDone });
  useEffect(() => { callbacks.current = { onPanel, onDone }; }, [onPanel, onDone]);

  const finish = useCallback(() => {
    setMode(current => (current === 'intro' ? 'calm' : current));
    callbacks.current.onDone();
  }, []);

  const build = useCallback(() => {
    intro.current?.kill();
    intro.current = buildIntro(rig, { onPanel: () => callbacks.current.onPanel(), onComplete: finish });
    return intro.current;
  }, [rig, finish]);

  // Reduced motion: the final frame, nothing moves. Otherwise the timeline waits
  // (already at its first frame) for the loading screen to leave.
  useEffect(() => {
    if (still) { finalState(rig); return; }
    const timeline = build();
    if (short) timeline.seek('logo', true);
    return () => { timeline.kill(); };
  }, [still, short, rig, build]);

  useEffect(() => {
    const timeline = intro.current;
    if (!play || still || !timeline || mode !== 'intro') return;
    timeline.timeScale(short ? TIMING.cortaVelocidad : 1).play();
  }, [play, still, short, mode]);

  useEffect(() => {
    apiRef.current = {
      skip() {
        if (mode === 'exit') return;
        intro.current?.progress(1, true);
        intro.current?.kill();
        finalState(rig);
        callbacks.current.onPanel();
        finish();
      },
      exit() {
        intro.current?.kill();
        setMode('exit');
        return new Promise(resolve => { buildExit(rig).eventCallback('onComplete', () => resolve()); });
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, rig, finish, mode]);

  /** Debug replays render every frame again, like the real intro. */
  const replay = useCallback(() => { setMode('intro'); return build(); }, [build]);

  const relayout = useCallback((layout: Layout) => {
    setLayout(rig, layout);
    const timeline = intro.current;
    if (mode === 'intro' && timeline && !still) {
      // Rebuild for the new framing and carry on from the same moment.
      const time = timeline.time(), playing = timeline.isActive();
      const next = build();
      next.time(time, true);
      next.timeScale(short ? TIMING.cortaVelocidad : 1);
      if (playing) next.play();
    } else {
      frameFinal(rig);
    }
  }, [rig, mode, still, short, build]);

  const quality = QUALITY[tier];
  const frameloop = paused ? 'never' : mode === 'intro' || mode === 'exit' ? 'always' : 'demand';

  return <>
    <Canvas
      className="login-canvas"
      dpr={[1, quality.dpr]}
      shadows
      frameloop={frameloop}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: rig.cam.fov, near: 0.1, far: 700, position: [rig.cam.x, rig.cam.y, rig.cam.z] }}
      style={{ pointerEvents: 'none' }}
    >
      <color attach="background" args={[SKY.fog]} />
      <fog attach="fog" args={[SKY.fog, SKY.fogNear, SKY.fogFar]} />
      {mode === 'intro' && !debug && <PerformanceMonitor
        flipflops={3}
        // Desktops aim for 60 fps (climb above 58.5, drop under 50); phones settle for 30.
        bounds={refresh => (refresh > 90 ? [50, 90] : [maxTier >= 3 ? 50 : 28, 58.5])}
        onDecline={() => setTier(current => {
          if (current === 0) { onFallback(); return current; }
          return (current - 1) as Tier;
        })}
        onIncline={() => setTier(current => (current < maxTier ? (current + 1) as Tier : current))}
        onFallback={() => setTier(current => { if (current <= 1) onFallback(); return current; })}
      />}
      {debug && <DebugBridge />}
      <CameraRig rig={rig} still={mode === 'still'} />
      <LayoutWatcher rig={rig} onChange={relayout} />
      <Pacer fps={mode === 'calm' && !paused ? 30 : 0} />
      <hemisphereLight args={['#5b6aa0', '#16161a', 0.35]} />
      <Moon size={quality.shadows} />
      <Suspense fallback={null}>
        <Fonts />
        <Environment files={ASSETS.hdri} environmentIntensity={LIGHTS.environmentIntensity} environmentRotation={[0, Math.PI * 0.75, 0]} />
        <Road rig={rig} reflector={quality.reflector} shadows={quality.shadows > 0} />
        <Truck rig={rig} detail={detail} />
        <ContactShadows position={[0, 0.014, -8.6]} scale={[3.3, 19.6]} far={1.4} blur={2.2} opacity={0.8} resolution={512} frames={1} color="#000000" />
        <LogoCube rig={rig} />
        <Effects rig={rig} tier={tier} />
        <Preload all />
        <Ready onReady={onReady} />
      </Suspense>
    </Canvas>
    {debug && <Suspense fallback={null}>
      <DebugPanel rig={rig} timeline={intro} rebuild={replay} tier={tier} setTier={setTier} />
    </Suspense>}
  </>;
}
