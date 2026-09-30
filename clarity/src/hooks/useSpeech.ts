// Совместимая обёртка над голосовым движком (useVoice) со старым интерфейсом useSpeech:
// speak(text, {voice, rate?, onEnd?, lang?}), listen(onFinal, {onError?, onNoSpeech?, lang?}).
// Язык по умолчанию — язык документа (его выставляет LangProvider), иначе русский.
// Новый код должен использовать useClarity().speech или useVoice() напрямую.

import { useCallback, useMemo } from 'react';
import { isLang, type Lang } from '../../shared/i18n';
import { useVoice } from './useVoice';

export { sentences, speakable } from '../voice/text';
export { pickVoice } from '../voice/engine';

export interface SpeakOptions { voice: boolean; rate?: number; onEnd?: () => void; lang?: Lang }
export interface LegacyListenOptions { onError?: (msg: string) => void; onNoSpeech?: () => void; lang?: Lang }

const docLang = (): Lang => {
  const l = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return isLang(l) ? l : 'ru';
};

export function useSpeech() {
  const v = useVoice();
  const { speak: vSpeak, listen: vListen } = v;
  const speak = useCallback((text: string, opts: SpeakOptions) => vSpeak(text, { ...opts, lang: opts.lang ?? docLang() }), [vSpeak]);
  const listen = useCallback((onFinal: (text: string) => void, opts: LegacyListenOptions = {}) => vListen(onFinal, { ...opts, lang: opts.lang ?? docLang() }), [vListen]);
  return useMemo(() => ({ ...v, speak, listen }), [v, speak, listen]);
}

export type Speech = ReturnType<typeof useSpeech>;
