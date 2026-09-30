import { useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import AssistantAvatar from '../assistant/AssistantAvatar';
import { OrnamentCorner, Rosette } from '../brand/Ornament';
import { useT } from '../i18n';
import { useClarity } from '../state';

const COLORS = ['#1f9d76', '#3aa7e8', '#f2b441', '#e97b6b', '#8b7fd6', '#C9A23A'];

/** Праздник нового значка: конфетти, ассистент радуется. Короткий и отключаемый (Esc / клик). */
export default function Celebration() {
  const { celebration, dismissCelebration, speech, voiceOn, callOpen, state, lang, avatar } = useClarity();
  const { t } = useT();
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.6, dur: 1.8 + Math.random() * 1.4, color: COLORS[i % COLORS.length], rot: Math.random() * 360 })), [celebration?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!celebration || callOpen) return;
    if (voiceOn && !speech.speaking) speech.speak(t('patient.celeSay', { title: celebration.title }), { voice: true, lang });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissCelebration(); };
    window.addEventListener('keydown', onKey);
    const tm = setTimeout(dismissCelebration, 6000);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(tm); };
  }, [celebration?.id, callOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!celebration || callOpen) return null;
  return (
    <div className="celebrate" role="dialog" aria-modal="true" aria-label={t('patient.celeSay', { title: celebration.title })} onClick={dismissCelebration}>
      <div className="confetti" aria-hidden>{pieces.map((p, i) => <i key={i} style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }} />)}</div>
      <div className="celebrate-card pv-celebrate-card" onClick={e => e.stopPropagation()}>
        <OrnamentCorner corner="tl" className="kz-gold pv-corner" size={56} opacity={0.5} accent="#0b7a70" />
        <OrnamentCorner corner="tr" className="kz-gold pv-corner" size={56} opacity={0.5} accent="#0b7a70" />
        <OrnamentCorner corner="bl" className="kz-gold pv-corner" size={56} opacity={0.5} accent="#0b7a70" />
        <OrnamentCorner corner="br" className="kz-gold pv-corner" size={56} opacity={0.5} accent="#0b7a70" />
        <span className="pv-cele-avatar">
          <span className="pv-cele-rosette" aria-hidden><Rosette className="kz-gold" size={176} opacity={0.4} accent="#0b7a70" /></span>
          <AssistantAvatar avatar={avatar} mood="happy" size={130} framing="head" speaking={speech.speaking} mouth={speech.mouth} mouthSource={speech.getMouthFrame} />
        </span>
        <span className="celebrate-badge" aria-hidden>{celebration.icon}</span>
        <small>{t('patient.celeNew')}</small>
        <h2>{celebration.title}</h2>
        <p>{celebration.description}</p>
        <span className="celebrate-pts"><Star size={16} fill="currentColor" /> {t('patient.celePts', { n: celebration.points })} · {t('patient.celeTotal', { n: state?.progress.points ?? 0 })}</span>
        <button className="btn primary" onClick={dismissCelebration} autoFocus>{t('patient.celeOk')}</button>
      </div>
    </div>
  );
}
