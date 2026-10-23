// Tiny in-memory cache. If a refresh fails, the last good value is served so
// a brief outage upstream does not blank the site.

const store = new Map();

async function cached(key, ttlMs, load) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (hit?.pending) return hit.pending;

  const pending = load()
    .then((value) => {
      store.set(key, { value, at: Date.now() });
      return value;
    })
    .catch((err) => {
      if (hit) {
        console.warn(`[cache] ${key}: ${err.message} (serving stale copy)`);
        store.set(key, { ...hit, pending: null });
        return hit.value;
      }
      store.delete(key);
      throw err;
    });

  store.set(key, { ...(hit || {}), pending });
  return pending;
}

module.exports = { cached };
