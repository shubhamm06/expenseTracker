import { useEffect } from 'react';
import { useLoading } from '../components/LoadingBar';

export function useFetchInterceptor() {
  const { increment, decrement } = useLoading();

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (!url.includes('/api/')) return originalFetch.apply(this, args);

      increment();
      return originalFetch.apply(this, args).finally(() => {
        decrement();
      });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [increment, decrement]);
}
