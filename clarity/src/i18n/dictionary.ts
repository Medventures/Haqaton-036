import type { Lang } from '../../shared/i18n';
import common from './dict/common';
import patient from './dict/patient';
import assistant from './dict/assistant';
import auth from './dict/auth';
import onboarding from './dict/onboarding';
import modals from './dict/modals';
import cards from './dict/cards';
import staff from './dict/staff';
import voice from './dict/voice';
import docs from './dict/docs';

const NS = { common, patient, assistant, auth, onboarding, modals, cards, staff, voice, docs } as const;

export const DICT: Record<Lang, Record<string, string>> = { ru: {}, kk: {} };
for (const [ns, d] of Object.entries(NS)) {
  for (const lang of ['ru', 'kk'] as const) {
    for (const [k, v] of Object.entries(d[lang] as Record<string, string>)) DICT[lang][`${ns}.${k}`] = v;
  }
}
