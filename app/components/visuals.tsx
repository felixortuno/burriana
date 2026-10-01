import type { TickerState } from '@/lib/board-ticker';
import { formatPallets } from '@/lib/warehouse-insights';

/** Progress ring: done out of total, the number in the middle. */
export function Ring({ value, total }: { value: number; total: number }) {
  const radius = 42, circumference = 2 * Math.PI * radius;
  const share = total ? Math.min(1, value / total) : 0;
  return <div className="donut" role="img" aria-label={`${value} de ${total} hechos`}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={radius} className="donut-track"/>
      {share > 0 && <circle cx="50" cy="50" r={radius} className="donut-fill" strokeDasharray={`${share * circumference} ${circumference}`}/>}
    </svg>
    <span><b>{value}</b><small>de {total}</small></span>
  </div>;
}

/** Part-to-whole in one bar, each part labelled with its value. */
export function SplitBar({ parts }: { parts: { label: string; value: number; tone: string }[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return <div className="split">
    <div className="split-bar" role="img" aria-label={parts.map(part => `${part.label} ${formatPallets(part.value)}`).join(', ')}>
      {parts.filter(part => part.value > 0).map(part => <i key={part.label} className={part.tone} style={{ flexGrow: total ? part.value / total : 0 }}/>)}
    </div>
    <div className="split-legend">{parts.map(part => <span key={part.label}><i className={'dot ' + part.tone}/>{part.label}<b>{formatPallets(part.value)}</b></span>)}</div>
  </div>;
}

/** The shift as a bar: lunch and fixed blocks marked on it, and where we are now. */
export function DayBar({ timeline, clock }: { timeline: NonNullable<TickerState['timeline']>; clock: string }) {
  return <div className="daybar" aria-hidden="true">
    <span className="daybar-edge">{timeline.start}</span>
    <div className="daybar-track">
      <span className="daybar-fill" style={{ transform: `scaleX(${timeline.progress})` }}/>
      {timeline.segments.map(segment => <span key={`${segment.kind}-${segment.start}`} className={`daybar-seg ${segment.kind}`} style={{ left: `${segment.from * 100}%`, width: `${Math.max(0.5, (segment.to - segment.from) * 100)}%` }}><em>{segment.label} {segment.start}</em></span>)}
      {timeline.progress > 0 && timeline.progress < 1 && <span className="daybar-now" style={{ left: `${timeline.progress * 100}%` }}><b>{clock}</b></span>}
    </div>
    <span className="daybar-edge">{timeline.end}</span>
  </div>;
}

/** How full something is against its limit; over the limit stays at the end. */
export function Meter({ value, max, tone = '' }: { value: number; max: number; tone?: string }) {
  return <div className={'gauge ' + tone}><i style={{ transform: `scaleX(${max ? Math.min(1, value / max) : 0})` }}/></div>;
}
