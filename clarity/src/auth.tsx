import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthMe } from '../shared/types';
import { api, ApiError } from './api';

interface AuthCtx {
  me: AuthMe | null;
  loading: boolean;
  error: string;
  refreshMe: () => Promise<void>;
  demoLogin: (as: 'new_patient' | 'aliya' | 'staff') => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AuthMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshMe = useCallback(async () => {
    try { setMe(await api.me()); setError(''); } catch (e) { setError(e instanceof ApiError ? e.message : 'Сервер недоступен'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refreshMe(); }, [refreshMe]);

  const demoLogin = useCallback(async (as: 'new_patient' | 'aliya' | 'staff') => {
    setMe(await api.demoLogin(as));
    location.hash = as === 'staff' ? '/staff' : '/';
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } finally {
      try { speechSynthesis.cancel(); } catch { /* нет TTS */ }
      location.hash = '/';
      await refreshMe();
    }
  }, [refreshMe]);

  return <Ctx.Provider value={{ me, loading, error, refreshMe, demoLogin, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
