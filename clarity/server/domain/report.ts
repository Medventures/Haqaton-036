// Детерминированный разбор текста заключения МРТ головного мозга.
// Тревожность формулировок определяется ПРАВИЛАМИ (словарь + отрицания), а не LLM:
// так поведение предсказуемо, проверяемо и тестируемо. LLM (если доступна)
// только перефразирует текст простым языком — см. assistant/dialog.ts.

import type { GlossaryHit, RedFlagHit, ReportExplanation, ReportSentence } from '../../shared/types';
import { specialtyLabel, type Lang } from '../../shared/i18n';
import { GLOSSARY_KK, RED_FLAG_KK, REPORT_KK } from '../i18n/kk/report';

interface GlossaryEntry { re: RegExp; term: string; plain: string }

export const GLOSSARY: GlossaryEntry[] = [
  { re: /срединн[а-яё]* структур/i, term: 'срединные структуры', plain: 'центральные отделы мозга; «не смещены» значит, что они на обычном месте' },
  { re: /очагов[а-яё]* изменени|очаг(?!ов[а-яё]* глиоз)[а-яё]*/i, term: 'очаг / очаговые изменения', plain: 'небольшой участок, который на снимке выглядит иначе, чем окружающая ткань' },
  { re: /вещества? (?:головного )?мозга|бел[а-яё]+ веществ|сер[а-яё]+ веществ/i, term: 'вещество мозга', plain: 'ткань мозга; серое вещество — нервные клетки, белое — проводящие волокна' },
  { re: /желудоч/i, term: 'желудочки мозга', plain: 'естественные полости внутри мозга, заполненные жидкостью' },
  { re: /субарахноидальн/i, term: 'субарахноидальные пространства', plain: 'пространства с жидкостью вокруг мозга, под его оболочками' },
  { re: /борозд/i, term: 'борозды', plain: 'естественные углубления на поверхности мозга' },
  { re: /глиоз/i, term: 'глиоз', plain: 'участки «рубцевания» поддерживающих клеток мозга; часто встречаются с возрастом или после перенесённых изменений' },
  { re: /сосудист[а-яё]+ генез|микроангиопат|лейкоареоз/i, term: 'сосудистые изменения', plain: 'изменения, связанные с мелкими сосудами мозга; часто связаны с возрастом и давлением' },
  { re: /периваскулярн|вирхова/i, term: 'периваскулярные пространства', plain: 'узкие пространства вокруг сосудов; расширение часто бывает вариантом нормы' },
  { re: /арахноидальн[а-яё]* кист|кист/i, term: 'киста', plain: 'полость, заполненная жидкостью; многие кисты безобидны, значение оценивает врач' },
  { re: /синусит|слизист[а-яё]+ оболочк[а-яё]+ .*пазух|пазух/i, term: 'околоносовые пазухи', plain: 'полости в костях лица; утолщение слизистой часто связано с насморком или воспалением' },
  { re: /гиперинтенсивн/i, term: 'гиперинтенсивный сигнал', plain: 'участок выглядит на снимке светлее окружающих тканей в определённом режиме' },
  { re: /гипоинтенсивн/i, term: 'гипоинтенсивный сигнал', plain: 'участок выглядит на снимке темнее окружающих тканей' },
  { re: /T2|FLAIR|DWI|T1/i, term: 'режимы T1/T2/FLAIR/DWI', plain: 'разные режимы съёмки; в каждом ткани выглядят по-разному' },
  { re: /накоплени[а-яё]* контраст|контрастн[а-яё]+ усилени|контрастирова/i, term: 'накопление контраста', plain: 'как контрастное вещество распределилось в тканях; помогает врачу отличать разные изменения' },
  { re: /объ[её]мн[а-яё]+ образовани|новообразовани/i, term: 'объёмное образование', plain: 'участок ткани, который занимает место; что это такое, врач определяет с помощью дополнительных обследований' },
  { re: /демиелиниз/i, term: 'демиелинизация', plain: 'повреждение оболочки нервных волокон; причины бывают разными, оценивает невролог' },
  { re: /атрофи/i, term: 'атрофия', plain: 'уменьшение объёма ткани; небольшая степень может быть возрастной' },
  { re: /аневризм/i, term: 'аневризма', plain: 'местное расширение стенки сосуда' },
  { re: /гидроцефал/i, term: 'гидроцефалия', plain: 'избыточное количество жидкости в полостях мозга' },
  { re: /масс-?эффект/i, term: 'масс-эффект', plain: 'давление образования или отёка на соседние структуры' },
  { re: /ишеми|инфаркт/i, term: 'ишемия / инфаркт', plain: 'участок, где было нарушено кровоснабжение' },
  { re: /кровоизлияни|геморраг/i, term: 'кровоизлияние', plain: 'скопление крови вне сосуда' },
  { re: /метастаз/i, term: 'метастаз', plain: 'очаг, связанный с опухолевым процессом в другом органе; требует оценки врачом' },
  { re: /отёк|отек/i, term: 'отёк', plain: 'скопление жидкости в тканях' },
  { re: /аденом[а-яё]* гипофиз|микроаденом/i, term: 'аденома гипофиза', plain: 'разрастание ткани в небольшой железе у основания мозга; обычно доброкачественное, наблюдает эндокринолог' },
  { re: /мастоид/i, term: 'мастоидит / ячейки сосцевидного отростка', plain: 'изменения в кости за ухом; обычно оценивает ЛОР-врач' },
  { re: /МР-?признак|МР-?картин/i, term: 'МР-картина / МР-признаки', plain: 'то, как изменения выглядят на МРТ; это описание снимка, а не окончательный диагноз' },
  { re: /дислокаци|вклинени/i, term: 'дислокация', plain: 'смещение структур мозга со своего места' },
  { re: /вариант[а-яё]* (?:нормы|развития)/i, term: 'вариант нормы', plain: 'особенность строения, которая встречается у здоровых людей' },
];

interface RedFlagRule { id: string; re: RegExp; level: RedFlagHit['level']; specialty: string; explanation: string }

export const RED_FLAGS: RedFlagRule[] = [
  // urgent — немедленный контакт с клиникой в день получения
  { id: 'hemorrhage', re: /кровоизлияни|геморраги|гематом/i, level: 'urgent', specialty: 'Нейрохирург', explanation: 'Формулировка о возможном кровоизлиянии требует срочной оценки врачом.' },
  { id: 'acute_ischemia', re: /остр[а-яё]+ (?:ишеми|инфаркт|нарушени[а-яё]* мозгового)|ОНМК|ограничени[а-яё]* диффузии/i, level: 'urgent', specialty: 'Невролог', explanation: 'Признаки острого нарушения кровообращения требуют срочной оценки.' },
  { id: 'midline_shift', re: /смещени[а-яё]* срединн|срединн[а-яё]+ структур[а-яё]* смещен/i, level: 'urgent', specialty: 'Нейрохирург', explanation: 'Смещение центральных структур мозга требует срочной оценки врачом.' },
  { id: 'mass_effect', re: /масс-?эффект|вклинени|дислокаци/i, level: 'urgent', specialty: 'Нейрохирург', explanation: 'Давление на структуры мозга требует срочной оценки.' },
  { id: 'hydrocephalus', re: /окклюзионн[а-яё]* гидроцефал|острая гидроцефал/i, level: 'urgent', specialty: 'Нейрохирург', explanation: 'Нарушение оттока жидкости требует срочной оценки.' },
  { id: 'urgent_words', re: /экстренн|неотложн|срочн[а-яё]* консультац/i, level: 'urgent', specialty: 'Невролог', explanation: 'В заключении прямо рекомендован срочный контакт с врачом.' },
  // significant — консультация специалиста в плановом порядке, но без затягивания
  { id: 'mass', re: /объ[её]мн[а-яё]+ образовани|новообразовани|опухол/i, level: 'significant', specialty: 'Нейрохирург', explanation: 'Описано образование — его природу определяет специалист.' },
  { id: 'metastasis', re: /метастаз/i, level: 'significant', specialty: 'Онколог', explanation: 'Формулировка требует консультации онколога.' },
  { id: 'aneurysm', re: /аневризм/i, level: 'significant', specialty: 'Нейрохирург', explanation: 'Описано расширение сосуда — тактику определяет нейрохирург.' },
  { id: 'demyelination', re: /демиелиниз/i, level: 'significant', specialty: 'Невролог', explanation: 'Изменения белого вещества требуют консультации невролога.' },
  { id: 'pathologic_enhancement', re: /патологическ[а-яё]+ (?:накоплени|контрастировани|усилени)|кольцевидн[а-яё]* накоплени/i, level: 'significant', specialty: 'Невролог', explanation: 'Необычное накопление контраста оценивает врач.' },
  { id: 'pituitary', re: /аденом[а-яё]* гипофиз|микроаденом/i, level: 'significant', specialty: 'Эндокринолог', explanation: 'Изменения гипофиза обычно наблюдает эндокринолог.' },
  { id: 'hydrocephalus_any', re: /гидроцефал/i, level: 'significant', specialty: 'Невролог', explanation: 'Изменение объёма жидкости в мозге оценивает специалист.' },
  { id: 'suspicion', re: /подозрени[а-яё]* на|нельзя исключить|не исключ[а-яё]+/i, level: 'significant', specialty: 'Невролог', explanation: 'Врач указал на то, что требует уточнения.' },
  { id: 'further_workup', re: /рекоменд[а-яё]+ (?:консультац|дообследовани|контрол)/i, level: 'significant', specialty: 'Невролог', explanation: 'В заключении есть рекомендация дальнейших шагов.' },
  // minor — обсудить на ближайшем приёме у лечащего врача
  { id: 'gliosis', re: /глиоз|сосудист[а-яё]+ генез|микроангиопат|лейкоареоз/i, level: 'minor', specialty: 'Невролог', explanation: 'Частая находка; значение обсуждают с неврологом.' },
  { id: 'cyst', re: /кист/i, level: 'minor', specialty: 'Невролог', explanation: 'Кисты часто безобидны, но значение оценивает врач.' },
  { id: 'sinus', re: /синусит|пазух|мастоид/i, level: 'minor', specialty: 'ЛОР-врач', explanation: 'Изменения пазух обычно оценивает ЛОР-врач.' },
  { id: 'atrophy', re: /атрофи/i, level: 'minor', specialty: 'Невролог', explanation: 'Изменение объёма ткани обсуждают с неврологом.' },
];

// Отрицания, которые снимают находку в пределах одной клаузы.
// (\b в JS не работает с кириллицей, поэтому границы слов заданы явно.)
const NEGATION = /(?:^|[^а-яё])(?:не\s+(?:выявлен[а-яё]*|определя[а-яё]*|обнаружен[а-яё]*|визуализир[а-яё]*|отмеча[а-яё]*|получено|смещен[а-яё]*|расширен[а-яё]*|изменен[а-яё]*)|отсутству[а-яё]*|без\s+(?:признаков|патологическ[а-яё]*|очагов[а-яё]*|изменений|особенностей)|нет(?![а-яё])|данных\s+за\s+.*\s+нет)/i;
// «Не исключается» и «нельзя исключить» — это НЕ отрицание, а подозрение.
const NOT_NEGATION = /не\s+исключ|нельзя\s+исключ/i;

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .replace(/[«»"]/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 2);
}

function clauses(sentence: string): string[] {
  return sentence.split(/[,;:]|\s—\s|\sа\s(?=выявл)/).map(c => c.trim()).filter(Boolean);
}

export function isNegated(clause: string): boolean {
  if (NOT_NEGATION.test(clause)) return false;
  return NEGATION.test(clause);
}

/** Расширить совпадение до целых слов: «смещением срединн» → «смещением срединных структур». */
function wholeWords(text: string, start: number, len: number): string {
  let s = start, e = start + len;
  while (s > 0 && /[а-яёa-z-]/i.test(text[s - 1])) s--;
  while (e < text.length && /[а-яёa-z-]/i.test(text[e])) e++;
  // для коротких основ захватываем следующее слово («смещением срединных структур»)
  const next = text.slice(e).match(/^\s+[а-яё]+/i);
  if (next && e - s < 22 && /(?:ых|их|ого|ой|ая|ое|ым|ом)$/i.test(text.slice(s, e))) e += next[0].length;
  return text.slice(s, e).trim();
}

/** Находки в предложении. Детекция — по русскому тексту; lang влияет только на пояснения. */
export function findRedFlags(sentence: string, lang: Lang = 'ru'): RedFlagHit[] {
  const hits: RedFlagHit[] = [];
  for (const clause of clauses(sentence)) {
    if (isNegated(clause)) continue;
    for (const rule of RED_FLAGS) {
      const m = clause.match(rule.re);
      if (!m) continue;
      // Не дублируем одинаковую находку более общим правилом.
      if (rule.id === 'hydrocephalus_any' && hits.some(h => h.id === 'hydrocephalus')) continue;
      if (hits.some(h => h.id === rule.id)) continue;
      hits.push({
        id: rule.id, level: rule.level, phrase: wholeWords(clause, m.index ?? 0, m[0].length), sentence,
        specialty: rule.specialty, specialtyLabel: specialtyLabel(rule.specialty, lang),
        explanation: lang === 'kk' ? RED_FLAG_KK[rule.id] ?? rule.explanation : rule.explanation,
      });
    }
  }
  return hits;
}

export function findTerms(sentence: string, lang: Lang = 'ru'): GlossaryHit[] {
  const seen = new Set<string>();
  const out: GlossaryHit[] = [];
  for (const g of GLOSSARY) {
    if (g.re.test(sentence) && !seen.has(g.term)) {
      seen.add(g.term);
      const kk = lang === 'kk' ? GLOSSARY_KK[g.term] : undefined;
      out.push(kk ? { term: kk.term, plain: kk.plain } : { term: g.term, plain: g.plain });
    }
  }
  return out.slice(0, 4);
}

const LEVEL_RANK = { minor: 1, significant: 2, urgent: 3 } as const;

const PLAIN_RU: typeof REPORT_KK.plain = {
  urgent: 'Эту формулировку нужно срочно обсудить с врачом.',
  significant: 'Здесь описано то, что требует консультации специалиста.',
  minor: 'Частая находка — обсудите её значение на приёме у врача.',
  negated: 'Врач отмечает, что изменений этого типа не обнаружено.',
  normal: 'Описание обычного строения — без отклонений.',
  descriptive: 'Описательная часть заключения.',
};

const DISCLAIMER_RU = 'Это объяснение терминов, а не диагноз. Результат интерпретирует лечащий врач с учётом ваших жалоб, осмотра и истории болезни.';

function sentencePlain(sentence: string, negated: boolean, flags: RedFlagHit[], lang: Lang): string {
  const P = lang === 'kk' ? REPORT_KK.plain : PLAIN_RU;
  if (flags.some(f => f.level === 'urgent')) return P.urgent;
  if (flags.some(f => f.level === 'significant')) return P.significant;
  if (flags.some(f => f.level === 'minor')) return P.minor;
  if (negated) return P.negated;
  if (/не смещен|обычн[а-яё]* (?:формы|размер|располож)|в норме|не расширен|симметричн|сохранен|дифференцировка .* сохран/i.test(sentence)) return P.normal;
  return P.descriptive;
}

/** Язык, на котором построено объяснение (по дисклеймеру: у казахского — казахские буквы). */
export function reportLang(report: Pick<ReportExplanation, 'disclaimer'>): Lang {
  return /[әғқңөұүһі]/i.test(report.disclaimer) ? 'kk' : 'ru';
}

/**
 * Разбор заключения. Текст заключения — на русском (так выдают клиники Казахстана),
 * логика детекции от языка не зависит; lang задаёт язык всех пояснений для пациента.
 * specialty/recommendedSpecialty остаются русскими идентификаторами (их используют слоты).
 */
export function analyzeReport(text: string, source: ReportExplanation['source'], id: string, now: Date, lang: Lang = 'ru'): ReportExplanation {
  const sentences: ReportSentence[] = [];
  const redFlags: RedFlagHit[] = [];
  for (const s of splitSentences(text).slice(0, 40)) {
    const flags = findRedFlags(s, lang);
    const negated = clauses(s).some(isNegated) && flags.length === 0;
    redFlags.push(...flags.filter(f => !redFlags.some(r => r.id === f.id)));
    sentences.push({ text: s, plain: sentencePlain(s, negated, flags, lang), terms: findTerms(s, lang), negated });
  }
  const top = redFlags.reduce<RedFlagHit | undefined>((acc, f) => (!acc || LEVEL_RANK[f.level] > LEVEL_RANK[acc.level] ? f : acc), undefined);
  const level: ReportExplanation['level'] = !top ? 'routine' : top.level === 'urgent' ? 'urgent' : 'follow_up';
  return {
    id,
    createdAt: now.toISOString(),
    source,
    sentences,
    summary: rulesSummary(level, redFlags, lang),
    summaryBy: 'rules',
    redFlags,
    level,
    recommendedSpecialty: top?.specialty,
    recommendedSpecialtyLabel: top ? specialtyLabel(top.specialty, lang) : undefined,
    doctorQuestions: doctorQuestions(redFlags, lang),
    disclaimer: lang === 'kk' ? REPORT_KK.disclaimer : DISCLAIMER_RU,
  };
}

export function rulesSummary(level: ReportExplanation['level'], flags: RedFlagHit[], lang: Lang = 'ru'): string {
  const phrases = [...new Set(flags.map(f => `«${f.phrase}»`))].slice(0, 3).join(', ');
  if (lang === 'kk') return level === 'routine' ? REPORT_KK.summary.routine : REPORT_KK.summary[level](phrases);
  if (level === 'routine') return 'В заключении описано обычное строение, тревожных формулировок в тексте не найдено. Обсудите результат с врачом, который направил вас на исследование.';
  if (level === 'urgent') return `В заключении есть формулировки, которые нужно срочно обсудить с врачом: ${phrases}. Это не диагноз, но откладывать консультацию не стоит.`;
  return `В заключении есть формулировки, значение которых должен объяснить специалист: ${phrases}. Рекомендуем записаться на консультацию.`;
}

function doctorQuestions(flags: RedFlagHit[], lang: Lang): string[] {
  const kk = lang === 'kk' ? REPORT_KK.questions : null;
  const q = flags.filter(f => f.id !== 'suspicion' && f.id !== 'further_workup').slice(0, 2).map(f => (kk ? kk.phrase(f.phrase) : `Что означает «${f.phrase}» в моём случае?`));
  if (flags.length) q.push(kk ? kk.more : 'Нужны ли дополнительные исследования или контрольная МРТ? Когда?');
  q.push(kk ? kk.complaints : 'Связаны ли описанные изменения с моими жалобами?');
  q.push(kk ? kk.next : 'Что мне делать дальше и когда прийти на повторный приём?');
  return q.slice(0, 4);
}

export const REPORT_SAMPLES: Record<'normal' | 'finding' | 'urgent', string> = {
  normal: 'МР-томограммы головного мозга с внутривенным контрастированием. Срединные структуры не смещены. Очаговых изменений вещества головного мозга не выявлено. Желудочковая система не расширена, симметрична. Субарахноидальные пространства не расширены. Патологического накопления контрастного вещества не выявлено. Заключение: МР-признаков очаговых изменений головного мозга не выявлено.',
  finding: 'Срединные структуры не смещены. В белом веществе лобных долей определяются единичные очаги глиоза до 3 мм, вероятно сосудистого генеза, без патологического накопления контраста. В правой гемисфере мозжечка определяется очаг демиелинизации 6 мм. Желудочки не расширены. Утолщение слизистой оболочки правой верхнечелюстной пазухи. Заключение: МР-картина очаговых изменений белого вещества. Рекомендована консультация невролога.',
  urgent: 'В левой лобной доле определяется объёмное образование 32×28 мм с кольцевидным накоплением контрастного вещества и перифокальным отёком. Отмечается масс-эффект со смещением срединных структур вправо на 6 мм. Заключение: МР-картина объёмного образования левой лобной доли. Рекомендуется срочная консультация нейрохирурга.',
};
