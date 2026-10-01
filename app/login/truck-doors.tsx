'use client';
import { Fragment, useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { useAppRevealed } from '../components/app-loader';
import { EmblemShapes, useClipId } from '../components/logo';
import './truck-doors.css';

/**
 * «abiertas» is also the server render and what stays without JS or with reduced
 * motion: doors open, form visible. The intro only ever adds classes on top.
 */
export type DoorPhase = 'abiertas' | 'cerradas' | 'abriendo';

const SEEN_KEY = 'tm-puertas-vistas';
const seen = () => { try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } };

/**
 * The opening, as classes for the page root: «cerradas» while the loading screen
 * is up, «abriendo» while the CSS keyframes run, nothing once they end. A click,
 * a tap or a key jumps to the end. `root` is the page root (its keyframes are
 * awaited); `onOpen` puts the focus in the form.
 */
export function useDoorIntro(root: RefObject<HTMLElement | null>, onOpen: () => void) {
  const revealed = useAppRevealed();
  const [phase, setPhase] = useState<DoorPhase>('abiertas');
  const [short, setShort] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- needs matchMedia and localStorage, so it runs after hydration */
    setArmed(true);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setShort(seen());
    setPhase('cerradas');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // The doors start as the loading screen lifts, so the opening is never missed.
  useEffect(() => {
    if (!revealed || phase !== 'cerradas') return;
    markSeen();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader decides when the page is visible
    setPhase('abriendo');
  }, [revealed, phase]);

  // Done when every keyframe has finished; where getAnimations is missing, a timer.
  useEffect(() => {
    if (phase !== 'abriendo') return;
    let live = true;
    const end = () => { if (live) setPhase('abiertas'); };
    const animations = root.current?.getAnimations?.({ subtree: true })
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    const timer = window.setTimeout(end, animations ? 10_000 : 3_000);
    // No animations at all (the CSS did not arrive): straight to the end.
    if (animations) Promise.all(animations.map(animation => animation.finished)).then(end, () => undefined);
    return () => { live = false; window.clearTimeout(timer); };
  }, [phase, root]);

  useEffect(() => {
    if (phase === 'abiertas') return;
    const skip = () => setPhase('abiertas');
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      skip();
      // A letter goes on into the field; Tab, Enter and Space only move there.
      if (event.key.length !== 1 || event.key === ' ') event.preventDefault();
      onOpen();
    };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', onKey);
    };
  }, [phase, onOpen]);

  useEffect(() => {
    if (armed && revealed && phase === 'abiertas') onOpen();
  }, [armed, revealed, phase, onOpen]);

  return (phase === 'abiertas' ? '' : ' ' + phase) + (short ? ' corta' : '');
}

/** Lock rods, as a fraction of the door width from the hinge. */
const RODS = [0.24, 0.76];
/** Hinges and rod guides, as a fraction of the door height. */
const HINGES = [0.09, 0.36, 0.64, 0.91];
const GUIDES = ['7%', '34%', '93%'];

const vars = (values: Record<string, number>) => values as CSSProperties;

/** Rear of a box semi-trailer at night. Decorative: the form lives outside it. */
export default function TruckDoors() {
  return <div className="td" aria-hidden="true">
    <i className="td-farola-luz" />
    <div className="td-farola"><i className="td-farola-foco" /></div>
    <div className="td-suelo"><GroundMarks /></div>
    <i className="td-derrame" />

    <div className="td-camion">
      <i className="td-sombra" />
      <div className="td-bajos">
        <i className="td-bajos-fondo" />
        <i className="td-rueda td-izq-x" /><i className="td-rueda td-der-x" />
        <i className="td-faldilla td-izq-x" /><i className="td-faldilla td-der-x" />
        <i className="td-travesano" />
        <i className="td-piloto td-izq-x"><b /><b /><b /><b /></i>
        <i className="td-piloto td-der-x"><b /><b /><b /><b /></i>
        <span className="td-matricula"><i>E</i><span>R 2817 BDK</span></span>
        <i className="td-soporte td-izq-x" /><i className="td-soporte td-der-x" />
        <i className="td-paragolpes" />
      </div>

      <div className="td-marco">
        <i className="td-poste td-izq-x" /><i className="td-poste td-der-x" />
        <i className="td-umbral" />
        <i className="td-cabecero"><b className="td-galibo td-izq-x" /><b className="td-galibo td-der-x" /></i>
        <div className="td-hueco">
          <Interior />
          <i className="td-junta" />
          <Door side="izq" />
          <Door side="der" />
        </div>
        <div className="td-herrajes">
          {HINGES.map(t => <Fragment key={t}>
            <i className="td-nudillo td-izq-x" style={vars({ '--t': t })} />
            <i className="td-nudillo td-der-x" style={vars({ '--t': t })} />
          </Fragment>)}
          {RODS.map(k => <Fragment key={k}>
            <i className="td-cerradero td-izq-x" style={vars({ '--k': k })} />
            <i className="td-cerradero td-der-x" style={vars({ '--k': k })} />
            <i className="td-cerradero td-abajo td-izq-x" style={vars({ '--k': k })} />
            <i className="td-cerradero td-abajo td-der-x" style={vars({ '--k': k })} />
          </Fragment>)}
        </div>
        {/* The loading screen's emblem flies here and lands on the painted one. */}
        <i className="td-diana" data-logo-target="" />
      </div>
    </div>
    <i className="td-luz" />
  </div>;
}

function Door({ side }: { side: 'izq' | 'der' }) {
  return <div className={`td-puerta td-${side}`}>
    <div className="td-cara">
      <StampedEmblem />
      <span className="td-rotulo">Grupo Trimodos</span>
      {/* Above the paint so the ribs and the grain show through the lime. */}
      <i className="td-pintura" />
      <i className="td-corrugado" />
      {HINGES.map(t => <i key={t} className="td-bisagra" style={vars({ '--t': t })} />)}
      {RODS.map(k => <span key={k} className="td-barra" style={vars({ '--k': k })}>
        <i className="td-reten" />
        <i className="td-eje" />
        {GUIDES.map(top => <i key={top} className="td-guia" style={{ top }} />)}
        <i className="td-leva" /><i className="td-leva td-abajo" />
        <i className="td-maneta" />
      </span>)}
    </div>
    <i className="td-oscuro td-oscuro-cara" />
    <div className="td-dorso" />
    <i className="td-oscuro td-oscuro-dorso" />
  </div>;
}

/** The emblem from logo/emblema-lima.svg, centred on the joint: each door shows its half. */
function StampedEmblem() {
  const clip = useClipId('td-emblema-');
  return <svg className="td-emblema" viewBox="0 0 100 100">
    <defs><clipPath id={clip}><rect x="2.25" y="2.25" width="95.5" height="95.5" /></clipPath></defs>
    <g fill="none" strokeWidth={5.5} strokeLinejoin="miter" clipPath={`url(#${clip})`}><EmblemShapes /></g>
  </svg>;
}

/*
 * The empty box behind the doors, drawn once in a 100×100 box stretched to the
 * opening. VP is the vanishing point (keep .td-hueco's perspective-origin on it);
 * BACK is the far wall as a fraction of the opening.
 */
const VP = [50, 54] as const;
const BACK = 0.22;
const STEPS = 36;
const depth = (k: number) => 1 / (1 + (k / STEPS) * (1 / BACK - 1));
const at = (x: number, y: number, s: number) => `${(VP[0] + (x - VP[0]) * s).toFixed(2)} ${(VP[1] + (y - VP[1]) * s).toFixed(2)}`;
const quad = (a: string, b: string, c: string, d: string) => `M${a}L${b}L${c}L${d}Z`;
const line = (a: string, b: string) => `M${a}L${b}`;
const steps = (from: number, every: number) => Array.from({ length: Math.floor((STEPS - from) / every) + 1 }, (_, i) => from + i * every).filter(k => k < STEPS);

const INTERIOR = {
  floor: quad(at(0, 100, 1), at(100, 100, 1), at(100, 100, BACK), at(0, 100, BACK)),
  ceiling: quad(at(0, 0, 1), at(100, 0, 1), at(100, 0, BACK), at(0, 0, BACK)),
  left: quad(at(0, 0, 1), at(0, 0, BACK), at(0, 100, BACK), at(0, 100, 1)),
  right: quad(at(100, 0, 1), at(100, 0, BACK), at(100, 100, BACK), at(100, 100, 1)),
  ribs: steps(0, 2).map(k => [0, 100].map(x => quad(at(x, 0, depth(k)), at(x, 0, depth(k + 1)), at(x, 100, depth(k + 1)), at(x, 100, depth(k)))).join('')).join(''),
  ribEdges: steps(1, 2).map(k => [0, 100].map(x => line(at(x, 0, depth(k)), at(x, 100, depth(k)))).join('')).join(''),
  planks: Array.from({ length: 13 }, (_, i) => (i + 1) * 100 / 14).map(x => line(at(x, 100, 1), at(x, 100, BACK))).join(''),
  bows: steps(3, 3).map(k => line(at(0, 0, depth(k)), at(100, 0, depth(k)))).join(''),
  corners: [[0, 0], [100, 0], [0, 100], [100, 100]].map(([x, y]) => line(at(x, y, 1), at(x, y, BACK))).join(''),
  back: { x: VP[0] * (1 - BACK), y: VP[1] * (1 - BACK), w: 100 * BACK, h: 100 * BACK },
};

function Interior() {
  const { back } = INTERIOR;
  return <div className="td-interior">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="td-g-suelo" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#1a120b" /><stop offset=".55" stopColor="#3a2716" /><stop offset="1" stopColor="#80592f" /></linearGradient>
        <linearGradient id="td-g-techo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141618" /><stop offset="1" stopColor="#6d665b" /></linearGradient>
        <linearGradient id="td-g-izq" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#1c1f22" /><stop offset="1" stopColor="#8a8173" /></linearGradient>
        <linearGradient id="td-g-der" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor="#191b1e" /><stop offset="1" stopColor="#7e7669" /></linearGradient>
        <radialGradient id="td-g-fondo" cx=".5" cy=".42" r=".8"><stop offset="0" stopColor="#f6d3a2" /><stop offset=".5" stopColor="#c39465" /><stop offset="1" stopColor="#7a5c40" /></radialGradient>
        <radialGradient id="td-g-sombra" cx={VP[0] / 100} cy={VP[1] / 100} r=".72"><stop offset=".25" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".62" /></radialGradient>
      </defs>
      <path d={INTERIOR.ceiling} fill="url(#td-g-techo)" />
      <path d={INTERIOR.left} fill="url(#td-g-izq)" />
      <path d={INTERIOR.right} fill="url(#td-g-der)" />
      <path d={INTERIOR.floor} fill="url(#td-g-suelo)" />
      <rect x={back.x} y={back.y} width={back.w} height={back.h} fill="url(#td-g-fondo)" />
      <path d={INTERIOR.ribs} fill="#000" fillOpacity=".2" />
      <g fill="none">
        <path d={INTERIOR.ribEdges} stroke="#fff" strokeOpacity=".07" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={INTERIOR.planks} stroke="#000" strokeOpacity=".5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={INTERIOR.bows} stroke="#000" strokeOpacity=".35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={INTERIOR.corners} stroke="#000" strokeOpacity=".55" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </g>
      <rect width="100" height="100" fill="url(#td-g-sombra)" />
    </svg>
    <i className="td-interior-luz" />
  </div>;
}

/** Two faded parking lines running away towards the horizon, beside the truck. */
function GroundMarks() {
  return <svg className="td-marcas" viewBox="0 0 100 100" preserveAspectRatio="none">
    <defs><linearGradient id="td-g-marca" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8d2bd" stopOpacity="0" /><stop offset="1" stopColor="#d8d2bd" stopOpacity=".13" /></linearGradient></defs>
    <path d="M-22 100L-17 100L47.6 0L47.3 0ZM117 100L122 100L52.7 0L52.4 0Z" fill="url(#td-g-marca)" />
  </svg>;
}
