'use client';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import CuboLoader from './cubo-loader';

type Registry = { hold: () => () => void };
const LoadingContext = createContext<Registry | null>(null);
const RevealedContext = createContext(true);

/**
 * Keeps the loading screen up while the page still has work in flight.
 * Call it with false while loading and true when done; pages without data
 * don't need it. Only the first load of the document shows the screen.
 */
export function useAppReady(isReady: boolean) {
  const registry = useContext(LoadingContext);
  useEffect(() => {
    if (!registry || isReady) return;
    return registry.hold();
  }, [registry, isReady]);
}

/** True once the loading screen has started to fade and the page can be seen. */
export function useAppRevealed() {
  return useContext(RevealedContext);
}

/**
 * Full-screen cube shown from the server-rendered HTML until fonts, session and
 * the page's own data are ready. The page renders underneath, inert, so it is
 * already in place when the screen fades away.
 */
export default function AppLoader({ children }: { children: ReactNode }) {
  const holds = useRef(new Set<symbol>());
  const fontsLoaded = useRef(false);
  // The sign-in page is its own loading screen (the truck, plain HTML and CSS), so no cube there.
  const [bare] = useState(usePathname() === '/login');
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(bare);
  const [finished, setFinished] = useState(bare);
  const settle = useCallback(() => {
    if (fontsLoaded.current && holds.current.size === 0) setReady(true);
  }, []);
  const registry = useMemo<Registry>(() => ({
    hold() {
      const token = Symbol('carga');
      holds.current.add(token);
      return () => { holds.current.delete(token); settle(); };
    },
  }), [settle]);

  // Child effects run first, so any page that is still loading has already
  // registered its hold by the time this checks.
  useEffect(() => {
    let active = true;
    document.fonts.ready.then(() => { if (active) { fontsLoaded.current = true; settle(); } });
    return () => { active = false; };
  }, [settle]);

  const reveal = useCallback(() => setRevealed(true), []);
  const finish = useCallback(() => setFinished(true), []);

  return <LoadingContext.Provider value={finished ? null : registry}>
    <RevealedContext.Provider value={revealed}>
      <div className="app-root" inert={!revealed}>{children}</div>
    </RevealedContext.Provider>
    {!finished && <div className={'tm-pantalla tm-tema' + (revealed ? ' revelando' : '')}>
      <div className="tm-pantalla-fondo"/>
      <CuboLoader size={112} ready={ready} onReveal={reveal} onFinish={finish}/>
    </div>}
    <noscript><style>{'.tm-pantalla{display:none}'}</style></noscript>
  </LoadingContext.Provider>;
}
