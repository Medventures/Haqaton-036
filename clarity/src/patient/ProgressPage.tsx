import { Heart, Lock, Star } from 'lucide-react';
import { OrnamentCorner } from '../brand/Ornament';
import { useT } from '../i18n';
import { useClarity } from '../state';

export default function ProgressPage() {
  const { state, openAssistant } = useClarity();
  const { t } = useT();
  if (!state) return null;
  const pp = (k: string, vars?: Record<string, string | number>) => t(`patient.${k}`, vars);
  const p = state.progress;
  const pct = p.nextLevelAt ? ((p.points - p.levelStartAt) / (p.nextLevelAt - p.levelStartAt)) * 100 : 100;
  const earned = p.achievements.filter(a => a.earned);
  const next = p.achievements.find(a => !a.earned);
  return (
    <div className="page">
      <div className="page-head"><div><h1>{pp('progressTitle')}</h1><p className="muted">{pp('progSubtitle')}</p></div></div>

      <section className="level-card pv-level-card">
        <OrnamentCorner corner="tl" className="kz-gold pv-corner" size={64} opacity={0.35} accent="#0b7a70" />
        <OrnamentCorner corner="br" className="kz-gold pv-corner" size={64} opacity={0.35} accent="#0b7a70" />
        <div className="ring" style={{ ['--pct' as string]: `${Math.round((p.points / p.maxPoints) * 100)}` }} aria-label={pp('progRingAria', { a: p.points, b: p.maxPoints })}>
          <div><Star size={22} fill="currentColor" /><b>{p.points}</b><small>{pp('progOf', { n: p.maxPoints })}</small></div>
        </div>
        <div className="level-info">
          <small>{pp('progLevel', { n: p.level })}</small>
          <h2>{p.levelTitle}</h2>
          <div className="bar big" aria-hidden><i style={{ width: `${pct}%` }} /></div>
          <p className="muted">{p.nextLevelAt ? pp('progToNext', { n: p.nextLevelAt - p.points, title: p.nextLevelTitle ?? '' }) : pp('progMax')}</p>
          {next && <button className="btn primary" onClick={() => openAssistant()}>{next.icon} {pp('progNextBadge', { title: next.title })}</button>}
        </div>
      </section>

      <h2 className="section-title">{pp('progBadges', { a: earned.length, b: p.achievements.length })}</h2>
      <div className="badge-grid">
        {p.achievements.map(a => (
          <div key={a.id} className={`badge ${a.earned ? 'on' : ''}`}>
            <span className="badge-ico" aria-hidden>{a.earned ? a.icon : <Lock size={22} />}</span>
            <b>{a.title}</b>
            <small>{a.earned ? a.description : a.hint}</small>
            <span className="badge-pts"><Star size={12} fill="currentColor" /> {a.points}</span>
          </div>
        ))}
      </div>

      <section className="assurance">
        <Heart size={22} />
        <p><b>{pp('progFairTitle')}</b> {pp('progFairText')}</p>
      </section>
    </div>
  );
}
