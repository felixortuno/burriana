'use client';
import { useEffect, useRef, useState } from 'react';
import type { TickerState } from '@/lib/board-ticker';

const SPEED = 140; // px per second, readable from across the warehouse
const STILL_MS = 8_000;

type Props = { state: TickerState; time: string; done: number; open: number; running: number };

/** Scoreboard, stadium-style LED board and the bar of the day, in place of the shift strip. */
export default function ShiftTicker({ state, time, done, open, running }: Props) {
  const { messages, timeline } = state;
  const signature = messages.map(message => message.text).join('|');
  const [shown, setShown] = useState({ signature, index: 0 });
  // A new situation (the break approaching, a truck…) starts the board over.
  if (shown.signature !== signature) setShown({ signature, index: 0 });
  const index = shown.index % Math.max(1, messages.length);
  const message = messages[index];
  const board = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const next = () => setShown(previous => ({ ...previous, index: previous.index + 1 }));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = window.setTimeout(next, STILL_MS);
      return () => window.clearTimeout(timer);
    }
    const width = board.current?.clientWidth ?? 0, length = text.current?.scrollWidth ?? 0;
    if (!text.current || !width) return;
    const animation = text.current.animate(
      [{ transform: `translateX(${width}px)` }, { transform: `translateX(${-length}px)` }],
      { duration: ((width + length) / SPEED) * 1000, easing: 'linear' },
    );
    animation.onfinish = next;
    return () => animation.cancel();
  }, [signature, index]);

  return <section className="wb-ticker" aria-label="Estado del turno">
    <div className="wb-ticker-row">
      <div className="wb-score" aria-label={`Hoy: ${done} hechos, ${open} pendientes, ${running} en marcha`}>
        <span className="wb-score-title">Marcador del día</span>
        <div className="wb-score-digits"><b>{done}</b><i>–</i><b>{open}</b></div>
        <div className="wb-score-labels"><span>Hechos</span><span>Pendientes</span></div>
        {running > 0 && <span className="wb-score-live"><i/>{running} en marcha</span>}
      </div>
      <div ref={board} className="wb-led" data-tone={message?.tone ?? 'info'}>
        <i key={`${shown.signature}-${index}`} className="wb-led-wipe" aria-hidden="true"/>
        <span ref={text} key={message?.text} className="wb-led-text" aria-hidden="true">{message?.text}</span>
        <span className="sr-only" aria-live="polite">{messages[0]?.text}</span>
      </div>
    </div>
    {timeline && <div className="wb-day" aria-hidden="true">
      <span className="wb-day-edge">{timeline.start}</span>
      <div className="wb-day-track">
        <span className="wb-day-fill" style={{ transform: `scaleX(${timeline.progress})` }}/>
        {timeline.segments.map(segment => <span key={`${segment.kind}-${segment.start}`} className={`wb-day-seg ${segment.kind}`} style={{ left: `${segment.from * 100}%`, width: `${(segment.to - segment.from) * 100}%` }}><em>{segment.label} {segment.start}</em></span>)}
        <span className="wb-day-now" style={{ left: `${timeline.progress * 100}%` }}><b>{time}</b></span>
      </div>
      <span className="wb-day-edge">{timeline.end}</span>
    </div>}
  </section>;
}
