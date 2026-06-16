const DEFAULT_TTL_MS = 60_000;

export const CACHE_KEYS = Object.freeze({
  walletAgent: "walletAgent",
  agent: "agent",
  vault: "vault",
  controller: "controller",
  safeSpendLimit: "safeSpendLimit",
  contracts: "contracts"
});

export class SpendGridCache {
  constructor(options = {}) {
    this.defaultTtlMs = Number.isFinite(Number(options.ttlMs))
      ? Math.max(0, Number(options.ttlMs))
      : DEFAULT_TTL_MS;
    this.values = new Map();
    this.inflight = new Map();
  }

  get(namespace, key) {
    const cacheKey = makeCacheKey(namespace, key);
    const record = this.values.get(cacheKey);
    if (!record) {
      return undefined;
    }

    if (record.expiresAt !== 0 && Date.now() > record.expiresAt) {
      this.values.delete(cacheKey);
      return undefined;
    }

    return record.value;
  }

  set(namespace, key, value, options = {}) {
    const ttlMs = options.ttlMs === undefined ? this.defaultTtlMs : Math.max(0, Number(options.ttlMs));
    const cacheKey = makeCacheKey(namespace, key);
    this.values.set(cacheKey, {
      value,
      expiresAt: ttlMs === 0 ? 0 : Date.now() + ttlMs
    });

    return value;
  }

  has(namespace, key) {
    return this.get(namespace, key) !== undefined;
  }

  delete(namespace, key) {
    this.values.delete(makeCacheKey(namespace, key));
    this.inflight.delete(makeCacheKey(namespace, key));
  }

  clear(namespace) {
    if (!namespace) {
      this.values.clear();
      this.inflight.clear();
      return;
    }

    const prefix = `${namespace}:`;
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) {
        this.values.delete(key);
      }
    }
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix)) {
        this.inflight.delete(key);
      }
    }
  }

  remember(namespace, key, loader, options = {}) {
    const cached = options.force ? undefined : this.get(namespace, key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const cacheKey = makeCacheKey(namespace, key);
    if (!options.force && this.inflight.has(cacheKey)) {
      return this.inflight.get(cacheKey);
    }

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.set(namespace, key, value, options);
        return value;
      })
      .finally(() => {
        this.inflight.delete(cacheKey);
      });

    this.inflight.set(cacheKey, promise);
    return promise;
  }
}

export function createSpendGridCache(options = {}) {
  return new SpendGridCache(options);
}

export function makeCacheKey(namespace, key) {
  return `${namespace}:${normalizeKey(key)}`;
}

function normalizeKey(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeKey).join(":");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value, Object.keys(value).sort());
  }

  return String(value);
}
