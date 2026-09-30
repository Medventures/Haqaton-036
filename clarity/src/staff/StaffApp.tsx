import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { BarChart3, ClipboardList, LogOut, Users } from 'lucide-react';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import LangSwitch from '../components/LangSwitch';
import StaffConsole from './StaffConsole';
import MetricsDashboard from './MetricsDashboard';

type Page = 'queue' | 'patients' | 'metrics';
const readPage = (): Page => (location.hash.includes('metrics') ? 'metrics' : location.hash.includes('patients') ? 'patients' : 'queue');

export default function StaffApp() {
  const { me, logout } = useAuth();
  const { t } = useT();
  const [page, setPage] = useState<Page>(readPage);
  const [toast, setToast] = useState('');
  useEffect(() => { const h = () => setPage(readPage()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  const nav: [Page, string, ReactNode, string][] = [
    ['queue', t('staff.navQueue'), <ClipboardList size={20} />, '#/staff'],
    ['patients', t('staff.navPatients'), <Users size={20} />, '#/staff/patients'],
    ['metrics', t('staff.navMetrics'), <BarChart3 size={20} />, '#/metrics'],
  ];

  return (
    <div className="sapp">
      <aside className="sside">
        <div className="brand light"><span className="brand-mark">✳</span><b>clarity</b><small>{t('staff.brandSub')}</small></div>
        <div className="sside-clinic"><span>G</span><div><b>Green Clinic</b><small>{t('staff.clinicRoute')}</small></div></div>
        <nav>{nav.map(([id, label, icon, href]) => <a key={id} href={href} className={page === id ? 'on' : ''} aria-current={page === id ? 'page' : undefined}>{icon}<span>{label}</span></a>)}</nav>
        <div className="sside-lang" title={t('staff.uiLang')}><LangSwitch compact className="on-dark" /></div>
        <div className="sside-user">
          <span className="initials">{(me?.user?.name ?? 'К')[0]}</span>
          <div><b>{me?.user?.name}</b><small>{me?.user?.email}</small></div>
          <button onClick={() => void logout()} aria-label={t('staff.logout')} title={t('staff.logout')}><LogOut size={18} /></button>
        </div>
      </aside>
      <main className="smain">
        {page === 'metrics' ? <MetricsDashboard /> : <StaffConsole view={page} toast={setToast} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
