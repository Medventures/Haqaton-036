// Голосовой разговор с ассистентом (Аружан / Клэри) в режиме «звонка»:
// ассистент говорит → автоматически слушает → ответ пациента → ассистент отвечает → …
// Можно перебить, выключить микрофон, ответить кнопкой; карточки (слоты, план) видны под аватаром.
// Язык можно сменить прямо в звонке: речь и распознавание прерываются, ассистент здоровается заново.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Mic, MicOff, PhoneOff, Send, SkipForward } from 'lucide-react';
import type { AssistantMessage } from '../../shared/types';
import AssistantAvatar from './AssistantAvatar';
import { CardView } from './Cards';
import { useClarity } from '../state';
import { useT } from '../i18n';
import LangSwitch from '../components/LangSwitch';
import { OrnamentBand, OrnamentPattern } from '../brand/Ornament';

type Phase = 'starting' | 'speaking' | 'listening' | 'thinking' | 'paused' | 'unsupported';
const MIC_NOTICE_KEY = 'clarity-mic-notice';

/** Ширина портрета: ≈260–300 px на телефоне, больше на десктопе; не выше, чем позволяет экран. */
function portraitWidth(): number {
  if (typeof window === 'undefined') return 300;
  const w = window.innerWidth, h = window.innerHeight;
  const byWidth = w < 480 ? Math.min(290, w - 56) : w < 900 ? 300 : 340;
  const byHeight = (h - 330) * 0.8; // портрет 4:5, остальное — подпись, кнопки, ввод
  return Math.round(Math.max(200, Math.min(byWidth, byHeight)));
}

export default function VoiceCall() {
  const { callOpen, closeCall, send, speech, messages, state, voiceOn, mood, showToast, lang, avatar, assistantName } = useClarity();
  const { t } = useT();
  const [phase, setPhaseRaw] = useState<Phase>('starting');
  const [muted, setMuted] = useState(false);
  const [typed, setTyped] = useState('');
  const [size, setSize] = useState(portraitWidth);
  const [consent, setConsent] = useState(() => { try { return localStorage.getItem(MIC_NOTICE_KEY) === '1'; } catch { return false; } });
  const silence = useRef(0);
  const alive = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  // Актуальные язык и настройки голоса для цикла разговора (колбэки живут дольше одного рендера).
  const langRef = useRef(lang);
  langRef.current = lang;
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;
  const phaseRef = useRef<Phase>(phase);
  const setPhase = useCallback((p: Phase) => { phaseRef.current = p; setPhaseRaw(p); }, []);
  // Цикл разговора вызывает функции через ref, чтобы всегда брать актуальные версии.
  const respondRef = useRef<(req: { text?: string; action?: Parameters<typeof send>[0]['action'] }) => Promise<void>>(async () => undefined);
  const listenRef = useRef<() => void>(() => undefined);

  const lastAssistant: AssistantMessage | undefined = [...messages].reverse().find(m => m.role === 'assistant');
  const quick = messages.at(-1)?.role === 'assistant' ? messages.at(-1)?.quickReplies : undefined;
  const card = lastAssistant?.cards?.find(c => ['slots', 'screening_summary', 'report', 'booking', 'emergency', 'reminders'].includes(c.type));
  const patientName = state?.profile.onboarding?.preferredName ?? state?.profile.displayName.split(' ')[0] ?? '';
  const nm = { name: assistantName };

  useEffect(() => {
    if (!callOpen) return;
    const onResize = () => setSize(portraitWidth());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [callOpen]);

  const listenLoop = useCallback(() => {
    if (!alive.current) return;
    if (mutedRef.current) { setPhase('paused'); return; }
    if (!speech.sttSupported) { setPhase('unsupported'); return; }
    setPhase('listening');
    speech.listen(
      text => { silence.current = 0; void respondRef.current({ text }); },
      {
        lang: langRef.current,
        onNoSpeech: () => {
          silence.current++;
          if (silence.current >= 2 || !alive.current) { setPhase('paused'); return; }
          listenRef.current();
        },
        onError: msg => { showToast(msg); setPhase('paused'); },
      },
    );
  }, [speech, setPhase, showToast]);

  const speakThen = useCallback((text: string) => {
    if (!alive.current) return;
    setPhase('speaking');
    speech.speak(text, { voice: voiceRef.current, lang: langRef.current, onEnd: () => { if (alive.current) listenRef.current(); } });
  }, [speech, setPhase]);

  const respond = useCallback(async (req: { text?: string; action?: Parameters<typeof send>[0]['action'] }) => {
    setPhase('thinking');
    speech.abortListening();
    const replies = await send(req, { mode: 'voice', silent: true });
    if (!alive.current) return;
    speakThen(replies.map(m => m.text).join(' '));
  }, [send, speech, speakThen, setPhase]);

  respondRef.current = respond;
  listenRef.current = listenLoop;

  // Старт звонка: приветствие (или короткое «слушаю», если разговор уже был).
  useEffect(() => {
    if (!callOpen || !consent) return;
    alive.current = true;
    silence.current = 0;
    setPhase('starting');
    if (messages.length === 0) void respond({ action: { type: 'start' } });
    else speakThen(patientName ? t('assistant.resumeNamed', { name: patientName }) : t('assistant.resume'));
    return () => { alive.current = false; speech.stopSpeaking(); speech.abortListening(); };
  }, [callOpen, consent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Смена языка во время звонка: прерываем речь и распознавание, здороваемся на новом языке и продолжаем цикл.
  const prevLang = useRef(lang);
  useEffect(() => {
    if (prevLang.current === lang) return;
    prevLang.current = lang;
    if (!callOpen || !consent || !alive.current) return;
    speech.stopSpeaking();
    speech.abortListening();
    silence.current = 0;
    // Если ответ ещё готовится — он сам продолжит цикл; иначе приветствуем на новом языке.
    if (phaseRef.current === 'thinking') return;
    speakThen(t('assistant.langSwitched'));
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!callOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCall(); if (e.key === ' ' && phase === 'speaking' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); interrupt(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!callOpen) return null;

  // Реплика принята, но первая фраза ещё синтезируется — показываем «думает…», а не немой «говорит».
  const preparing = phase === 'speaking' && Boolean(speech.preparing);
  const shownPhase: Phase = preparing ? 'thinking' : phase;

  const interrupt = () => { speech.stopSpeaking(); listenLoop(); };
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    mutedRef.current = m;
    if (m) { speech.abortListening(); if (phase === 'listening') setPhase('paused'); }
    else if (phase === 'paused') { silence.current = 0; listenLoop(); }
  };
  const resume = () => { silence.current = 0; setMuted(false); mutedRef.current = false; listenLoop(); };
  const submitTyped = () => { const v = typed.trim(); if (!v) return; setTyped(''); void respond({ text: v }); };

  const label: Record<Phase, string> = {
    starting: t('assistant.callConnecting'),
    speaking: t('assistant.callSpeaking', nm),
    listening: t('assistant.callListening'),
    thinking: t('assistant.callThinking', nm),
    paused: muted ? t('assistant.callMicOff') : t('assistant.callPaused'),
    unsupported: t('assistant.callUnsupported'),
  };

  const background = (
    <>
      <div className="call-bg" aria-hidden><OrnamentPattern className="kz-on-dark" color="#E7C86A" opacity={0.08} tile={120} /></div>
      <div className="call-band" aria-hidden><OrnamentBand className="kz-on-dark" height={14} color="#C9A23A" accent="#E7C86A" opacity={0.6} /></div>
    </>
  );

  if (!consent) {
    return (
      <div className={`call call-v4 av-${avatar}`} role="dialog" aria-modal="true" aria-label={t('assistant.callAria', nm)} lang={lang}>
        {background}
        <div className="call-consent">
          <div className="call-consent-avatar"><AssistantAvatar avatar={avatar} mood="happy" size={avatar === 'aruzhan' ? 190 : 170} framing="head" /></div>
          <h2>{t('assistant.consentTitle')}</h2>
          <span className="ai-badge">{t('assistant.aiBadgeLong')}</span>
          <p>{t('assistant.consentText', nm)}</p>
          <div className="call-consent-lang"><span>{t('assistant.consentLang')}</span><LangSwitch className="on-dark" /></div>
          <p className="call-privacy">{t('assistant.consentPrivacy')}</p>
          <div className="call-consent-actions">
            <button className="btn ghost" onClick={closeCall}>{t('assistant.notNow')}</button>
            <button className="btn primary" onClick={() => { try { localStorage.setItem(MIC_NOTICE_KEY, '1'); } catch { /* ignore */ } setConsent(true); }}><Mic size={18} /> {t('assistant.startCall')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`call call-v4 av-${avatar} phase-${shownPhase}`} role="dialog" aria-modal="true" aria-label={t('assistant.callAria', nm)} lang={lang}>
      {background}
      <header className="call-top">
        <span className="ai-badge">{t('assistant.aiBadgeLong')}</span>
        <div className="call-top-tools">
          <LangSwitch compact className="on-dark" />
          <button className="call-x" onClick={closeCall} aria-label={t('assistant.endCall')} title={t('assistant.endCall')}>×</button>
        </div>
      </header>

      <div className="call-stage">
        <div className="call-rings" aria-hidden><i /><i /><i /></div>
        <div className="call-portrait" style={{ width: size }}>
          <span className="call-glow" aria-hidden />
          <button className="call-avatar" onClick={phase === 'speaking' ? interrupt : phase === 'paused' ? resume : undefined} aria-label={phase === 'speaking' ? t('assistant.interruptName', nm) : t('assistant.speak')}>
            <AssistantAvatar avatar={avatar} mood={mood} speaking={speech.speaking && !preparing} mouth={speech.mouth} mouthSource={speech.getMouthFrame} listening={speech.listening} thinking={shownPhase === 'thinking'} size={size} framing="bust" />
          </button>
        </div>
        <div className="call-status" aria-live="polite"><i />{label[shownPhase]}</div>
        <p className="call-caption" aria-live="polite">
          {phase === 'listening' ? (speech.interim ? <span className="you">«{speech.interim}»</span> : <span className="hint">{t('assistant.callHintListening')}</span>) : (speech.caption || lastAssistant?.text || '')}
        </p>
      </div>

      {card && <div className="call-card"><CardView card={card} /></div>}

      {quick && quick.length > 0 && phase !== 'thinking' && (
        <div className="call-quick">{quick.slice(0, 4).map(q => <button key={q.label} onClick={() => { speech.stopSpeaking(); void respond({ action: q.action }); }}>{q.label}</button>)}</div>
      )}

      <footer className="call-controls">
        <button className={`round ${muted ? 'off' : ''}`} onClick={toggleMute} aria-label={muted ? t('assistant.micTurnOn') : t('assistant.micTurnOff')}>{muted ? <MicOff size={24} /> : <Mic size={24} />}<span>{muted ? t('assistant.micOffShort') : t('assistant.mic')}</span></button>
        <button className="round end" onClick={closeCall} aria-label={t('assistant.endCall')}><PhoneOff size={26} /><span>{t('assistant.end')}</span></button>
        {phase === 'speaking'
          ? <button className="round" onClick={interrupt} aria-label={t('assistant.interrupt')}><SkipForward size={24} /><span>{t('assistant.interrupt')}</span></button>
          : <button className="round" onClick={phase === 'paused' || phase === 'unsupported' ? resume : () => speech.stopListening()} aria-label={t('assistant.speak')} disabled={phase === 'thinking' || phase === 'unsupported'}><Mic size={24} /><span>{phase === 'listening' ? t('assistant.done') : t('assistant.speak')}</span></button>}
      </footer>

      <div className="call-type">
        <Keyboard size={16} aria-hidden />
        <input value={typed} lang={lang} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitTyped(); }} placeholder={t('assistant.typePlaceholder')} aria-label={t('assistant.typeAria', nm)} maxLength={1000} />
        <button onClick={submitTyped} disabled={!typed.trim() || phase === 'thinking'} aria-label={t('assistant.send')}><Send size={16} /></button>
      </div>
    </div>
  );
}
