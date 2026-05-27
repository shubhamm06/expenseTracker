import { supabase } from '../models/supabase.js';

const PUBLIC_PATHS = [
  '/settings/oauth/google/callback',
];

const PUBLIC_PATTERNS = [
  /^\/upload\/files\/[^/]+\/view$/,
  /^\/upload\/files\/[^/]+\/download$/,
];

export async function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.some(p => req.path === p || req.originalUrl.includes(p))) {
    return next();
  }

  const apiPath = req.originalUrl.replace(/^\/api/, '').split('?')[0];
  if (PUBLIC_PATTERNS.some(p => p.test(apiPath))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  req.userId = user.id;
  next();
}
