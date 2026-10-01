'use client';
import { ChevronsRight } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useAppReady, useAppRevealed } from '../components/app-loader';
import AuthPanel from './auth-panel';
import { ASSETS, INTRO_SEEN_KEY, TIMING, type Tier } from './escena/config';
import type { SceneApi } from './escena/login-scene';
import './login.css';

// three.js, the scene and GSAP load in their own chunk, after the page is up.
const LoginScene = dynamic(() => import('./escena/login-scene'), { ssr: false });

type Setup = {
  /** «escena» renders the 3D intro; «imagen» shows the still behind the form. */
  view: 'escena' | 'imagen';
  still: boolean;
  short: boolean;
  tier: Tier;
  maxTier: Tier;
  debug: boolean;
};

const SCENE_TIMEOUT_MS = 12_000;

/** If the 3D scene throws, the still image takes its place; the form never goes with it. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

const seen = () => { try { return window.localStorage.getItem(INTRO_SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { window.localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* private mode */ } };

/** What this device can afford: WebGL at all, then a starting quality level. */
function detect(): Setup {
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1';
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const cores = nav.hardwareConcurrency || 4, memory = nav.deviceMemory ?? 8;
  const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;

  let webgl = false;
  try {
    const probe = document.createElement('canvas');
    // A software renderer counts as "very slow": better the still image than 5 fps.
    const context = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: !debug }) ?? probe.getContext('webgl', { failIfMajorPerformanceCaveat: !debug });
    webgl = !!context;
    (context as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }

  const slow = cores <= 2 || memory <= 1 || nav.connection?.saveData === true;
  // Start one step low and let PerformanceMonitor climb: a dropped first second looks worse than a sharper one.
  const tier: Tier = phone ? (memory <= 3 || cores <= 4 ? 1 : 2) : cores <= 4 ? 1 : 2;
  const maxTier: Tier = phone ? 2 : 3;
  return { view: webgl && (!slow || debug) ? 'escena' : 'imagen', still, short: seen() && !debug, tier, maxTier, debug };
}

export default function LoginExperience() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);
  const scene = useRef<SceneApi | null>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const revealed = useAppRevealed();

  // eslint-disable-next-line react-hooks/set-state-in-effect -- needs window, so it runs after hydration
  useEffect(() => { setSetup(detect()); }, []);

  const view = setup?.view;
  // The cube loader stays until the scene has drawn its first frames (or we gave up on it).
  useAppReady(view === 'imagen' || ready);

  useEffect(() => {
    if (view !== 'escena' || ready) return;
    const timer = window.setTimeout(() => setSetup(current => current && { ...current, view: 'imagen' }), SCENE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [view, ready]);

  // Without the intro the form is there from the start.
  const instant = view === 'imagen' || setup?.still === true;
  const showPanel = panel || instant;

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const focusForm = useCallback(() => {
    // Phones would raise the keyboard over the scene; let people tap the field themselves.
    if (window.matchMedia('(pointer: coarse)').matches) return;
    requestAnimationFrame(() => userRef.current?.focus({ preventScroll: true }));
  }, []);

  const onPanel = useCallback(() => { markSeen(); setPanel(true); focusForm(); }, [focusForm]);
  const onDone = useCallback(() => markSeen(), []);
  const onFallback = useCallback(() => setSetup(current => current && { ...current, view: 'imagen' }), []);

  const skip = useCallback(() => {
    markSeen();
    scene.current?.skip();
    setPanel(true);
  }, []);

  // Any key during the intro jumps to the form; typing goes straight into «Usuario».
  useEffect(() => {
    if (showPanel || view !== 'escena') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The panel must stop being inert before the focus moves, or the first letter is lost.
      flushSync(skip);
      // A letter goes on into the field; Tab, Enter, Space and the rest only move there.
      if (event.key.length !== 1 || event.key === ' ') event.preventDefault();
      userRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPanel, view, skip]);

  /**
   * Doors shut, truck leaves, page fades: never more than TIMING.salida before the
   * redirect. Without the animated scene there is only the fade, so a short wait.
   */
  const beforeRedirect = useCallback(async () => {
    setLeaving(true);
    const animated = view === 'escena' && !setup?.still && scene.current;
    const cap = new Promise<void>(resolve => window.setTimeout(resolve, animated ? TIMING.salida * 1000 : 200));
    await Promise.race([animated ? scene.current!.exit() : cap, cap]);
  }, [view, setup?.still]);

  return <main className={'login' + (leaving ? ' saliendo' : '')}>
    <div className="login-stage" aria-hidden="true">
      {view === 'imagen' && <picture className="login-still">
        <source media="(max-aspect-ratio: 17/20)" srcSet={ASSETS.fallback.tall} />
        <img src={ASSETS.fallback.wide} alt="" decoding="async" />
      </picture>}
      {view === 'escena' && setup && <SceneBoundary onError={onFallback}><LoginScene
        play={revealed && ready}
        short={setup.short}
        still={setup.still}
        paused={hidden}
        debug={setup.debug}
        initialTier={setup.tier}
        maxTier={setup.maxTier}
        apiRef={scene}
        onReady={() => setReady(true)}
        onPanel={onPanel}
        onDone={onDone}
        onFallback={onFallback}
      /></SceneBoundary>}
    </div>

    {view === 'escena' && !instant && !showPanel && <button type="button" className="login-skip" onClick={() => { skip(); focusForm(); }}>
      Saltar intro <ChevronsRight size={16} aria-hidden="true" />
    </button>}

    <div className="login-layer">
      <AuthPanel visible={!!setup && showPanel} userRef={userRef} beforeRedirect={beforeRedirect} />
    </div>
    <div className="login-fade" aria-hidden="true" />
  </main>;
}
