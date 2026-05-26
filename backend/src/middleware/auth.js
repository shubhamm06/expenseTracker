import { supabase } from '../models/supabase.js';

export async function requireAuth(req, res, next) {
  // Skip auth for OAuth callbacks (browser redirect, no token available)
  if (req.path.includes('/oauth/') && req.path.includes('/callback')) {
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
