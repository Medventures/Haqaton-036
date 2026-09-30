import type { Lang } from '../../shared/i18n';

/** Состояние рта в текущем кадре (0..1). Читается аватаром в requestAnimationFrame. */
export interface MouthFrame {
  open: number;   // раскрытие челюсти (А)
  round: number;  // округление губ (О, У)
  wide: number;   // растяжение (Э, И)
  closed: number; // сомкнутые губы (М, Б, П)
  level: number;  // общая громкость
}
export const SILENT: MouthFrame = { open: 0, round: 0, wide: 0, closed: 0, level: 0 };

export interface SpeakOptions { voice: boolean; lang: Lang; rate?: number; onEnd?: () => void }
export interface ListenOptions { lang: Lang; onError?: (msg: string) => void; onNoSpeech?: () => void }

export interface VoiceApi {
  speak(text: string, opts: SpeakOptions): void;
  stopSpeaking(): void;
  speaking: boolean;
  /**
   * Реплика принята, но звук ещё синтезируется (первая фраза казахского Piper — 2–3 с).
   * UI показывает «думает…» и не двигает губами. Необязательное поле (старые реализации).
   */
  preparing?: boolean;
  /** Текущая произносимая фраза (субтитры). */
  caption: string;
  /** Упрощённая открытость рта 0..1 (обновляется ~15 раз/с — для простых потребителей). */
  mouth: number;
  /** Точный кадр рта для липсинка — вызывать в requestAnimationFrame. */
  getMouthFrame(): MouthFrame;
  listen(onFinal: (text: string) => void, opts: ListenOptions): void;
  stopListening(): void;
  abortListening(): void;
  listening: boolean;
  interim: string;
  ttsSupported: boolean;
  sttSupported: boolean;
}
