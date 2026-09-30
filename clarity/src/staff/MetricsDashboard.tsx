import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Info, RefreshCw, Table2 } from 'lucide-react';
import type { MetricsResponse, MetricValue } from '../../shared/types';
import { api, ApiError, fmtShort } from '../api';
import { useT } from '../i18n';
import type { Lang } from '../../shared/i18n';

const fmt = (m: MetricValue, v: number, locale: string) => (m.unit === '%' ? `${v.toLocaleString(locale)}%` : v.toLocaleString(locale));

/** Подписи воронки приходят с сервера по-русски — переводим по позиции известной подписи. */
const FUNNEL_RU = ['Записаны', 'Прошли проверку', 'Пришли на МРТ', 'Рекомендована консультация', 'Записались', 'Консультация состоялась'];

/** Известные причины отмен (из сида и из диалога ассистента) — на казахском. Остальное (свободный текст) остаётся как есть. */
const CANCEL_REASON_KK: Record<string, string> = {
  'Не готов анализ': 'Талдау дайын емес',
  'Нарушена подготовка': 'Дайындық бұзылды',
  'Изменились планы': 'Жоспарлар өзгерді',
  'Не дозвонились для подтверждения': 'Растау үшін хабарласу мүмкін болмады',
  'Сомнения по импланту': 'Имплантқа қатысты күмән',
  'Неявка': 'Келмеді',
  'Не указана': 'Көрсетілмеген',
  'Не успеваю сдать анализ': 'Талдауды тапсырып үлгермеймін',
  'Плохо себя чувствую': 'Өзімді нашар сезінемін',
  'Сомневаюсь из-за противопоказаний': 'Қарсы көрсетілімдерге байланысты күмән бар',
};
export const cancelReasonLabel = (reason: string, lang: Lang) => (lang === 'kk' ? CANCEL_REASON_KK[reason] ?? reason : reason);

export default function MetricsDashboard() {
  const { t, lang, locale } = useT();
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [err, setErr] = useState('');
  const [table, setTable] = useState(false);
  const load = () => api.metrics().then(d => { setData(d); setErr(''); }).catch(e => setErr(e instanceof ApiError ? e.message : t('staff.error')));
  useEffect(() => { load(); }, []);

  if (!data) return <div className="page"><div className="skeleton" />{err && <p className="notice crit">{err}</p>}</div>;
  const funnelMax = Math.max(1, ...data.funnel.map(f => f.value));
  const reasonMax = Math.max(1, ...data.cancelReasons.map(r => r.count));
  const mLabel = (m: MetricValue) => t(`staff.m.${m.key}`);
  const mDef = (m: MetricValue) => t(`staff.md.${m.key}`);
  const funnelLabel = (l: string) => { const i = FUNNEL_RU.indexOf(l); return i >= 0 ? t(`staff.fn.${i}`) : l; };

  return (
    <div className="page wide">
      <div className="page-head">
        <div><h1>{t('staff.mTitle')}</h1><p className="muted">{t('staff.mLead')}</p></div>
        <div className="head-actions"><button className="btn ghost" onClick={() => setTable(!table)}><Table2 size={14} /> {table ? t('staff.mCards') : t('staff.mTable')}</button><button className="btn ghost" onClick={load}><RefreshCw size={14} /> {t('staff.refresh')}</button></div>
      </div>
      <div className="notice info"><Info size={20} /><div><p>{lang === 'kk' ? t('staff.mDisclaimer') : data.disclaimer}</p></div></div>

      {table ? (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>{t('staff.thMetric')}</th><th>{t('staff.thBase')}</th><th>{t('staff.thClarity')}</th><th>{t('staff.thNumDen')}</th><th>{t('staff.thDef')}</th></tr></thead>
          <tbody>{data.metrics.map(m => <tr key={m.key}><td><b>{mLabel(m)}</b>{m.unit !== '%' && <small>{t('staff.perVisit')}</small>}</td><td>{fmt(m, m.baseline, locale)}<small>n = {m.baselineN}</small></td><td>{fmt(m, m.current, locale)}</td><td>{m.numerator} / {m.denominator}</td><td><small>{mDef(m)}</small></td></tr>)}</tbody>
        </table></div>
      ) : (
        <div className="kpi-grid">
          {data.metrics.map(m => {
            const delta = m.current - m.baseline;
            const improved = m.better === 'lower' ? delta < 0 : delta > 0;
            const rel = m.baseline ? Math.round((Math.abs(delta) / m.baseline) * 100) : 0;
            return (
              <div key={m.key} className="kpi">
                <span className="kpi-label">{mLabel(m)}</span>
                <b className="kpi-value">{fmt(m, m.current, locale)}{m.unit !== '%' && <small className="kpi-unit"> {t('staff.perVisit')}</small>}</b>
                <span className={`kpi-delta ${improved ? 'good' : 'bad'}`}>{delta < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{t('staff.vsBase', { rel, base: fmt(m, m.baseline, locale) })} · {improved ? t('staff.better') : t('staff.worse')}</span>
                <div className="kpi-compare" aria-hidden>
                  <div><i style={{ width: `${Math.min(100, (m.baseline / Math.max(m.baseline, m.current, 0.01)) * 100)}%` }} className="base" /><small>{t('staff.base')}</small></div>
                  <div><i style={{ width: `${Math.min(100, (m.current / Math.max(m.baseline, m.current, 0.01)) * 100)}%` }} /><small>Clarity</small></div>
                </div>
                <small className="kpi-def">{mDef(m)}. n = {m.denominator}</small>
              </div>
            );
          })}
        </div>
      )}

      <div className="viz-row">
        <section className="viz">
          <h2>{t('staff.funnelTitle')}</h2>
          <p>{t('staff.funnelSub')}</p>
          <div className="hbars">
            {data.funnel.map(f => (
              <div key={f.label} className="hbar" title={`${funnelLabel(f.label)}: ${f.value}`}>
                <span>{funnelLabel(f.label)}</span>
                <div><i style={{ width: `${(f.value / funnelMax) * 100}%` }} /></div>
                <b>{f.value}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="viz">
          <h2>{t('staff.cancelTitle')}</h2>
          <p>{t('staff.cancelSub')}</p>
          <div className="hbars">
            {data.cancelReasons.length === 0 && <p className="muted">{t('staff.noCancels')}</p>}
            {data.cancelReasons.map(r => (
              <div key={r.reason} className="hbar" title={`${cancelReasonLabel(r.reason, lang)}: ${r.count}`}>
                <span>{cancelReasonLabel(r.reason, lang)}</span>
                <div><i style={{ width: `${(r.count / reasonMax) * 100}%` }} /></div>
                <b>{r.count}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
      <p className="muted small note">{t('staff.updated', { t: fmtShort(data.generatedAt) })} {t('staff.mNote')}</p>
    </div>
  );
}
