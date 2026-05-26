import { supabase } from './supabase';

export async function apiFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = {
    ...(options.headers || {}),
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  return fetch(url, { ...options, headers });
}
