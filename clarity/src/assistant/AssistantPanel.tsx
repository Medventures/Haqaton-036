import { useEffect, useRef, useState } from 'react';
import { FileText, FlaskConical, Mic, MicOff, Paperclip, Phone, Send, Square, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import type { AssistantAction } from '../../shared/types';
import { api } from '../api';
import { ACCEPT_FILES, classifyError, extractLabs, extractReport, previewUrl, setDocsIntent, type DocError, type DocKind } from '../patient/docs/upload';
import AssistantAvatar from './AssistantAvatar';
import { CardView } from './Cards';
import { useClarity } from '../state';
import { useT } from '../i18n';
import LangSwitch from '../components/LangSwitch';

const MIC_NOTICE_KEY = 'clarity-mic-notice';

type Attach = null
  | { phase: 'extracting'; kind: DocKind }
  | { phase: 'error'; kind: DocKind; err: DocError }
  | { phase: 'report'; text: string; warning?: string };

/** Быстрая проверка распознанного текста заключения прямо в чате. */
function ReportConfirm({ initial, warning, onCancel, onExplain }: { initial: string; warning?: string; onCancel: () => void; onExplain: (text: string) => void }) {
  const { t } = useT();
  const [text, setText] = useState(initial);
  return (
    <div className="as-report-confirm" role="dialog" aria-label={t('docs.chatReportTitle')}>
      <b>{t('docs.chatReportTitle')}</b>
      {warning && <small>{warning}</small>}
      <textarea rows={5} value={text} onChange={e => setText(e.target.value)} maxLength={6000} placeholder={t('docs.pastePh')} aria-label={t('docs.textAria')} autoFocus />
      <div>
        <button onClick={onCancel}>{t('docs.chatCancel')}</button>
        <button className="primary" disabled={text.trim().length < 10} onClick={() => onExplain(text.trim())}>{t('docs.chatReportExplain')}</button>
      </div>
    </div>
  );
}

export default function AssistantPanel() {
  const { panelOpen, closeAssistant, openCall, messages, send, busy, mood, speech, voiceOn, setVoiceOn, health, showToast, lang, avatar, assistantName, run } = useClarity();
  const { t } = useT();
  const [text, setText] = useState('');
  const [micNotice, setMicNotice] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [attach, setAttach] = useState<Attach>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachKind = useRef<DocKind>('labs');
  const attachWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!attachMenu) return;
    const close = (e: PointerEvent) => { if (!attachWrap.current?.contains(e.target as Node)) setAttachMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAttachMenu(false); } };
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc, true); };
  }, [attachMenu]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);
  useEffect(() => { if (panelOpen) setTimeout(() => inputRef.current?.focus(), 250); }, [panelOpen]);
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAssistant(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closeAssistant]);
  // Сменили язык во время диктовки — прерываем распознавание на старом языке.
  const prevLang = useRef(lang);
  useEffect(() => {
    if (prevLang.current === lang) return;
    prevLang.current = lang;
    speech.abortListening();
    speech.stopSpeaking();
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!panelOpen) return null;

  const name = { name: assistantName };
  const submit = () => {
    const v = text.trim();
    if (!v || busy) return;
    setText('');
    void send({ text: v });
  };

  const dictate = () => speech.listen(v => void send({ text: v }), { lang, onError: msg => showToast(msg) });
  const startMic = () => {
    let ok = false;
    try { ok = localStorage.getItem(MIC_NOTICE_KEY) === '1'; } catch { /* ignore */ }
    if (!ok) { setMicNotice(true); return; }
    dictate();
  };

  // Вложения: анализы → проверка в «Документах», заключение → проверка текста здесь же.
  const openPage = (page: string) => { closeAssistant(); location.hash = `#/${page}`; };
  const chooseDoc = (kind: DocKind) => { attachKind.current = kind; setAttachMenu(false); fileRef.current?.click(); };
  const onDocFile = async (file: File) => {
    const kind = attachKind.current;
    setAttach({ phase: 'extracting', kind });
    try {
      if (kind === 'labs') {
        const draft = await extractLabs(file);
        setAttach(null);
        setDocsIntent({ tab: 'labs', draft, preview: previewUrl(file) });
        showToast(t('docs.chatLabsReady'));
        openPage('documents');
      } else {
        const x = await extractReport(file);
        setAttach({ phase: 'report', text: x.text, warning: x.warning });
      }
    } catch (e) { setAttach({ phase: 'error', kind, err: classifyError(e) }); }
  };
  const explainReport = async (reportText: string) => {
    setAttach({ phase: 'extracting', kind: 'report' });
    const r = await run(() => api.report(reportText));
    setAttach(null);
    if (r) void send({ action: { type: 'report_uploaded' } });
  };
  const quick = (action: AssistantAction) => {
    if (action.type === 'open_page') { openPage(action.page); return; }
    void send({ action });
  };

  const lastQuick = messages.at(-1)?.role === 'assistant' ? messages.at(-1)?.quickReplies : undefined;
  const status = busy ? t('assistant.statusThinking') : speech.listening ? t('assistant.statusListening') : speech.speaking ? t('assistant.statusSpeaking') : t('assistant.statusOnline');

  return (
    <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeAssistant(); }}>
      <aside className={`assistant av-${avatar}`} role="dialog" aria-modal="true" aria-label={t('assistant.panelAria', name)}>
        <header className="as-head">
          <AssistantAvatar avatar={avatar} mood={mood} speaking={speech.speaking} mouth={speech.mouth} mouthSource={speech.getMouthFrame} listening={speech.listening} thinking={busy} size={64} framing="head" className="as-head-avatar" />
          <div className="as-who">
            <b>{assistantName}</b>
            <span className={`as-status ${busy ? 'thinking' : speech.listening ? 'listening' : speech.speaking ? 'speaking' : ''}`}><i />{status}</span>
            <span className="ai-badge">{t('assistant.aiBadge')}</span>
          </div>
          <div className="as-tools">
            <LangSwitch compact className="as-lang" />
            <button onClick={openCall} className="as-call" aria-label={t('assistant.toCall')} title={t('assistant.toCallTitle')}><Phone size={18} /></button>
            <button onClick={() => setVoiceOn(!voiceOn)} aria-label={voiceOn ? t('assistant.voiceTurnOff') : t('assistant.voiceTurnOn')} title={voiceOn ? t('assistant.voiceIsOn') : t('assistant.voiceIsOff')}>{voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
            {speech.speaking && <button onClick={speech.stopSpeaking} aria-label={t('assistant.stopSpeech')} title={t('assistant.stopSpeech')}><Square size={16} /></button>}
            <button onClick={closeAssistant} aria-label={t('assistant.close')} title={t('assistant.close')}><X size={20} /></button>
          </div>
        </header>

        <div className="as-list" ref={listRef} aria-live="polite">
          {messages.length === 0 && !busy && <div className="as-empty">{t('assistant.starting')}</div>}
          {messages.map(m => (
            <div key={m.id} className={`as-msg ${m.role}`}>
              {m.text && <div className="as-bubble">{m.text}{m.role === 'assistant' && m.by === 'llm' && <span className="as-ai-tag" title={t('assistant.aiTagTitle', { model: health?.llm.model ?? '' })}>{t('assistant.aiTag')}</span>}</div>}
              {m.cards?.map((c, i) => <CardView key={i} card={c} />)}
            </div>
          ))}
          {busy && <div className="as-msg assistant"><div className="as-bubble typing"><i /><i /><i /></div></div>}
        </div>

        {lastQuick && lastQuick.length > 0 && !busy && (
          <div className="as-quick">{lastQuick.map(q => <button key={q.label} onClick={() => quick(q.action)}>{q.label}</button>)}</div>
        )}

        {micNotice && (
          <div className="as-notice" role="alertdialog" aria-label={t('assistant.micNoticeAria')}>
            <p>{t('assistant.micNotice')}</p>
            <div>
              <button onClick={() => setMicNotice(false)}>{t('assistant.cancel')}</button>
              <button className="primary" onClick={() => { try { localStorage.setItem(MIC_NOTICE_KEY, '1'); } catch { /* ignore */ } setMicNotice(false); dictate(); }}>{t('assistant.micAccept')}</button>
            </div>
          </div>
        )}

        {attach?.phase === 'extracting' && <div className="as-attach-status" role="status"><span className="as-bubble typing"><i /><i /><i /></span>{t('docs.chatExtracting')}</div>}
        {attach?.phase === 'error' && (
          <div className="as-notice as-attach-err" role="alert">
            <p><TriangleAlert size={16} /> <b>{t(`docs.err.${attach.err.code}`)}</b><br />{t(`docs.errHint.${attach.err.code}${attach.err.code === 'llm_unavailable' || attach.err.code === 'not_recognized' ? `_${attach.kind}` : ''}`)}</p>
            <div>
              <button onClick={() => setAttach(null)}>{t('docs.chatCancel')}</button>
              <button className="primary" onClick={() => { setAttach(null); if (attach.kind === 'labs') { setDocsIntent({ tab: 'labs', manual: true }); openPage('documents'); } else setAttach({ phase: 'report', text: '' }); }}>{t(attach.kind === 'labs' ? 'docs.manual' : 'docs.paste')}</button>
            </div>
          </div>
        )}
        {attach?.phase === 'report' && <ReportConfirm initial={attach.text} warning={attach.warning} onCancel={() => setAttach(null)} onExplain={explainReport} />}

        <footer className="as-input">
          <input ref={fileRef} type="file" accept={ACCEPT_FILES} hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onDocFile(f); }} />
          <div className="as-attach-wrap" ref={attachWrap}>
            <button className={`as-attach ${attachMenu ? 'on' : ''}`} onClick={() => setAttachMenu(v => !v)} disabled={busy || attach?.phase === 'extracting'} aria-label={t('docs.attach')} title={t('docs.attach')} aria-expanded={attachMenu} aria-haspopup="menu"><Paperclip size={20} /></button>
            {attachMenu && (
              <div className="as-attach-menu" role="menu">
                <button role="menuitem" onClick={() => chooseDoc('labs')}><FlaskConical size={20} /><span><b>{t('docs.attachLabs')}</b><small>{t('docs.attachLabsHint')}</small></span></button>
                <button role="menuitem" onClick={() => chooseDoc('report')}><FileText size={20} /><span><b>{t('docs.attachReport')}</b><small>{t('docs.attachReportHint')}</small></span></button>
              </div>
            )}
          </div>
          {speech.sttSupported && (
            <button className={`as-mic ${speech.listening ? 'on' : ''}`} onClick={speech.listening ? speech.stopListening : startMic} aria-label={speech.listening ? t('assistant.micStop') : t('assistant.micStart')} title={speech.listening ? t('assistant.micStop') : t('assistant.micStart')}>
              {speech.listening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          )}
          <textarea ref={inputRef} rows={1} lang={lang} value={speech.listening ? speech.interim : text} onChange={e => setText(e.target.value)} placeholder={speech.listening ? t('assistant.speakNow') : t('assistant.placeholder')} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} maxLength={6000} aria-label={t('assistant.inputAria', name)} />
          <button className="as-send" onClick={submit} disabled={!text.trim() || busy} aria-label={t('assistant.send')} title={t('assistant.send')}><Send size={19} /></button>
        </footer>
        <p className="as-legal">{t('assistant.legal', name)}{health && !health.llm.available ? ` ${t('assistant.rulesMode')}` : ''}</p>
      </aside>
    </div>
  );
}
