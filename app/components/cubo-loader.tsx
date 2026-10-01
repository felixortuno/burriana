'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import { EmblemShapes, useClipId } from './logo';
import './cubo-loader.css';

type Props = {
  /** Cube edge in CSS pixels; everything else scales with it. */
  size?: number;
  /** True once the real loading (session, data, fonts) has finished. */
  ready?: boolean;
  /** Fires when the exit reaches the point where the app should start fading in. */
  onReveal?: () => void;
  /** Fires when the exit animation has ended. */
  onFinish?: () => void;
  /** Where the emblem flies on exit; it simply fades when nothing visible matches. */
  target?: string;
  /** Forces a theme; by default it follows the system. */
  tema?: 'auto' | 'claro' | 'oscuro';
};

const MIN_VISIBLE_MS = 1200;
const ease = 'cubic-bezier(0.65, 0, 0.35, 1)';

export default function CuboLoader({ size = 120, ready = false, onReveal, onFinish, target = '[data-logo-target]', tema = 'auto' }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(0);
  const callbacks = useRef({ onReveal, onFinish });
  useEffect(() => { callbacks.current = { onReveal, onFinish }; }, [onReveal, onFinish]);
  useEffect(() => { mountedAt.current = performance.now(); }, []);

  useEffect(() => {
    const element = root.current;
    if (!ready || !element) return;
    let cancelled = false;
    const pending: Animation[] = [];
    const run = (node: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      if (!node) return Promise.resolve();
      const animation = node.animate(keyframes, { fill: 'forwards', ...options });
      pending.push(animation);
      return animation.finished.then(() => undefined, () => undefined);
    };
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    (async () => {
      // Never cut the entrance short: the emblem and the cube build always finish,
      // and the loader stays at least MIN_VISIBLE_MS even if loading was instant.
      const entrance = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity);
      await Promise.all(entrance.map(animation => animation.finished.catch(() => undefined)));
      const shown = performance.now() - Math.min(mountedAt.current || performance.now(), ...entrance.map(animation => Number(animation.startTime ?? Infinity)));
      if (shown < MIN_VISIBLE_MS) await wait(MIN_VISIBLE_MS - shown);
      if (cancelled) return;

      if (reduced) {
        callbacks.current.onReveal?.();
        await run(element, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-out' });
        if (!cancelled) callbacks.current.onFinish?.();
        return;
      }

      const q = (selector: string) => element.querySelector(selector);
      const cube = q('.tm-cubo'), hop = q('.tm-salto'), shadow = q('.tm-sombra'), fly = q('.tm-vuelo') as HTMLElement | null;
      // Freeze the loop exactly where it is, then let the script take over.
      const pose = (node: Element | null) => node ? getComputedStyle(node).transform : 'none';
      const from = { cube: pose(cube), hop: pose(hop), shadow: pose(shadow) };
      element.dataset.fase = 'salida';

      // 1. A quick turn until the top face looks at the camera.
      const turn = run(cube, [{ transform: from.cube }, { transform: 'rotateX(-90deg) rotateY(0deg)' }], { duration: 420, easing: ease });
      run(hop, [{ transform: from.hop }, { transform: 'translateY(0)' }], { duration: 240, easing: ease });
      run(shadow, [{ transform: from.shadow, opacity: 1 }, { transform: 'scale(0.6)', opacity: 0 }], { duration: 300, easing: ease });
      run(q('.tm-puntos'), [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' });
      run(q('.tm-texto'), [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' });

      // 2. It flattens back into the emblem: the sides unfold and the black fades.
      await wait(220);
      const half = `${size / 2}px`;
      element.querySelectorAll('.tm-lado').forEach(face => {
        const ry = getComputedStyle(face).getPropertyValue('--ry').trim() || '0deg';
        run(face, [
          { transform: `rotateY(${ry}) translateZ(${half}) rotateX(0deg)`, opacity: 1 },
          { transform: `rotateY(${ry}) translateZ(${half}) rotateX(90deg)`, opacity: 0 },
        ], { duration: 260, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' });
      });
      run(q('.tm-arriba .tm-fondo'), [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in' });
      await turn;
      await wait(60);
      if (cancelled || !fly) return;

      // 3. The flat emblem flies into the header logo, or fades if none is visible.
      const emblem = q('.tm-arriba .tm-emblema')?.getBoundingClientRect();
      const goal = document.querySelector(target)?.getBoundingClientRect();
      const visible = goal && goal.width > 0 && goal.right > 0 && goal.bottom > 0 && goal.left < innerWidth && goal.top < innerHeight;
      callbacks.current.onReveal?.();
      if (emblem && goal && visible) {
        const box = fly.getBoundingClientRect();
        fly.style.transformOrigin = `${emblem.left + emblem.width / 2 - box.left}px ${emblem.top + emblem.height / 2 - box.top}px`;
        const dx = goal.left + goal.width / 2 - (emblem.left + emblem.width / 2);
        const dy = goal.top + goal.height / 2 - (emblem.top + emblem.height / 2);
        await run(fly, [{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${goal.width / emblem.width})` }], { duration: 500, easing: 'cubic-bezier(0.5, 0, 0.1, 1)' });
        await run(fly, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear' });
      } else {
        await run(fly, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.86)', opacity: 0 }], { duration: 500, easing: ease });
      }
      if (!cancelled) callbacks.current.onFinish?.();
    })();

    return () => { cancelled = true; pending.forEach(animation => animation.cancel()); };
  }, [ready, size, target]);

  return <div ref={root} className="tm-loader tm-tema" data-tema={tema === 'auto' ? undefined : tema} role="status" aria-label="Cargando" style={{ '--cubo-size': `${size}px` } as CSSProperties}>
    <div className="tm-vuelo"><CubeScene/></div>
    <div className="tm-puntos" aria-hidden="true"><i/><i/><i/><i/></div>
    <p className="tm-texto" aria-hidden="true"><span>Cargando</span></p>
  </div>;
}

/** The cube itself: one company per side, the emblem on top and bottom. */
function CubeScene() {
  const clipTop = useClipId('tm-clip-a-');
  const clipBottom = useClipId('tm-clip-b-');
  const clipDrawing = useClipId('tm-clip-d-');
  return <div className="tm-escena">
    <div className="tm-salto">
      <div className="tm-montaje"><div className="tm-cubo">
        <div className="tm-cara tm-lado tm-frente"><small>GRUPO</small><span>TRIMODOS</span></div>
        <div className="tm-cara tm-lado tm-derecha">Intraser.</div>
        <div className="tm-cara tm-lado tm-detras">Transargi.</div>
        <div className="tm-cara tm-lado tm-izquierda">Stinsa.</div>
        <div className="tm-cara tm-arriba"><i className="tm-fondo"/><Emblem clip={clipDrawing} className="tm-dibujo"/><Emblem clip={clipTop} className="tm-final"/></div>
        <div className="tm-cara tm-abajo"><i className="tm-fondo"/><Emblem clip={clipBottom}/></div>
      </div></div>
    </div>
    <div className="tm-sombra"/>
  </div>;
}

function Emblem({ clip, className = '' }: { clip: string; className?: string }) {
  return <svg className={`tm-emblema ${className}`} viewBox="0 0 100 100" aria-hidden="true">
    <defs><clipPath id={clip}><rect x="2.25" y="2.25" width="95.5" height="95.5"/></clipPath></defs>
    <g clipPath={`url(#${clip})`}><EmblemShapes/></g>
  </svg>;
}
