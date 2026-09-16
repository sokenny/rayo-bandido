import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The database: Postgres, one of two ways.
 *
 *   PRODUCTION is RDS (`rayo-bandido-db`, sa-east-1), reached with the `pg` driver. The password
 *   is not configured anywhere: RDS keeps it in Secrets Manager and ROTATES it, so it is read
 *   from there (`RB_DB_SECRET_ID`) when a connection is opened, and read again the first time
 *   the database refuses it.
 *
 *   EVERYWHERE ELSE it is PGlite — the real Postgres, compiled to WebAssembly, running inside
 *   this process and keeping its files under `.data/pglite`. Nothing to install, and the SQL
 *   it runs is the SQL production runs. Tests ask for `RB_DATABASE_URL=memory://`.
 *
 * WHICH ONE, in order:
 *   RB_DATABASE_URL=postgres://…        a Postgres server (a local one, say)
 *   RB_DATABASE_URL=memory:// | <dir>   PGlite, in memory or in that directory
 *   RB_DB_HOST + RB_DB_SECRET_ID        RDS with the rotated secret (+ RB_DB_NAME, RB_DB_PORT)
 *   (none, not production)              PGlite in `${RB_DATA_DIR || .data}/pglite`
 *   (none, NODE_ENV=production)         no database: accounts and boards are switched off
 *
 * The last line is deliberate. A production server that silently fell back to PGlite on the
 * instance's disk would look like it worked and lose every account at the next deploy.
 *
 * Callers get one small surface whichever driver is underneath: `query(sql, params)` resolves
 * to the rows, `tx(fn)` runs `fn` inside a transaction with the same `query`. Counts should be
 * cast to `::int` in SQL — `pg` returns bigint as a string and PGlite as a number.
 */

const MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url));
/** Any fixed number: the advisory lock two servers starting at once take around migrations. */
const MIGRATION_LOCK = 72401;

/** @typedef {{ query: (sql: string, params?: unknown[]) => Promise<any[]> }} Queryable */
/** @typedef {Queryable & { tx: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>, close: () => Promise<void>, kind: string }} Database */

/**
 * @param {{ log?: (msg: string) => void, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Database | null>}
 */
export async function createDatabase({ log = () => {}, env = process.env } = {}) {
  const url = env.RB_DATABASE_URL;
  let db;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    db = await openPg({ connectionString: url }, log);
  } else if (url) {
    db = await openPglite(url, log);
  } else if (env.RB_DB_HOST && env.RB_DB_SECRET_ID) {
    db = await openRds(env, log);
  } else if (env.NODE_ENV !== 'production') {
    const dir = join(env.RB_DATA_DIR || join(process.cwd(), '.data'), 'pglite');
    mkdirSync(dir, { recursive: true });
    db = await openPglite(dir, log);
  } else {
    log('database: none configured (set RB_DB_HOST and RB_DB_SECRET_ID); accounts and boards are off');
    return null;
  }
  await migrate(db, log);
  return db;
}

/* ------------------------------------------------------------------ drivers */

async function openPglite(where, log) {
  // A devDependency, loaded only here: a production install does not carry it.
  const { PGlite } = await import('@electric-sql/pglite');
  // PGlite does not lock its files against another process, and two servers on one directory
  // corrupt it. A second server on this machine gets a memory database instead, and says so.
  if (!where.startsWith('memory://') && !claimDirectory(where)) {
    log(`database: ${where} is in use by another server; using a memory database for this one`);
    where = 'memory://';
  }
  const pg = await PGlite.create(where);
  log(`database: PGlite (${where})`);
  const query = async (sql, params = []) => (await pg.query(sql, params)).rows;
  return {
    kind: 'pglite',
    query,
    exec: (sql) => pg.exec(sql),
    tx: (fn) => pg.transaction((t) => fn({ query: async (sql, params = []) => (await t.query(sql, params)).rows })),
    close: () => pg.close(),
  };
}

/** Take `<dir>.lock` for this process, unless a live process already holds it. */
function claimDirectory(dir) {
  const lock = `${dir.replace(/\/$/, '')}.lock`;
  try {
    const holder = Number(readFileSync(lock, 'utf8'));
    if (holder && holder !== process.pid) {
      try {
        process.kill(holder, 0);
        return false;
      } catch (err) {
        // ESRCH: that process is gone and the lock is stale. EPERM: it exists, it is not ours.
        if (err.code === 'EPERM') return false;
      }
    }
  } catch {
    /* no lock yet */
  }
  writeFileSync(lock, String(process.pid));
  process.once('exit', () => {
    try {
      if (Number(readFileSync(lock, 'utf8')) === process.pid) unlinkSync(lock);
    } catch {
      /* already gone */
    }
  });
  return true;
}

/**
 * `pg` against RDS. The username and password come from the RDS-managed secret; `password` is a
 * function so every new connection gets the cached value, and a refused password clears the
 * cache so the next attempt reads the rotated one.
 */
async function openRds(env, log) {
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const secretId = env.RB_DB_SECRET_ID;
  // The region is in the ARN; the instance's own region is the fallback for a bare name.
  const region = /^arn:aws:secretsmanager:([^:]+):/.exec(secretId)?.[1] || env.AWS_REGION || 'sa-east-1';
  const client = new SecretsManagerClient({ region });
  let cached = null;
  async function secret() {
    if (!cached) {
      const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
      cached = JSON.parse(out.SecretString || '{}');
    }
    return cached;
  }
  const first = await secret();
  return openPg(
    {
      host: env.RB_DB_HOST,
      port: Number(env.RB_DB_PORT || 5432),
      database: env.RB_DB_NAME || 'rayobandido',
      user: first.username,
      password: async () => (await secret()).password,
      ssl: rdsSsl(env, log),
    },
    log,
    () => {
      cached = null;
    },
  );
}

/**
 * RDS for Postgres 15+ refuses unencrypted connections, and the certificate it presents is signed
 * by Amazon's own RDS CAs, which no system trust store carries. So the bundle of them ships beside
 * this file (`rds-global-bundle.pem`, from
 * https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) and the certificate AND the
 * host name are verified against it. `RB_DB_CA_FILE` points somewhere else, for a newer bundle
 * without a deploy. A bundle that cannot be read is fatal to the connection, never a quiet
 * downgrade to an unverified one.
 */
const RDS_CA_BUNDLE = fileURLToPath(new URL('./rds-global-bundle.pem', import.meta.url));

function rdsSsl(env, log) {
  const file = env.RB_DB_CA_FILE || RDS_CA_BUNDLE;
  log(`database: TLS verified against ${file === RDS_CA_BUNDLE ? 'the bundled RDS CAs' : file}`);
  return { ca: readFileSync(file, 'utf8'), rejectUnauthorized: true };
}

async function openPg(config, log, onAuthFailure = () => {}) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ ...config, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5000 });
  // An idle client dropped by the server must not take the process with it.
  pool.on('error', (err) => log(`database: idle client error (${err.message})`));
  log(`database: Postgres (${config.host || 'connection string'})`);

  /** One retry, only for a refused password: the secret has rotated under us. */
  async function withRetry(run) {
    try {
      return await run();
    } catch (err) {
      if (err?.code !== '28P01') throw err;
      onAuthFailure();
      return run();
    }
  }

  return {
    kind: 'pg',
    query: (sql, params = []) => withRetry(async () => (await pool.query(sql, params)).rows),
    exec: (sql) => withRetry(() => pool.query(sql)),
    tx: (fn) =>
      withRetry(async () => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const result = await fn({ query: async (sql, params = []) => (await client.query(sql, params)).rows });
          await client.query('commit');
          return result;
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }),
    async close() {
      await pool.end();
    },
    /** Run `fn` holding the migration lock. Advisory locks belong to a connection, so one is held. */
    async withLock(fn) {
      const client = await pool.connect();
      try {
        await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
        return await fn();
      } finally {
        await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
        client.release();
      }
    },
  };
}

/* ------------------------------------------------------------------ migrations */

/**
 * Apply every `migrations/NNN_name.sql` not yet recorded in `schema_migrations`, in name order,
 * each in its own transaction. A migration is never edited once it has shipped: a change is the
 * next file.
 */
async function migrate(db, log) {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const run = async () => {
    const done = new Set((await db.query('select name from schema_migrations')).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      await db.tx(async (q) => {
        // Statements one at a time: the extended protocol `query` uses takes one per call.
        for (const statement of splitStatements(sql)) await q.query(statement);
        await q.query('insert into schema_migrations (name) values ($1)', [file]);
      });
      log(`database: applied ${file}`);
    }
  };
  // Two servers starting together (a rolling deploy) must not both apply the same file.
  await (db.withLock ? db.withLock(run) : run());
}

/**
 * Split a migration into statements on the semicolons that end a line. Enough for plain DDL;
 * a migration that needs a function body with semicolons inside it should use `$$` on one line
 * per statement or grow this.
 */
export function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
