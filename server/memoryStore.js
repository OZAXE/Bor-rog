// Stockage en mémoire : mêmes règles que pgStore.js, sans base de données.
// Sert aux tests automatiques (et au développement local sans Postgres).

export function createMemoryStore() {
  const accounts = new Map(); // clé du pseudo -> { id, name, pass }
  const sessions = new Map(); // empreinte du jeton -> { accountId, expires }
  const profiles = new Map(); // id du compte -> { data, rev }
  let nextId = 1;

  return {
    async init() {},
    async createAccount(name, key, pass) {
      if (accounts.has(key)) return null; // pseudo déjà pris
      const account = { id: nextId++, name, pass };
      accounts.set(key, account);
      return { id: account.id, name };
    },
    async findAccount(key) {
      return accounts.get(key) || null;
    },
    async createSession(hash, accountId, expires, now) {
      // Au passage, ménage des sessions expirées
      for (const [h, v] of sessions) if (v.expires <= now) sessions.delete(h);
      sessions.set(hash, { accountId, expires });
    },
    // Compte lié au jeton (null si inconnu ou expiré)
    async sessionAccount(hash, now) {
      const s = sessions.get(hash);
      if (!s || s.expires <= now) return null;
      for (const a of accounts.values()) if (a.id === s.accountId) return { id: a.id, name: a.name };
      return null;
    },
    async deleteSession(hash) {
      sessions.delete(hash);
    },
    async getProfile(accountId) {
      const p = profiles.get(accountId);
      return p ? { data: structuredClone(p.data), rev: p.rev } : { data: null, rev: 0 };
    },
    // Enregistre seulement si la version connue du client est la dernière (sinon
    // un autre appareil a écrit entre-temps : on renvoie ce qu'il a écrit)
    async putProfile(accountId, data, baseRev) {
      const cur = profiles.get(accountId) || { data: null, rev: 0 };
      if (cur.rev !== baseRev) return { ok: false, rev: cur.rev, data: structuredClone(cur.data) };
      profiles.set(accountId, { data: structuredClone(data), rev: cur.rev + 1 });
      return { ok: true, rev: cur.rev + 1 };
    },
    async close() {},
  };
}
