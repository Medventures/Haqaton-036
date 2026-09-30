// Знакомство после регистрации: 8 коротких шагов, помощник озвучивает каждый.
// Сначала язык (ru/kk) и выбор помощника (Аружан / Клэри) — дальше весь интерфейс и речь на выбранном языке.
// Данные нужны для маршрута: возраст и пол — для расчёта функции почек и вопросов
// о беременности, опасения — для персональных советов, настройки — для удобства.

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Volume2, VolumeX } from 'lucide-react';
import type { Concern, Sex, Slot } from '../../shared/types';
import { AVATAR_NAME, LANG_LABEL, type AvatarId, type Lang } from '../../shared/i18n';
import AssistantAvatar from '../assistant/AssistantAvatar';
import { OrnamentBand, OrnamentCorner, OrnamentPattern } from '../brand/Ornament';
import { api, dayKey, fmtDate, fmtDayShort, fmtTime, type OnboardingPayload } from '../api';
import { useAuth } from '../auth';
import { translate, useT } from '../i18n';
import { useVoice } from '../hooks/useVoice';

const CONCERNS: { id: Concern; emoji: string }[] = [
  { id: 'claustrophobia', emoji: '🚪' },
  { id: 'contrast', emoji: '💧' },
  { id: 'injection', emoji: '💉' },
  { id: 'noise', emoji: '🔊' },
  { id: 'preparation', emoji: '📋' },
  { id: 'meds', emoji: '💊' },
  { id: 'result', emoji: '📄' },
  { id: 'road', emoji: '🚗' },
];
const ANXIETY = ['😌', '🙂', '😐', '😟', '😰'];
/** Порядок карточек языка: казахский первым. */
const LANG_CARDS: Lang[] = ['kk', 'ru'];
const AVATARS: AvatarId[] = ['aruzhan', 'clary'];

type StepId = 'lang' | 'avatar' | 'name' | 'about' | 'time' | 'feel' | 'comfort' | 'consent';
const STEP_IDS: StepId[] = ['lang', 'avatar', 'name', 'about', 'time', 'feel', 'comfort', 'consent'];
const STEP_TITLE: Record<StepId, string> = {
  lang: 'stepLang', avatar: 'stepAvatar', name: 'stepName', about: 'stepAbout',
  time: 'stepTime', feel: 'stepFeel', comfort: 'stepComfort', consent: 'stepConsent',
};

/** Экраны уже 960px — мобильная раскладка (как в styles.css). */
function useNarrow(query = '(max-width: 960px)') {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

interface Props { defaultName: string; onDone: () => Promise<void> }

export default function Onboarding({ defaultName, onDone }: Props) {
  const { t, lang, setLang } = useT();
  const { me } = useAuth();
  const speech = useVoice();
  const narrow = useNarrow();
  const [step, setStep] = useState(0);
  const [avatar, setAvatar] = useState<AvatarId>(me?.user?.avatar ?? 'aruzhan');
  const [voice, setVoice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [day, setDay] = useState('');
  const year = new Date().getFullYear();
  const guest = !defaultName || defaultName === 'Гость' || defaultName === 'Қонақ';
  const [f, setF] = useState({
    preferredName: guest ? '' : defaultName.split(' ')[0],
    lastName: guest ? '' : defaultName.split(' ').slice(1).join(' '),
    birthYear: '' as string, sex: '' as Sex | '', phone: '',
    mriSlotId: '', firstMri: null as boolean | null, anxiety: 3, concerns: [] as Concern[],
    largeText: false, consentData: false, consentAi: false,
  });
  const set = (p: Partial<typeof f>) => setF(prev => ({ ...prev, ...p }));

  useEffect(() => { api.mriSlots().then(r => { setSlots(r.slots); setDay(r.slots[0] ? dayKey(r.slots[0].startsAt) : ''); }).catch(() => setSlots([])); }, []);
  useEffect(() => { document.documentElement.classList.toggle('large-text', f.largeText); }, [f.largeText]);

  const days = useMemo(() => [...new Set(slots.map(s => dayKey(s.startsAt)))].slice(0, 8), [slots]);
  const chosen = slots.find(s => s.id === f.mriSlotId);
  const name = f.preferredName.trim();
  const assistant = AVATAR_NAME[avatar][lang];
  const sid = STEP_IDS[step];
  const last = step === STEP_IDS.length - 1;

  /** Кабинет из расписания («Кабинет МРТ №1 · 1,5 Тл») — на языке интерфейса. */
  const room = (doctor: string, short = false) => {
    const m = /^Кабинет МРТ №(\d+)(.*)$/.exec(doctor);
    if (!m) return doctor;
    const label = t(short ? 'onboarding.roomShort' : 'onboarding.room', { n: m[1] });
    return short ? label : `${label}${m[2]}`;
  };

  const SAY: Record<StepId, string> = {
    lang: t('onboarding.sayLang'),
    avatar: t('onboarding.sayAvatar', { name: assistant }),
    name: t('onboarding.sayName'),
    about: name ? t('onboarding.sayAboutNamed', { user: name }) : t('onboarding.sayAbout'),
    time: t('onboarding.sayTime'),
    feel: t('onboarding.sayFeel'),
    comfort: t('onboarding.sayComfort'),
    consent: t('onboarding.sayConsent'),
  };
  const say = SAY[sid];

  // Реплика шага звучит при смене шага, языка и помощника.
  useEffect(() => {
    const tm = setTimeout(() => speech.speak(say, { voice, lang }), 250);
    return () => { clearTimeout(tm); speech.stopSpeaking(); };
  }, [step, lang, avatar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => speech.stopSpeaking(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const valid: Record<StepId, boolean> = {
    lang: true,
    avatar: true,
    name: name.length > 0,
    about: Number(f.birthYear) >= year - 110 && Number(f.birthYear) <= year - 14 && Boolean(f.sex),
    time: Boolean(f.mriSlotId),
    feel: f.firstMri !== null,
    comfort: true,
    consent: f.consentData && f.consentAi,
  };
  const ERR: Record<StepId, string> = {
    lang: '', avatar: '', comfort: '',
    name: t('onboarding.errName'),
    about: t('onboarding.errAbout', { min: year - 110, max: year - 14 }),
    time: t('onboarding.errSlot'),
    feel: t('onboarding.errFirst'),
    consent: t('onboarding.errConsent'),
  };

  const next = async () => {
    setErr('');
    if (!valid[sid]) { setErr(ERR[sid]); return; }
    if (!last) { setStep(step + 1); return; }
    setBusy(true);
    try {
      const payload: OnboardingPayload = {
        preferredName: name, lastName: f.lastName.trim() || undefined, birthYear: Number(f.birthYear), sex: f.sex as Sex,
        phone: f.phone.trim() || undefined, mriSlotId: f.mriSlotId || undefined, firstMri: f.firstMri, anxiety: f.anxiety,
        concerns: f.concerns, voice, largeText: f.largeText, consentData: true, consentAi: true,
      };
      await api.onboarding(payload);
      // Язык и помощник сохраняются в профиле до перехода в приложение.
      // Ошибка здесь не блокирует вход: язык и так сохраняется при переключении (App.tsx).
      await api.prefs({ lang, avatar }).catch(() => undefined);
      try { localStorage.setItem('clarity-voice', voice ? '1' : '0'); localStorage.setItem('clarity-large', f.largeText ? '1' : '0'); } catch { /* ignore */ }
      speech.stopSpeaking();
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('onboarding.errSave'));
    } finally { setBusy(false); }
  };

  const chooseLang = (l: Lang) => { setErr(''); if (l !== lang) setLang(l); };
  const chooseAvatar = (a: AvatarId) => { setErr(''); setAvatar(a); };
  const toggleVoice = () => {
    const v = !voice; setVoice(v);
    if (!v) speech.stopSpeaking(); else speech.speak(say, { voice: true, lang });
  };

  return (
    <div className="onb onb-v4">
      <aside className="onb-side">
        <OrnamentPattern className="kz-on-dark onb-orn-pattern" color="#E7C86A" opacity={0.08} tile={88} />
        <div className="onb-orn-band" aria-hidden><OrnamentBand className="kz-on-dark" color="#E7C86A" opacity={0.4} height={16} /></div>
        <div className="brand light"><span className="brand-mark">✳</span><b>clarity</b></div>
        <div className={`onb-avatar onb-portrait is-${avatar}`}>
          <AssistantAvatar
            avatar={avatar}
            mood={sid === 'feel' && f.anxiety >= 4 ? 'concerned' : 'happy'}
            speaking={speech.speaking}
            mouth={speech.mouth}
            mouthSource={speech.getMouthFrame}
            framing={narrow ? 'head' : 'bust'}
            size={narrow ? 84 : 220}
          />
        </div>
        <p className="onb-ai-tag">{t('onboarding.aiTag', { name: assistant })}</p>
        <p className="onb-bubble" aria-live="polite">{say}</p>
        <button className="onb-voice" onClick={toggleVoice} aria-pressed={voice}>
          {voice ? <Volume2 size={16} /> : <VolumeX size={16} />} {voice ? t('onboarding.voiceOn', { name: assistant }) : t('onboarding.voiceOff')}
        </button>
      </aside>

      <main className="onb-main">
        <div className="onb-progress" aria-label={t('onboarding.progressAria', { i: step + 1, n: STEP_IDS.length })}>
          {STEP_IDS.map((s, i) => <div key={s} className={i < step ? 'done' : i === step ? 'cur' : ''}><i>{i < step ? <Check size={12} /> : i + 1}</i><span>{t(`onboarding.${STEP_TITLE[s]}`)}</span></div>)}
        </div>

        <section className="onb-card">
          {sid === 'lang' && <>
            <h1>{t('onboarding.langTitle')}</h1>
            <p className="lead">{t('onboarding.langLead')}</p>
            <div className="onb-lang-cards" role="radiogroup" aria-label={t('onboarding.stepLang')}>
              {LANG_CARDS.map(l => (
                <button key={l} role="radio" aria-checked={lang === l} className={`onb-lang-card ${lang === l ? 'on' : ''}`} onClick={() => chooseLang(l)} lang={l}>
                  <OrnamentCorner className="onb-card-corner" corner="br" size={46} color="#C9A23A" opacity={lang === l ? 0.55 : 0.25} />
                  <span className="onb-lang-mark">{l === 'kk' ? 'ҚАЗ' : 'РУС'}</span>
                  <span className="onb-lang-text"><b>{LANG_LABEL[l]}</b><small>{translate(l, 'onboarding.langHint')}</small></span>
                  <span className="onb-pick" aria-hidden>{lang === l && <Check size={18} />}</span>
                </button>
              ))}
            </div>
          </>}

          {sid === 'avatar' && <>
            <h1>{t('onboarding.avatarTitle')}</h1>
            <p className="lead">{t('onboarding.avatarLead')}</p>
            <div className="onb-avatar-cards" role="radiogroup" aria-label={t('onboarding.stepAvatar')}>
              {AVATARS.map(a => (
                <button key={a} role="radio" aria-checked={avatar === a} className={`onb-avatar-card ${avatar === a ? 'on' : ''}`} onClick={() => chooseAvatar(a)}>
                  {a === 'aruzhan' && <span className="onb-reco">{t('onboarding.recommended')}</span>}
                  <span className="onb-avatar-preview">
                    <AssistantAvatar avatar={a} mood="happy" framing="head" size={narrow ? 104 : 136}
                      speaking={avatar === a && speech.speaking} mouth={avatar === a ? speech.mouth : 0}
                      mouthSource={avatar === a ? speech.getMouthFrame : undefined} />
                  </span>
                  <b>{AVATAR_NAME[a][lang]}</b>
                  <small>{t(a === 'aruzhan' ? 'onboarding.aruzhanDesc' : 'onboarding.claryDesc')}</small>
                  <span className="onb-selected" aria-hidden>{avatar === a && <><Check size={14} /> {t('onboarding.selected')}</>}</span>
                </button>
              ))}
            </div>
          </>}

          {sid === 'name' && <>
            <h1>{t('onboarding.nameTitle')}</h1>
            <p className="lead">{t('onboarding.nameLead', { name: assistant })}</p>
            <label className="field">{t('onboarding.nameLabel')}<input autoFocus value={f.preferredName} onChange={e => set({ preferredName: e.target.value })} placeholder={t('onboarding.namePh')} maxLength={40} /></label>
            <label className="field">{t('onboarding.lastName')} <small>{t('onboarding.lastNameNote')}</small><input value={f.lastName} onChange={e => set({ lastName: e.target.value })} maxLength={60} /></label>
          </>}

          {sid === 'about' && <>
            <h1>{t('onboarding.aboutTitle')}</h1>
            <p className="lead">{t('onboarding.aboutLead')}</p>
            <label className="field">{t('onboarding.birthYear')}<input inputMode="numeric" value={f.birthYear} onChange={e => set({ birthYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder={t('onboarding.birthPh', { y: year - 45 })} /></label>
            <div className="field">{t('onboarding.sex')}
              <div className="choice two">
                {([['female', 'onboarding.female', '👩'], ['male', 'onboarding.male', '👨']] as const).map(([v, k, e]) => <button key={v} className={f.sex === v ? 'on' : ''} onClick={() => set({ sex: v })} aria-pressed={f.sex === v}><span className="emo">{e}</span>{t(k)}</button>)}
              </div>
            </div>
            <label className="field">{t('onboarding.phone')} <small>{t('onboarding.optional')}</small><input inputMode="tel" value={f.phone} onChange={e => set({ phone: e.target.value.replace(/[^\d\s()+-]/g, '') })} placeholder="+7 7__ ___ __ __" /></label>
          </>}

          {sid === 'time' && <>
            <h1>{t('onboarding.timeTitle')}</h1>
            <p className="lead"><b>{t('onboarding.study')}</b> · {t('onboarding.timeLead')}</p>
            {slots.length === 0 ? <p className="muted">{t('onboarding.loadingSlots')}</p> : <>
              <div className="day-chips" role="tablist">{days.map(d => { const s = slots.find(x => dayKey(x.startsAt) === d)!; return <button key={d} role="tab" aria-selected={day === d} className={day === d ? 'on' : ''} onClick={() => setDay(d)}>{fmtDayShort(s.startsAt)}</button>; })}</div>
              <div className="time-grid">{slots.filter(s => dayKey(s.startsAt) === day).map(s => <button key={s.id} className={f.mriSlotId === s.id ? 'on' : ''} onClick={() => set({ mriSlotId: s.id })}><b>{fmtTime(s.startsAt)}</b><small>{room(s.doctor.split('·')[0].trim(), true)}</small></button>)}</div>
              {chosen && <p className="picked"><Check size={16} /> {fmtDate(chosen.startsAt)}, {fmtTime(chosen.startsAt)} · {room(chosen.doctor)}</p>}
            </>}
          </>}

          {sid === 'feel' && <>
            <h1>{t('onboarding.feelTitle')}</h1>
            <div className="field">{t('onboarding.firstQ')}
              <div className="choice two">
                <button className={f.firstMri === true ? 'on' : ''} onClick={() => set({ firstMri: true })} aria-pressed={f.firstMri === true}>{t('onboarding.firstYes')}</button>
                <button className={f.firstMri === false ? 'on' : ''} onClick={() => set({ firstMri: false })} aria-pressed={f.firstMri === false}>{t('onboarding.firstNo')}</button>
              </div>
            </div>
            <div className="field">{t('onboarding.anxietyQ')}
              <div className="anxiety">{ANXIETY.map((e, i) => <button key={e} className={f.anxiety === i + 1 ? 'on' : ''} onClick={() => set({ anxiety: i + 1 })} aria-label={t(`onboarding.anx${i + 1}`)} aria-pressed={f.anxiety === i + 1}>{e}</button>)}</div>
              <small className="center">{t(`onboarding.anx${f.anxiety}`)}</small>
            </div>
            <div className="field">{t('onboarding.concernsQ')} <small>{t('onboarding.concernsNote')}</small>
              <div className="chips">{CONCERNS.map(c => { const on = f.concerns.includes(c.id); return <button key={c.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => set({ concerns: on ? f.concerns.filter(x => x !== c.id) : [...f.concerns, c.id] })}>{c.emoji} {t(`onboarding.c_${c.id}`)}</button>; })}</div>
            </div>
          </>}

          {sid === 'comfort' && <>
            <h1>{t('onboarding.comfortTitle')}</h1>
            <p className="lead">{t('onboarding.comfortLead')}</p>
            <button className={`toggle-row ${voice ? 'on' : ''}`} onClick={() => setVoice(!voice)} aria-pressed={voice}><span className="emo">🗣️</span><span><b>{t('onboarding.voiceTitle', { name: assistant })}</b><small>{t('onboarding.voiceText')}</small></span><i /></button>
            <button className={`toggle-row ${f.largeText ? 'on' : ''}`} onClick={() => set({ largeText: !f.largeText })} aria-pressed={f.largeText}><span className="emo">🔎</span><span><b>{t('onboarding.largeTitle')}</b><small>{t('onboarding.largeText')}</small></span><i /></button>
          </>}

          {sid === 'consent' && <>
            <h1>{t('onboarding.consentTitle', { user: name })}</h1>
            <div className="summary">
              <div><span>{t('onboarding.sumStudy')}</span><b>{t('onboarding.study')}</b></div>
              {chosen && <div><span>{t('onboarding.sumWhen')}</span><b>{fmtDate(chosen.startsAt)}, {fmtTime(chosen.startsAt)}</b></div>}
              <div><span>{t('onboarding.sumAbout')}</span><b>{t(f.sex === 'female' ? 'onboarding.aboutFemale' : 'onboarding.aboutMale', { n: year - Number(f.birthYear) })}</b></div>
              {f.concerns.length > 0 && <div><span>{t('onboarding.sumConcerns')}</span><b>{f.concerns.map(c => t(`onboarding.c_${c}`).toLocaleLowerCase(lang)).join(', ')}</b></div>}
              <div><span>{t('onboarding.sumAssistant')}</span><b>{assistant}</b></div>
              <div><span>{t('onboarding.sumLang')}</span><b>{LANG_LABEL[lang]}</b></div>
            </div>
            <label className="check"><input type="checkbox" checked={f.consentData} onChange={e => set({ consentData: e.target.checked })} /><span>{t('onboarding.consentData')} <small>{t('onboarding.consentDemo')}</small></span></label>
            <label className="check"><input type="checkbox" checked={f.consentAi} onChange={e => set({ consentAi: e.target.checked })} /><span>{t('onboarding.consentAi', { name: assistant })}</span></label>
          </>}

          {err && <p className="form-error" role="alert">{err}</p>}
        </section>

        <div className="onb-nav">
          {step > 0 ? <button className="btn ghost" onClick={() => { setErr(''); setStep(step - 1); }}><ArrowLeft size={18} /> {t('onboarding.back')}</button> : <span />}
          <button className="btn primary big" onClick={next} disabled={busy}>{last ? (busy ? t('onboarding.saving') : t('onboarding.start')) : t('onboarding.next')} <ArrowRight size={18} /></button>
        </div>
      </main>
    </div>
  );
}
