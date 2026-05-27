import { useEffect } from 'react';
import { useLoading } from '../components/LoadingBar';
import { supabase } from '../lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL || '';

const SILENT_ENDPOINTS = [
  '/api/auth/me',
  '/api/settings/sync-schedule',
  '/api/settings/sync-throttle',
  '/api/settings/email-accounts',
  '/api/upload/files',
  '/api/vouchers/usage/auto-categorize',
];

export function useFetchInterceptor() {
  const { increment, decrement } = useLoading();

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      let url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (!url.includes('/api/')) return originalFetch.apply(this, args);

      // Prefix with API base URL for production
      if (API_BASE && url.startsWith('/api/')) {
        url = API_BASE + url;
        args[0] = url;
      }

      const showLoading = !SILENT_ENDPOINTS.some(ep => url.includes(ep));
      if (showLoading) increment();

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const options = args[1] || {};
        options.headers = {
          ...(options.headers || {}),
          Authorization: `Bearer ${session.access_token}`,
        };
        args[1] = options;
      }

      return originalFetch.apply(this, args).finally(() => {
        if (showLoading) decrement();
      });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [increment, decrement]);
}
