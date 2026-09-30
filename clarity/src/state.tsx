import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Achievement, AssistantAction, AssistantMessage, HealthInfo, Mood, PatientState, Reminder } from '../shared/types';
import { api, ApiError } from './api';
import { useVoice } from './hooks/useVoice';
import type { VoiceApi } from './voice/types';
import { AVATAR_NAME, type AvatarId, type Lang } from '../shared/i18n';
import { useT } from './i18n';

interface SendOptions { mode?: 'text' | 'voice'; silent?: boolean }

interface Ctx {
  state: PatientState | null;
  setState: (s: PatientState) => void;
  health: HealthInfo | null;
  error: string;
  refresh: () => Promise<void>;
  run: <T>(fn: () => Promise<T>, ok?: string) => Promise<T | undefined>;
  toast: string;
  showToast: (t: string) => void;
  // ассистент
  messages: AssistantMessage[];
  busy: boolean;
  send: (req: { text?: string; action?: AssistantAction }, opts?: SendOptions) => Promise<AssistantMessage[]>;
  panelOpen: boolean;
  openAssistant: (action?: AssistantAction) => void;
  closeAssistant: () => void;
  callOpen: boolean;
  openCall: () => void;
  closeCall: () => void;
  mood: Mood;
  setMood: (m: Mood) => void;
  voiceOn: boolean;
  setVoiceOn: (v: boolean) => void;
  largeText: boolean;
  setLargeText: (v: boolean) => void;
  speech: VoiceApi;
  lang: Lang;
  avatar: AvatarId;
  assistantName: string;
  setAvatar: (a: AvatarId) => Promise<void>;
  notifications: Reminder[];
  unread: number;
  markRead: () => void;
  celebration: Achievement | null;
  dismissCelebration: () => void;
}

const ClarityContext = createContext<Ctx | null>(null);

const readPref = (k: string): boolean | null => { try { const v = localStorage.getItem(k); return v === null ? null : v === '1'; } catch { return null; } };
const writePref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* приватный режим */ } };

export function ClarityProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<PatientState | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [mood, setMood] = useState<Mood>('happy');
  const [voiceOn, setVoiceOnRaw] = useState(() => readPref('clarity-voice') ?? true);
  const [largeText, setLargeTextRaw] = useState(() => readPref('clarity-large') ?? false);
  const [notifications, setNotifications] = useState<Reminder[]>([]);
  const [celebration, setCelebration] = useState<Achievement | null>(null);
  const speech = useVoice();
  const { lang } = useT();
  const seen = useRef(new Set<string>());
  const started = useRef(false);
  const knownBadges = useRef<Set<string> | null>(null);

  const showToast = useCallback((t: string) => setToast(t), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);

  // Новые значки → праздник. Первые загруженные значки считаем «уже виденными».
  const setState = useCallback((s: PatientState) => {
    setStateRaw(s);
    const key = `clarity-badges-${s.profile.id}`;
    const earned = s.progress.achievements.filter(a => a.earned).map(a => a.id);
    if (!knownBadges.current) {
      let stored: string[] | null = null;
      try { stored = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* нет хранилища */ }
      // Впервые на этом устройстве: празднуем только «Знакомство», и только если оно было только что.
      const justOnboarded = s.profile.onboarding && Date.now() - new Date(s.profile.onboarding.completedAt).getTime() < 10 * 60_000;
      knownBadges.current = new Set(stored ?? earned.filter(id => !(id === 'welcome' && justOnboarded)));
    }
    const fresh = earned.filter(id => !knownBadges.current!.has(id));
    if (fresh.length) {
      fresh.forEach(id => knownBadges.current!.add(id));
      try { localStorage.setItem(key, JSON.stringify([...knownBadges.current])); } catch { /* ignore */ }
      setCelebration(s.progress.achievements.find(a => a.id === fresh[fresh.length - 1]) ?? null);
    }
  }, []);

  // Крупный шрифт: из анкеты знакомства, если пользователь не переключал вручную.
  useEffect(() => {
    if (state && readPref('clarity-large') === null && state.profile.onboarding?.largeText) setLargeTextRaw(true);
    if (state && readPref('clarity-voice') === null && state.profile.onboarding && !state.profile.onboarding.voice) setVoiceOnRaw(false);
  }, [state?.profile.onboarding]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.classList.toggle('large-text', largeText); }, [largeText]);
  const setLargeText = useCallback((v: boolean) => { setLargeTextRaw(v); writePref('clarity-large', v); }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, h, hist] = await Promise.all([api.state(), api.health(), api.history()]);
      setState(s); setHealth(h); setMessages(hist.messages); setError('');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Ошибка загрузки'); }
  }, [setState]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string) => {
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'journey' in (r as object)) setState(r as unknown as PatientState);
      if (ok) setToast(ok);
      return r;
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Не удалось выполнить действие');
      return undefined;
    }
  }, [setState]);

  const setVoiceOn = useCallback((v: boolean) => { setVoiceOnRaw(v); writePref('clarity-voice', v); if (!v) speech.stopSpeaking(); }, [speech]);

  const send = useCallback(async (req: { text?: string; action?: AssistantAction }, opts: SendOptions = {}) => {
    setBusy(true);
    setMood('thinking');
    speech.stopSpeaking();
    try {
      const r = await api.chat({ ...req, mode: opts.mode ?? 'text' });
      setState(r.state);
      setMessages(prev => [...prev, ...r.messages]);
      const replies = r.messages.filter(m => m.role === 'assistant');
      setMood(replies.at(-1)?.mood ?? 'neutral');
      const say = replies.map(m => m.text).join(' ');
      if (say && !opts.silent) speech.speak(say, { voice: voiceOn, lang });
      return replies;
    } catch (e) {
      setMood('concerned');
      const err: AssistantMessage = { id: `err-${Date.now()}`, role: 'assistant', text: e instanceof Error ? e.message : 'Ошибка связи', mood: 'concerned', at: new Date().toISOString() };
      setMessages(prev => [...prev, err]);
      return [err];
    } finally {
      setBusy(false);
    }
  }, [speech, voiceOn, setState, lang]);

  const openAssistant = useCallback((action?: AssistantAction) => {
    setPanelOpen(true);
    if (action) { send({ action }); return; }
    if (!started.current && messages.length === 0) { started.current = true; send({ action: { type: 'start' } }); }
  }, [messages.length, send]);

  const closeAssistant = useCallback(() => { setPanelOpen(false); speech.stopSpeaking(); speech.abortListening(); }, [speech]);
  const openCall = useCallback(() => { setPanelOpen(false); setCallOpen(true); }, []);
  const closeCall = useCallback(() => { setCallOpen(false); speech.stopSpeaking(); speech.abortListening(); setMood('happy'); }, [speech]);

  // Опрос напоминаний: in-app + уведомления браузера.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { notifications: list } = await api.notifications();
        if (!alive) return;
        setNotifications(list);
        const fresh = list.filter(n => !n.readAt && !seen.current.has(n.id));
        fresh.forEach(n => seen.current.add(n.id));
        if (fresh.length) {
          const n = fresh[0];
          setToast(`🔔 ${n.title}`);
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(n.title, { body: n.body, tag: n.id }); } catch { /* iOS */ }
          }
        }
      } catch { /* сервер недоступен — покажет общий баннер */ }
    };
    poll();
    const t = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [state?.journey.reminderPlan, health?.timeOffsetHours]);

  const avatar: AvatarId = state?.profile.avatar ?? 'aruzhan';
  const assistantName = AVATAR_NAME[avatar][lang];
  const setAvatar = useCallback(async (a: AvatarId) => { await api.prefs({ avatar: a }); await refresh(); }, [refresh]);
  // Язык сменился — перечитываем состояние, чтобы сервер отдал контент на нём.
  const firstLang = useRef(true);
  useEffect(() => { if (firstLang.current) { firstLang.current = false; return; } void refresh(); }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = useCallback(() => { api.readNotifications().then(() => setNotifications(n => n.map(x => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })))).catch(() => undefined); }, []);

  const value = useMemo<Ctx>(() => ({
    state, setState, health, error, refresh, run, toast, showToast, messages, busy, send, panelOpen, openAssistant, closeAssistant, callOpen, openCall, closeCall,
    mood, setMood, voiceOn, setVoiceOn, largeText, setLargeText, speech, lang, avatar, assistantName, setAvatar, notifications, unread: notifications.filter(n => !n.readAt).length, markRead,
    celebration, dismissCelebration: () => setCelebration(null),
  }), [state, setState, health, error, refresh, run, toast, showToast, messages, busy, send, panelOpen, openAssistant, closeAssistant, callOpen, openCall, closeCall, mood, voiceOn, setVoiceOn, largeText, setLargeText, speech, lang, avatar, assistantName, setAvatar, notifications, markRead, celebration]);

  return <ClarityContext.Provider value={value}>{children}</ClarityContext.Provider>;
}

export function useClarity() {
  const c = useContext(ClarityContext);
  if (!c) throw new Error('ClarityProvider missing');
  return c;
}
