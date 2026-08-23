import { Pool, type PoolClient } from "pg";
import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { Subscriber } from "@shared/domain/newsletter";
import type { Account } from "@shared/domain/accounts";
import type {
  AuditEvent,
  BlogViewCount,
  Database,
  DealRecord,
  Store,
  SubscriberTokenField,
} from "@backend/store/schema";

/**
 * Postgres-backed store.
 *
 * Records are stored whole, as JSONB keyed by id, rather than shredded into
 * relational columns. That is a deliberate choice, not laziness:
 *
 *  - the domain types are the schema, and they are already exhaustively typed
 *    and tested; a parallel column layout would be a second definition of the
 *    same shapes, free to drift from the first
 *  - `Money` is an integer count of pence and survives JSON exactly; a numeric
 *    column invites someone to write a float into it
 *  - what Postgres is needed for here is concurrency, durability and being
 *    reachable from more than one process — none of which require the data to
 *    be relational
 *
 * Where reporting needs to query inside a record, that is what a JSONB index
 * or a materialised view is for, and neither changes this file's interface.
 *
 * Every read-modify-write runs inside a transaction with `FOR UPDATE`, because
 * the reason to move off the file store is precisely that two processes now
 * write at the same time.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS deals (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS buy_boxes (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS funding_boxes (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  -- Append-only by construction as well as by convention: no UPDATE or DELETE
  -- statement against this table exists anywhere in the codebase.
  CREATE TABLE IF NOT EXISTS audit_events (
    id text PRIMARY KEY,
    at timestamptz NOT NULL,
    subject text,
    data jsonb NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_events_at ON audit_events (at DESC);
  CREATE INDEX IF NOT EXISTS audit_events_subject ON audit_events (subject);
  -- Confirmation and unsubscribe links are looked up by token on every click.
  -- A counter per post. No visitor identifier of any kind is stored, so there
  -- is nothing here that needs protecting and nothing that could identify a
  -- reader.
  CREATE TABLE IF NOT EXISTS blog_views (
    slug text PRIMARY KEY,
    views bigint NOT NULL DEFAULT 0,
    last_viewed_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS subscribers_confirm_token
    ON subscribers ((data->>'confirmToken'));
  CREATE INDEX IF NOT EXISTS subscribers_unsubscribe_token
    ON subscribers ((data->>'unsubscribeToken'));
`;

let pool: Pool | undefined;
let ready: Promise<void> | undefined;

function getPool(): Pool {
  if (pool === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString === "") {
      throw new Error("DATABASE_URL is not set");
    }
    // TLS is governed entirely by `sslmode` in the connection string, which is
    // the standard libpq control and — verified against pg 8.23 — overrides any
    // `ssl` option passed here rather than merging with it. Passing
    // `rejectUnauthorized: false` alongside `sslmode=require` therefore does
    // nothing at all, while looking as though it relaxes verification.
    //
    //   sslmode=require    encrypted and the certificate is verified. Correct
    //                      for managed Postgres, which presents a publicly
    //                      signed certificate.
    //   sslmode=no-verify  encrypted but NOT authenticated, so the connection
    //                      can be intercepted. Only for a self-hosted server
    //                      with a self-signed certificate on a trusted network.
    //
    // An earlier version disabled verification whenever sslmode=require
    // appeared, which is the opposite of what that setting asks for.
    pool = new Pool({
      connectionString,
      // Serverless runtimes create a pool per instance, so a large per-pool
      // maximum exhausts the server's connection limit long before it helps.
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    });
  }
  return pool;
}

/**
 * Create the tables on first use.
 *
 * Idempotent DDL run once per process rather than a migration framework: there
 * is one version of this schema and it is additive. The moment a column has to
 * change shape, this becomes a real migration step and should be moved out.
 */
function ensureSchema(): Promise<void> {
  ready ??= getPool()
    .query(SCHEMA)
    .then(() => undefined)
    .catch((error: unknown) => {
      // Do not cache a failed bootstrap: a transient connection error at boot
      // would otherwise leave every later request believing the schema exists.
      ready = undefined;
      throw error;
    });
  return ready;
}

async function all<T>(table: string): Promise<readonly T[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{ data: T }>(`SELECT data FROM ${table} ORDER BY id`);
  return rows.map((r) => r.data);
}

async function one<T>(table: string, id: string): Promise<T | undefined> {
  await ensureSchema();
  const { rows } = await getPool().query<{ data: T }>(
    `SELECT data FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.data;
}

async function upsert<T extends { id: string }>(table: string, value: T): Promise<T> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO ${table} (id, data) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [value.id, JSON.stringify(value)],
  );
  return value;
}

async function remove(table: string, id: string): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/** Run a function inside a transaction, rolling back on any throw. */
async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const postgresStore: Store = {
  kind: "postgres",

  listDeals: () => all<DealRecord>("deals"),
  getDeal: (id) => one<DealRecord>("deals", id),
  saveDeal: (deal) => upsert("deals", deal),

  listBuyBoxes: () => all<BuyBox>("buy_boxes"),
  getBuyBox: (id) => one<BuyBox>("buy_boxes", id),
  saveBuyBox: (box) => upsert("buy_boxes", box),
  deleteBuyBox: (id) => remove("buy_boxes", id),

  listFundingBoxes: () => all<FundingBox>("funding_boxes"),
  getFundingBox: (id) => one<FundingBox>("funding_boxes", id),
  saveFundingBox: (box) => upsert("funding_boxes", box),
  deleteFundingBox: (id) => remove("funding_boxes", id),

  listSubscribers: () => all<Subscriber>("subscribers"),

  async findSubscriberByEmail(email: string): Promise<Subscriber | undefined> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: Subscriber }>(
      "SELECT data FROM subscribers WHERE email = $1",
      [email],
    );
    return rows[0]?.data;
  },

  /**
   * Upsert by email, not by id.
   *
   * Email is the natural key: a second signup for an address that already
   * exists must update that record rather than create a duplicate, or one
   * person receives the newsletter twice and unsubscribing only removes half
   * of them. The unique constraint on `email` enforces it in the database as
   * well as here, so a race cannot produce the duplicate either.
   */
  async saveSubscriber(subscriber: Subscriber): Promise<Subscriber> {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO subscribers (id, email, data) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [subscriber.id, subscriber.email, JSON.stringify(subscriber)],
    );
    return subscriber;
  },

  async updateSubscriberByToken(
    field: SubscriberTokenField,
    token: string,
    change: (current: Subscriber) => Subscriber,
  ): Promise<Subscriber | undefined> {
    return transaction(async (client) => {
      // FOR UPDATE holds the row for the length of the transaction, so a
      // prefetching mail client that opens the link twice cannot have both
      // reads see the pre-change state.
      const { rows } = await client.query<{ data: Subscriber }>(
        `SELECT data FROM subscribers WHERE data->>$1 = $2 FOR UPDATE`,
        [field, token],
      );
      const current = rows[0]?.data;
      if (current === undefined) return undefined;
      const next = change(current);
      await client.query(
        "UPDATE subscribers SET data = $2, updated_at = now() WHERE id = $1",
        [next.id, JSON.stringify(next)],
      );
      return next;
    });
  },

  /**
   * Stamp the issue week, and report how many rows that actually changed.
   *
   * The `lastSentWeek` check is in the WHERE clause rather than in application
   * code: it is what makes a second run of the cron job a no-op, and doing it
   * in the database means two schedulers firing at once cannot both decide a
   * subscriber is unstamped.
   */
  async markIssueSent(ids: readonly string[], weekKey: string): Promise<number> {
    if (ids.length === 0) return 0;
    await ensureSchema();
    const { rowCount } = await getPool().query(
      `UPDATE subscribers
          SET data = jsonb_set(data, '{lastSentWeek}', to_jsonb($2::text)), updated_at = now()
        WHERE id = ANY($1::text[])
          AND coalesce(data->>'lastSentWeek', '') <> $2`,
      [[...ids], weekKey],
    );
    return rowCount ?? 0;
  },

  listAccounts: () => all<Account>("accounts"),
  getAccount: (id) => one<Account>("accounts", id),

  async findAccountByEmail(email: string): Promise<Account | undefined> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: Account }>(
      "SELECT data FROM accounts WHERE lower(email) = lower($1)",
      [email.trim()],
    );
    return rows[0]?.data;
  },

  async saveAccount(account: Account): Promise<Account> {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO accounts (id, email, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data, updated_at = now()`,
      [account.id, account.email, JSON.stringify(account)],
    );
    return account;
  },

  /**
   * One statement, so concurrent views cannot lose each other.
   *
   * `views + 1` is evaluated by the database against the row it just locked for
   * the update, which a read-then-write from the application cannot promise.
   */
  async recordBlogView(slug: string, at: string): Promise<BlogViewCount> {
    await ensureSchema();
    const { rows } = await getPool().query<{ views: string; last_viewed_at: Date }>(
      `INSERT INTO blog_views (slug, views, last_viewed_at) VALUES ($1, 1, $2)
       ON CONFLICT (slug) DO UPDATE
         SET views = blog_views.views + 1, last_viewed_at = EXCLUDED.last_viewed_at
       RETURNING views, last_viewed_at`,
      [slug, at],
    );
    const row = rows[0];
    // bigint arrives as a string from pg, deliberately, because it can exceed
    // what a JS number holds exactly. A view count never will.
    return {
      slug,
      views: row === undefined ? 1 : Number(row.views),
      lastViewedAt: at,
    };
  },

  async listBlogViews(): Promise<readonly BlogViewCount[]> {
    await ensureSchema();
    const { rows } = await getPool().query<{
      slug: string;
      views: string;
      last_viewed_at: Date;
    }>("SELECT slug, views, last_viewed_at FROM blog_views ORDER BY views DESC");
    return rows.map((r) => ({
      slug: r.slug,
      views: Number(r.views),
      lastViewedAt: r.last_viewed_at.toISOString(),
    }));
  },

  async appendAudit(event: AuditEvent): Promise<AuditEvent> {
    await ensureSchema();
    // ON CONFLICT DO NOTHING rather than an upsert: a replayed write must not
    // be able to rewrite history, only to be ignored.
    await getPool().query(
      `INSERT INTO audit_events (id, at, subject, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, event.at, event.subject ?? null, JSON.stringify(event)],
    );
    return event;
  },

  async listAudit(
    { limit = 200, subject }: { limit?: number; subject?: string } = {},
  ): Promise<readonly AuditEvent[]> {
    await ensureSchema();
    const { rows } =
      subject === undefined
        ? await getPool().query<{ data: AuditEvent }>(
            "SELECT data FROM audit_events ORDER BY at DESC LIMIT $1",
            [limit],
          )
        : await getPool().query<{ data: AuditEvent }>(
            "SELECT data FROM audit_events WHERE subject = $2 ORDER BY at DESC LIMIT $1",
            [limit, subject],
          );
    return rows.map((r) => r.data);
  },

  async replaceAll(db: Database): Promise<void> {
    await transaction(async (client) => {
      for (const [table, rows] of [
        ["deals", db.deals],
        ["buy_boxes", db.buyBoxes],
        ["funding_boxes", db.fundingBoxes],
      ] as const) {
        await client.query(`DELETE FROM ${table}`);
        for (const row of rows) {
          await client.query(`INSERT INTO ${table} (id, data) VALUES ($1, $2)`, [
            row.id,
            JSON.stringify(row),
          ]);
        }
      }
      // Subscribers, accounts and the audit trail survive a reseed. All three
      // are evidence — of consent, of who had access, and of who looked at
      // what — and a reseed is a development convenience.
      for (const a of db.accounts) {
        await client.query(
          `INSERT INTO accounts (id, email, data) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data, updated_at = now()`,
          [a.id, a.email, JSON.stringify(a)],
        );
      }
      for (const e of db.auditEvents) {
        await client.query(
          `INSERT INTO audit_events (id, at, subject, data) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [e.id, e.at, e.subject ?? null, JSON.stringify(e)],
        );
      }
      // View counts survive a reseed for the same reason the audit trail does:
      // they are a record of something that happened, and a reseed is a
      // development convenience. Restored with GREATEST so replaying an older
      // export cannot walk a live counter backwards.
      for (const v of db.blogViews) {
        await client.query(
          `INSERT INTO blog_views (slug, views, last_viewed_at) VALUES ($1, $2, $3)
           ON CONFLICT (slug) DO UPDATE
             SET views = GREATEST(blog_views.views, EXCLUDED.views),
                 last_viewed_at = GREATEST(blog_views.last_viewed_at, EXCLUDED.last_viewed_at)`,
          [v.slug, v.views, v.lastViewedAt],
        );
      }
      for (const s of db.subscribers) {
        await client.query(
          `INSERT INTO subscribers (id, email, data) VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [s.id, s.email, JSON.stringify(s)],
        );
      }
    });
  },

  async isEmpty(): Promise<boolean> {
    await ensureSchema();
    const { rows } = await getPool().query<{ empty: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM deals
         UNION ALL SELECT 1 FROM buy_boxes
         UNION ALL SELECT 1 FROM funding_boxes
       ) AS empty`,
    );
    return rows[0]?.empty ?? true;
  },
};

/** Close the pool. Used by tests and by any script that must exit cleanly. */
export async function closePostgres(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
    ready = undefined;
  }
}
