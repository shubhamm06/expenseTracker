const cache = new Map();

const DEFAULT_TTL = 180000;

export function getCached(userId, key) {
  const entry = cache.get(`${userId}:${key}`);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(`${userId}:${key}`);
    return null;
  }
  return entry.data;
}

export function setCache(userId, key, data, ttl = DEFAULT_TTL) {
  cache.set(`${userId}:${key}`, { data, expires: Date.now() + ttl });
}

export function invalidateUser(userId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      cache.delete(key);
    }
  }
}

export function invalidateKey(userId, key) {
  cache.delete(`${userId}:${key}`);
}

export function cacheMiddleware(keyFn, ttl = DEFAULT_TTL) {
  return (req, res, next) => {
    const key = typeof keyFn === 'function' ? keyFn(req) : keyFn;
    const cached = getCached(req.userId, key);
    if (cached) {
      return res.json(cached);
    }

    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setCache(req.userId, key, data, ttl);
      }
      return originalJson(data);
    };
    next();
  };
}

export function invalidateOnWrite(keys) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (typeof keys === 'function') {
          keys(req).forEach(k => invalidateKey(req.userId, k));
        } else {
          invalidateUser(req.userId);
        }
      }
      return originalJson(data);
    };
    next();
  };
}
