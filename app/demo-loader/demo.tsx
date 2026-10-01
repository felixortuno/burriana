'use client';
import { useState } from 'react';
import Link from 'next/link';
import CuboLoader from '../components/cubo-loader';
import Logo from '../components/logo';

type Tema = 'auto' | 'claro' | 'oscuro';

export default function LoaderDemo() {
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(false);
  const [instant, setInstant] = useState(false);
  const [finished, setFinished] = useState(false);
  const [size, setSize] = useState(120);
  const [tema, setTema] = useState<Tema>('auto');
  function replay(nextInstant = instant) { setRun(n => n + 1); setReady(nextInstant); setFinished(false); }

  return <main className="demo-loader">
    <header className="page-head">
      <div><h1>Pantalla de carga</h1><p>El cubo de Grupo Trimodos tal como aparece al abrir la app. «Terminar carga» simula que los datos ya han llegado.</p></div>
      <div className="page-actions"><Link className="btn secondary" href="/">Volver a la app</Link></div>
    </header>
    <div className="group-tools" style={{ padding: 0, marginBottom: 16 }}>
      <button className="btn primary" onClick={() => setReady(true)} disabled={ready || finished}>Terminar carga</button>
      <button className="btn secondary" onClick={() => replay()}>Repetir</button>
      <label className="tick"><input type="checkbox" checked={instant} onChange={event => { setInstant(event.target.checked); replay(event.target.checked); }}/><span>Carga instantánea (muestra la duración mínima)</span></label>
      <label className="field" style={{ margin: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}><span>Tamaño {size}px</span><input type="range" min={64} max={240} step={8} value={size} onChange={event => { setSize(Number(event.target.value)); replay(); }} style={{ width: 140, minHeight: 0, padding: 0 }}/></label>
      <div className="segmented" role="group" aria-label="Tema">{(['auto', 'claro', 'oscuro'] as Tema[]).map(value => <button key={value} aria-pressed={tema === value} onClick={() => { setTema(value); replay(); }}>{value === 'auto' ? 'Sistema' : value === 'claro' ? 'Claro' : 'Oscuro'}</button>)}</div>
    </div>
    <section className="demo-stage tm-tema" data-tema={tema === 'auto' ? undefined : tema}>
      <div className="demo-header"><span className="glyph"><Logo variant="lima" size="62%" id="demo-logo"/></span>Burriana</div>
      {finished ? <div className="demo-done"><p>La app ya está a la vista. Pulsa «Repetir» para verlo otra vez.</p></div>
        : <CuboLoader key={run} size={size} tema={tema} ready={ready} target="#demo-logo" onFinish={() => setFinished(true)}/>}
    </section>
    <h2 className="section-title">Logo<small>{'<Logo variant="lima" | "negro" | "blanco" size={…} />'}, SVG en línea.</small></h2>
    <div className="demo-logos">
      <div style={{ background: 'var(--tm-negro)' }}><Logo variant="lima" size={72}/><span>lima</span></div>
      <div style={{ background: '#fff' }}><Logo variant="negro" size={72}/><span>negro</span></div>
      <div style={{ background: 'var(--tm-azul)' }}><Logo variant="blanco" size={72}/><span>blanco</span></div>
      <div style={{ background: 'var(--tm-negro)' }}><Logo variant="lima" size={24}/><span>24 px</span></div>
    </div>
  </main>;
}
