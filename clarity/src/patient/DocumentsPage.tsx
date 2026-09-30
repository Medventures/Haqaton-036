// Раздел «Документы»: анализы и заключение врача — загрузка, проверка, объяснение.
import { useEffect, useState } from 'react';
import { FileText, FlaskConical, Sparkles } from 'lucide-react';
import { useClarity } from '../state';
import { useT } from '../i18n';
import type { ModalId } from './Modals';
import LabsSection, { type LabIntent } from './docs/LabsSection';
import ReportSection from './docs/ReportSection';
import { PrivacyNote } from './docs/ui';
import { onDocsIntent, takeDocsIntent, type DocKind } from './docs/upload';

const TAB_KEY = 'clarity-docs-tab';
const readTab = (): DocKind => { try { return localStorage.getItem(TAB_KEY) === 'report' ? 'report' : 'labs'; } catch { return 'labs'; } };

export default function DocumentsPage({ open }: { open: (m: ModalId) => void }) {
  const { state, openAssistant, assistantName } = useClarity();
  const { t } = useT();
  const [tab, setTabRaw] = useState<DocKind>(readTab);
  const [intent, setIntent] = useState<LabIntent | null>(null);
  const setTab = (k: DocKind) => { setTabRaw(k); try { localStorage.setItem(TAB_KEY, k); } catch { /* ignore */ } };

  // Черновик, загруженный из чата ассистента, открываем сразу на проверке.
  useEffect(() => {
    const apply = () => {
      const i = takeDocsIntent();
      if (!i) return;
      setTab(i.tab);
      if (i.draft || i.viewId || i.manual) setIntent({ draft: i.draft, preview: i.preview, viewId: i.viewId, manual: i.manual });
    };
    apply();
    return onDocsIntent(apply);
  }, []);

  if (!state) return null;
  const labs = state.journey.labReports ?? [];
  const pending = labs.filter(r => !r.confirmed).length;

  return (
    <div className="page docs-page">
      <div className="page-head">
        <div>
          <h1>{t('docs.title')}</h1>
          <p className="muted">{t('docs.subtitle', { name: assistantName })}</p>
        </div>
        <button className="btn ghost" onClick={() => openAssistant()}><Sparkles size={18} /> {t('docs.askGeneric', { name: assistantName })}</button>
      </div>

      <div className="docs-tabs" role="tablist" aria-label={t('docs.tabsAria')}>
        <button role="tab" aria-selected={tab === 'labs'} className={tab === 'labs' ? 'on' : ''} onClick={() => setTab('labs')}>
          <FlaskConical size={20} aria-hidden />
          <span><b>{t('docs.tabLabs')}</b><small>{labs.length ? t('docs.itemsUploaded', { n: labs.length }) : t('docs.tabLabsHint')}</small></span>
          {pending > 0 && <em className="docs-tab-badge" title={t('docs.needsReview')}>{pending}</em>}
        </button>
        <button role="tab" aria-selected={tab === 'report'} className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>
          <FileText size={20} aria-hidden />
          <span><b>{t('docs.tabReport')}</b><small>{state.journey.lastReport ? t('docs.tabReportHas') : t('docs.tabReportHint')}</small></span>
        </button>
      </div>

      <div role="tabpanel">
        {tab === 'labs' ? <LabsSection open={open} intent={intent} /> : <ReportSection open={open} />}
      </div>

      <PrivacyNote />
    </div>
  );
}
