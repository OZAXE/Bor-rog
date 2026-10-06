// Stockage Postgres (base Neon en production). Mêmes règles que memoryStore.js.
// Les tables sont créées au démarrage si elles n'existent pas.

import pg from 'pg';

const SCHEMA = `
  create table if not exists accounts (
    id bigserial primary key,
    name text not null,
    name_key text not null unique,
    pass text not null,
    created_at timestamptz not null default now()
  );
  create table if not exists sessions (
    token_hash text primary key,
    account_id bigint not null references accounts(id) on delete cascade,
    expires_at timestamptz not null
  );
  create table if not exists profiles (
    account_id bigint primary key references accounts(id) on delete cascade,
    data jsonb not null,
    rev integer not null,
    updated_at timestamptz not null default now()
  );
`;

export function createPgStore(connectionString, { ssl = true } = {}) {
  const pool = new pg.Pool({ connectionString, max: 5, ssl: ssl ? { rejectUnauthorized: true } : false });
  const q = (text, values) => pool.query(text, values);

  return {
    pool,
    async init() {
      await q(SCHEMA);
    },
    async createAccount(name, key, pass) {
      const r = await q(
        'insert into accounts (name, name_key, pass) values ($1, $2, $3) on conflict (name_key) do nothing returning id, name',
        [name, key, pass],
      );
      return r.rows[0] ? { id: Number(r.rows[0].id), name: r.rows[0].name } : null;
    },
    async findAccount(key) {
      const r = await q('select id, name, pass from accounts where name_key = $1', [key]);
      return r.rows[0] ? { ...r.rows[0], id: Number(r.rows[0].id) } : null;
    },
    async createSession(hash, accountId, expires, now) {
      // Au passage, ménage des sessions expirées de ce compte
      await q('delete from sessions where account_id = $1 and expires_at <= $2', [accountId, new Date(now)]);
      await q('insert into sessions (token_hash, account_id, expires_at) values ($1, $2, $3)', [hash, accountId, new Date(expires)]);
    },
    async sessionAccount(hash, now) {
      const r = await q(
        'select a.id, a.name from sessions s join accounts a on a.id = s.account_id where s.token_hash = $1 and s.expires_at > $2',
        [hash, new Date(now)],
      );
      return r.rows[0] ? { id: Number(r.rows[0].id), name: r.rows[0].name } : null;
    },
    async deleteSession(hash) {
      await q('delete from sessions where token_hash = $1', [hash]);
    },
    async getProfile(accountId) {
      const r = await q('select data, rev from profiles where account_id = $1', [accountId]);
      return r.rows[0] ? { data: r.rows[0].data, rev: r.rows[0].rev } : { data: null, rev: 0 };
    },
    async putProfile(accountId, data, baseRev) {
      const json = JSON.stringify(data);
      // Écriture atomique : la ligne n'est modifiée que si sa version est celle du client
      const r =
        baseRev === 0
          ? await q(
              'insert into profiles (account_id, data, rev) values ($1, $2, 1) on conflict (account_id) do nothing returning rev',
              [accountId, json],
            )
          : await q(
              'update profiles set data = $2, rev = rev + 1, updated_at = now() where account_id = $1 and rev = $3 returning rev',
              [accountId, json, baseRev],
            );
      if (r.rows[0]) return { ok: true, rev: r.rows[0].rev };
      const cur = await this.getProfile(accountId);
      return { ok: false, rev: cur.rev, data: cur.data };
    },
    async ping() {
      await q('select 1');
    },
    async close() {
      await pool.end();
    },
  };
}
