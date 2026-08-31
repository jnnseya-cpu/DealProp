import { Pool, type PoolClient } from "pg";
import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { Subscriber } from "@shared/domain/newsletter";
import type { Account } from "@shared/domain/accounts";
import type { AgentDecision } from "@shared/domain/agents";
import { add, money, sub, ZERO, type Money } from "@shared/money";
import {
  availableBalance,
  dueForExpiry,
  planSpend,
  reversalImpact,
  reversalShare,
  type CreditLot,
  type LedgerEntry,
} from "@shared/domain/ledger";
import type { Subscription } from "@shared/domain/entitlements";
import type {
  AllowanceInput,
  AllowanceResult,
  AuditEvent,
  BlogViewCount,
  NoteInput,
  ReversalInput,
  ReversalResult,
  SpendInput,
  SpendResult,
  DataRoomGrant,
  OutreachMessage,
  PendingCharge,
  StoredCandidate,
  Suppression,
  TopUpInput,
  TopUpResult,
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
  CREATE TABLE IF NOT EXISTS subscriptions (
    account_id text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  -- Every provider event acted on, once. The primary key IS the replay
  -- defence: a redelivered event fails to insert and is skipped.
  CREATE TABLE IF NOT EXISTS billing_events (
    event_id text PRIMARY KEY,
    type text NOT NULL,
    at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_lots (
    id text PRIMARY KEY,
    account_id text NOT NULL,
    kind text NOT NULL,
    original bigint NOT NULL,
    remaining bigint NOT NULL,
    cash_gross bigint NOT NULL DEFAULT 0,
    cash_tax bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    payment_reference text,
    voided_at timestamptz,
    voided_reason text,
    -- Balance can be spent to zero and no further. A negative remaining would
    -- mean the service was given away, so the database refuses it outright
    -- rather than relying on every caller to check first.
    CONSTRAINT credit_lots_remaining_in_range CHECK (remaining >= 0 AND remaining <= original)
  );
  CREATE INDEX IF NOT EXISTS credit_lots_account ON credit_lots (account_id);
  CREATE INDEX IF NOT EXISTS credit_lots_payment ON credit_lots (payment_reference);
  -- Append-only, like the audit trail: no UPDATE or DELETE statement against
  -- this table exists anywhere in the codebase. The unique key is what makes
  -- every money movement happen at most once.
  CREATE TABLE IF NOT EXISTS ledger_entries (
    id text PRIMARY KEY,
    idempotency_key text NOT NULL UNIQUE,
    account_id text NOT NULL,
    kind text NOT NULL,
    amount bigint NOT NULL,
    lot_id text,
    reference text,
    at timestamptz NOT NULL,
    reason text NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries (account_id, at);
  -- Discovered funders, quarantined until a person approves them.
  CREATE TABLE IF NOT EXISTS outreach_messages (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL
  );
  -- Keyed by address, because one mailbox can appear against several
  -- organisations and somebody who asked to be left alone asked once.
  CREATE TABLE IF NOT EXISTS suppressions (
    email text PRIMARY KEY,
    reason text NOT NULL,
    at timestamptz NOT NULL
  );
  -- Capability tokens granting one funder time-limited access to one deal.
  CREATE TABLE IF NOT EXISTS data_room_grants (
    token text PRIMARY KEY,
    deal_id text NOT NULL,
    data jsonb NOT NULL,
    expires_at timestamptz NOT NULL
  );
  -- What a named person decided about an agent proposal. Appended, never
  -- edited: a change of mind is a second row, and the board reads the latest.
  CREATE TABLE IF NOT EXISTS agent_decisions (
    id text PRIMARY KEY,
    deal_id text NOT NULL,
    agent_id text NOT NULL,
    proposal_key text NOT NULL,
    data jsonb NOT NULL,
    at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_decisions_deal ON agent_decisions (deal_id, at DESC);
  CREATE TABLE IF NOT EXISTS pending_charges (
    id text PRIMARY KEY,
    account_id text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discovery_candidates (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    discovered_at timestamptz NOT NULL,
    approved_at timestamptz
  );
  -- Append-only enforced by the database, not by convention.
  --
  -- Every statement in this codebase against these tables is an INSERT, but
  -- that is a fact about today's code. This makes it a fact about the table: an
  -- UPDATE or DELETE from a later refactor, a migration script, or somebody at
  -- a psql prompt is silently discarded rather than quietly rewriting what
  -- money did. A ledger that can be edited answers no question worth asking,
  -- and the question is always asked after money has already gone missing.
  --
  -- A TRIGGER, and never again a RULE. This was a pair of DO INSTEAD NOTHING
  -- rules, and Postgres refuses INSERT ... ON CONFLICT against any table
  -- carrying an INSERT or UPDATE rule — so recordNote() threw on every call,
  -- which is the path that records a chargeback debt, a provider fee or a
  -- manual correction. The file store has no such restriction, so it passed;
  -- the engine that runs in production did not. Do not "simplify" this back
  -- to a rule.
  CREATE OR REPLACE FUNCTION lode_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $lode$ BEGIN RETURN NULL; END; $lode$;
  DROP RULE IF EXISTS ledger_entries_no_update ON ledger_entries;
  DROP RULE IF EXISTS ledger_entries_no_delete ON ledger_entries;
  DROP RULE IF EXISTS audit_events_no_update ON audit_events;
  DROP RULE IF EXISTS audit_events_no_delete ON audit_events;
  DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
  CREATE TRIGGER ledger_entries_append_only
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION lode_append_only();
  DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
  CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION lode_append_only();
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


/* --------------------------------------------------- billing row mapping */

interface LotRow {
  id: string;
  account_id: string;
  kind: string;
  original: string;
  remaining: string;
  cash_gross: string;
  cash_tax: string;
  created_at: Date;
  expires_at: Date;
  payment_reference: string | null;
  voided_at: Date | null;
  voided_reason: string | null;
}

interface EntryRow {
  id: string;
  idempotency_key: string;
  account_id: string;
  kind: string;
  amount: string;
  lot_id: string | null;
  reference: string | null;
  at: Date;
  reason: string;
}

/**
 * bigint arrives from pg as a string, deliberately: it can exceed what a
 * JavaScript number holds exactly. Money here never will — the largest figure
 * in the catalogue is a few hundred thousand pence — so converting is safe, and
 * `money()` re-checks that it is a safe integer rather than assuming.
 */
function toLot(row: LotRow): CreditLot {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind === "granted" ? "granted" : "purchased",
    original: money(Number(row.original)),
    remaining: money(Number(row.remaining)),
    cashGross: money(Number(row.cash_gross)),
    cashTax: money(Number(row.cash_tax)),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    ...(row.payment_reference !== null ? { paymentReference: row.payment_reference } : {}),
    ...(row.voided_at !== null ? { voidedAt: row.voided_at.toISOString() } : {}),
    ...(row.voided_reason !== null ? { voidedReason: row.voided_reason } : {}),
  };
}

function toEntry(row: EntryRow): LedgerEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    accountId: row.account_id,
    kind: row.kind as LedgerEntry["kind"],
    amount: money(Number(row.amount)),
    ...(row.lot_id !== null ? { lotId: row.lot_id } : {}),
    ...(row.reference !== null ? { reference: row.reference } : {}),
    idempotencyKey: row.idempotency_key,
    reason: row.reason,
  };
}

async function insertLot(client: PoolClient, lot: CreditLot): Promise<void> {
  await client.query(
    `INSERT INTO credit_lots
       (id, account_id, kind, original, remaining, cash_gross, cash_tax, created_at, expires_at, payment_reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      lot.id,
      lot.accountId,
      lot.kind,
      lot.original,
      lot.remaining,
      lot.cashGross,
      lot.cashTax,
      lot.createdAt,
      lot.expiresAt,
      lot.paymentReference ?? null,
    ],
  );
}

async function insertEntry(client: PoolClient, entry: LedgerEntry): Promise<void> {
  await client.query(
    `INSERT INTO ledger_entries
       (id, idempotency_key, account_id, kind, amount, lot_id, reference, at, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.id,
      entry.idempotencyKey,
      entry.accountId,
      entry.kind,
      entry.amount,
      entry.lotId ?? null,
      entry.reference ?? null,
      entry.at,
      entry.reason,
    ],
  );
}

async function balanceIn(client: PoolClient, accountId: string, at: string): Promise<Money> {
  const { rows } = await client.query<LotRow>(
    "SELECT * FROM credit_lots WHERE account_id = $1",
    [accountId],
  );
  return availableBalance(rows.map(toLot), new Date(at));
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


  /* ------------------------------------------------------------- billing */

  async getSubscription(accountId: string): Promise<Subscription | undefined> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: Subscription }>(
      "SELECT data FROM subscriptions WHERE account_id = $1",
      [accountId],
    );
    return rows[0]?.data;
  },

  async listSubscriptions(): Promise<readonly Subscription[]> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: Subscription }>("SELECT data FROM subscriptions");
    return rows.map((r) => r.data);
  },

  async saveSubscription(subscription: Subscription): Promise<Subscription> {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO subscriptions (account_id, data) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [subscription.accountId, JSON.stringify(subscription)],
    );
    return subscription;
  },

  async claimBillingEvent(eventId: string, type: string, at: string): Promise<boolean> {
    await ensureSchema();
    // The primary key does the work. Two concurrent deliveries both attempt the
    // insert and exactly one reports a row; there is no window between checking
    // and claiming because there is no check.
    const { rowCount } = await getPool().query(
      `INSERT INTO billing_events (event_id, type, at) VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, type, at],
    );
    return (rowCount ?? 0) > 0;
  },

  async listCreditLots(accountId: string): Promise<readonly CreditLot[]> {
    await ensureSchema();
    const { rows } = await getPool().query<LotRow>(
      "SELECT * FROM credit_lots WHERE account_id = $1 ORDER BY expires_at, created_at",
      [accountId],
    );
    return rows.map(toLot);
  },

  async listLedgerEntries(accountId: string): Promise<readonly LedgerEntry[]> {
    await ensureSchema();
    const { rows } = await getPool().query<EntryRow>(
      "SELECT * FROM ledger_entries WHERE account_id = $1 ORDER BY at, id",
      [accountId],
    );
    return rows.map(toEntry);
  },

  async applyTopUp(input: TopUpInput): Promise<TopUpResult> {
    return transaction(async (client) => {
      const seen = await client.query(
        "SELECT 1 FROM ledger_entries WHERE idempotency_key = $1",
        [input.idempotencyKey],
      );
      if ((seen.rowCount ?? 0) > 0) {
        return {
          applied: false,
          duplicate: true,
          balance: await balanceIn(client, input.accountId, input.at),
          reason: "This top-up has already been applied.",
        };
      }

      await insertLot(client, {
        id: input.purchased.lotId,
        accountId: input.accountId,
        kind: "purchased",
        original: input.purchased.amount,
        remaining: input.purchased.amount,
        cashGross: input.purchased.cashGross,
        cashTax: input.purchased.cashTax,
        createdAt: input.at,
        expiresAt: input.purchased.expiresAt,
        paymentReference: input.paymentReference,
      });
      await insertEntry(client, {
        id: `${input.entryIdPrefix}-purchased`,
        at: input.at,
        accountId: input.accountId,
        kind: "topup",
        amount: input.purchased.amount,
        lotId: input.purchased.lotId,
        reference: input.paymentReference,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      });

      if (input.granted !== undefined) {
        await insertLot(client, {
          id: input.granted.lotId,
          accountId: input.accountId,
          kind: "granted",
          original: input.granted.amount,
          remaining: input.granted.amount,
          cashGross: ZERO,
          cashTax: ZERO,
          createdAt: input.at,
          expiresAt: input.granted.expiresAt,
          paymentReference: input.paymentReference,
        });
        await insertEntry(client, {
          id: `${input.entryIdPrefix}-granted`,
          at: input.at,
          accountId: input.accountId,
          kind: "topup",
          amount: input.granted.amount,
          lotId: input.granted.lotId,
          reference: input.paymentReference,
          idempotencyKey: `${input.idempotencyKey}:granted`,
          reason: `${input.reason} (bonus, not refundable in cash)`,
        });
      }

      return {
        applied: true,
        duplicate: false,
        balance: await balanceIn(client, input.accountId, input.at),
        reason: "Applied.",
      };
    });
  },

  async spendCredits(input: SpendInput): Promise<SpendResult> {
    return transaction(async (client) => {
      const seen = await client.query(
        "SELECT 1 FROM ledger_entries WHERE idempotency_key = $1",
        [input.idempotencyKey],
      );
      if ((seen.rowCount ?? 0) > 0) {
        return {
          ok: true,
          duplicate: true,
          shortfall: ZERO,
          balance: await balanceIn(client, input.accountId, input.at),
          reason: "Already charged for this operation.",
        };
      }

      // FOR UPDATE locks this account's lots for the rest of the transaction,
      // so a second concurrent spend waits here rather than reading the same
      // balance and succeeding alongside the first.
      const { rows } = await client.query<LotRow>(
        "SELECT * FROM credit_lots WHERE account_id = $1 ORDER BY expires_at, created_at FOR UPDATE",
        [input.accountId],
      );
      const lots = rows.map(toLot);
      const now = new Date(input.at);
      const plan = planSpend(lots, input.amount, now);

      if (!plan.ok) {
        return {
          ok: false,
          duplicate: false,
          shortfall: plan.shortfall,
          balance: availableBalance(lots, now),
          reason: plan.reason,
        };
      }

      let index = 0;
      for (const allocation of plan.allocations) {
        await client.query(
          "UPDATE credit_lots SET remaining = remaining - $2 WHERE id = $1",
          [allocation.lotId, allocation.amount],
        );
        await insertEntry(client, {
          id: `${input.entryIdPrefix}-${index}`,
          at: input.at,
          accountId: input.accountId,
          kind: "spend",
          amount: money(-allocation.amount),
          lotId: allocation.lotId,
          reference: input.reference,
          idempotencyKey: index === 0 ? input.idempotencyKey : `${input.idempotencyKey}:${index}`,
          reason: input.reason,
        });
        index += 1;
      }

      return {
        ok: true,
        duplicate: false,
        shortfall: ZERO,
        balance: await balanceIn(client, input.accountId, input.at),
        reason: plan.reason,
      };
    });
  },

  async reverseLotsForPayment(input: ReversalInput): Promise<ReversalResult> {
    return transaction(async (client) => {
      const { rows } = await client.query<LotRow>(
        "SELECT * FROM credit_lots WHERE payment_reference = $1 AND voided_at IS NULL FOR UPDATE",
        [input.paymentReference],
      );

      let lotsReversed = 0;
      let balanceRemoved = ZERO;
      let debt = ZERO;

      // One share for the whole payment, decided before any lot is touched.
      const share = reversalShare(rows.map(toLot), input.refundedGross);

      for (const row of rows) {
        const lot = toLot(row);
        const impact = reversalImpact(lot, share);
        if (impact.balanceRemoved <= 0 && impact.debt <= 0 && !impact.voids) continue;

        await client.query(
          `UPDATE credit_lots
             SET remaining = remaining - $2,
                 voided_at = CASE WHEN $3 THEN $4::timestamptz ELSE voided_at END,
                 voided_reason = CASE WHEN $3 THEN $5 ELSE voided_reason END
           WHERE id = $1`,
          [lot.id, impact.balanceRemoved, impact.voids, input.at, input.kind],
        );

        await insertEntry(client, {
          id: `${input.entryIdPrefix}-${lotsReversed}`,
          at: input.at,
          accountId: lot.accountId,
          kind: input.kind,
          amount: money(-impact.balanceRemoved),
          lotId: lot.id,
          reference: input.paymentReference,
          idempotencyKey: `${input.kind}:${input.paymentReference}:${lot.id}`,
          reason: `Payment ${input.paymentReference} reversed. ${impact.reason}`,
        });

        if (impact.debt > 0) {
          await insertEntry(client, {
            id: `${input.entryIdPrefix}-${lotsReversed}-debt`,
            at: input.at,
            accountId: lot.accountId,
            kind: "debt",
            amount: money(-impact.debt),
            lotId: lot.id,
            reference: input.paymentReference,
            idempotencyKey: `debt:${input.paymentReference}:${lot.id}`,
            reason: "Balance was spent before the payment was reversed.",
          });
          debt = add(debt, impact.debt);
        }

        balanceRemoved = add(balanceRemoved, impact.balanceRemoved);
        lotsReversed += 1;
      }

      return { lotsReversed, balanceRemoved, debt };
    });
  },

  async listDiscoveryCandidates(): Promise<readonly StoredCandidate[]> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: StoredCandidate }>(
      "SELECT data FROM discovery_candidates ORDER BY discovered_at DESC",
    );
    return rows.map((r) => r.data);
  },

  async saveDiscoveryCandidate(entry: StoredCandidate): Promise<StoredCandidate> {
    return transaction(async (client) => {
      const { rows } = await client.query<{ data: StoredCandidate }>(
        "SELECT data FROM discovery_candidates WHERE id = $1 FOR UPDATE",
        [entry.candidate.id],
      );
      const existing = rows[0]?.data;
      // Suppression and approval survive a rerun. Neither is something a fresh
      // crawl gets to withdraw.
      const merged: StoredCandidate = {
        ...entry,
        candidate: {
          ...entry.candidate,
          optedOut: entry.candidate.optedOut || (existing?.candidate.optedOut ?? false),
          doNotContact: entry.candidate.doNotContact || (existing?.candidate.doNotContact ?? false),
        },
        ...(existing?.approvedAt !== undefined
          ? { approvedAt: existing.approvedAt, approvedBy: existing.approvedBy }
          : {}),
      };
      await client.query(
        `INSERT INTO discovery_candidates (id, data, discovered_at, approved_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, approved_at = EXCLUDED.approved_at`,
        [merged.candidate.id, JSON.stringify(merged), merged.discoveredAt, merged.approvedAt ?? null],
      );
      return merged;
    });
  },

  async listOutreachMessages(): Promise<readonly OutreachMessage[]> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: OutreachMessage }>(
      "SELECT data FROM outreach_messages ORDER BY created_at DESC",
    );
    return rows.map((r) => r.data);
  },

  async saveOutreachMessage(message: OutreachMessage): Promise<OutreachMessage> {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO outreach_messages (id, data, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [message.id, JSON.stringify(message), message.createdAt],
    );
    return message;
  },

  async listSuppressions(): Promise<readonly Suppression[]> {
    await ensureSchema();
    const { rows } = await getPool().query<{ email: string; reason: string; at: Date }>(
      "SELECT email, reason, at FROM suppressions",
    );
    return rows.map((r) => ({ email: r.email, reason: r.reason, at: r.at.toISOString() }));
  },

  async addSuppression(entry: Suppression): Promise<boolean> {
    await ensureSchema();
    const { rowCount } = await getPool().query(
      `INSERT INTO suppressions (email, reason, at) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [entry.email.trim().toLowerCase(), entry.reason, entry.at],
    );
    return (rowCount ?? 0) > 0;
  },

  async listAgentDecisions(dealId: string): Promise<readonly AgentDecision[]> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: AgentDecision }>(
      "SELECT data FROM agent_decisions WHERE deal_id = $1 ORDER BY at DESC",
      [dealId],
    );
    return rows.map((r) => r.data);
  },

  async saveAgentDecision(decision: AgentDecision): Promise<AgentDecision> {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO agent_decisions (id, deal_id, agent_id, proposal_key, data, at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [decision.id, decision.dealId, decision.agentId, decision.proposalKey, JSON.stringify(decision), decision.at],
    );
    return decision;
  },

  async listDataRoomGrants(): Promise<readonly DataRoomGrant[]> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: DataRoomGrant }>(
      "SELECT data FROM data_room_grants ORDER BY expires_at DESC",
    );
    return rows.map((r) => r.data);
  },

  async getDataRoomGrant(token: string): Promise<DataRoomGrant | undefined> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: DataRoomGrant }>(
      "SELECT data FROM data_room_grants WHERE token = $1",
      [token],
    );
    return rows[0]?.data;
  },

  async saveDataRoomGrant(grant: DataRoomGrant): Promise<DataRoomGrant> {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO data_room_grants (token, deal_id, data, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET data = EXCLUDED.data`,
      [grant.token, grant.dealId, JSON.stringify(grant), grant.expiresAt],
    );
    return grant;
  },

  async getPendingCharge(id: string): Promise<PendingCharge | undefined> {
    await ensureSchema();
    const { rows } = await getPool().query<{ data: PendingCharge }>(
      "SELECT data FROM pending_charges WHERE id = $1",
      [id],
    );
    return rows[0]?.data;
  },

  async savePendingCharge(charge: PendingCharge): Promise<PendingCharge> {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO pending_charges (id, account_id, data, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [charge.id, charge.accountId, JSON.stringify(charge), charge.createdAt],
    );
    return charge;
  },

  async recordAllowanceUse(input: AllowanceInput): Promise<AllowanceResult> {
    return transaction(async (client) => {
      // Serialise this account's period before counting it.
      //
      // `FOR UPDATE` locks rows that exist, and the rows that matter here are
      // the ones that do not exist yet: with the period empty, ten concurrent
      // requests all locked nothing, all read a count of zero, and all
      // inserted. Against a limit of three, six were granted. An advisory lock
      // is taken on the *key* rather than on rows, so the first transaction in
      // holds it whether or not the period has any entries, and it is released
      // when that transaction ends.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        input.accountId,
        input.periodStart,
      ]);

      const { rows } = await client.query<{ idempotency_key: string }>(
        `SELECT idempotency_key FROM ledger_entries
          WHERE account_id = $1 AND kind = 'allowance' AND at >= $2`,
        [input.accountId, input.periodStart],
      );

      const used = rows.length;
      if (rows.some((r) => r.idempotency_key === input.idempotencyKey)) {
        return {
          allowed: true,
          duplicate: true,
          used,
          limit: input.limit,
          reason: "Already counted in this period.",
        };
      }

      if (used >= input.limit) {
        return {
          allowed: false,
          duplicate: false,
          used,
          limit: input.limit,
          reason:
            input.limit === 0
              ? "This plan does not include any."
              : `All ${input.limit} included this period have been used.`,
        };
      }

      await insertEntry(client, {
        id: input.entryId,
        at: input.at,
        accountId: input.accountId,
        kind: "allowance",
        amount: ZERO,
        reference: input.reference,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      });

      return {
        allowed: true,
        duplicate: false,
        used: used + 1,
        limit: input.limit,
        reason: `${used + 1} of ${input.limit} used this period.`,
      };
    });
  },

  async recordNote(input: NoteInput): Promise<boolean> {
    await ensureSchema();
    const { rowCount } = await getPool().query(
      `INSERT INTO ledger_entries
         (id, idempotency_key, account_id, kind, amount, reference, at, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        input.entryId,
        input.idempotencyKey,
        input.accountId,
        input.kind,
        input.amount,
        input.reference ?? null,
        input.at,
        input.reason,
      ],
    );
    return (rowCount ?? 0) > 0;
  },

  async expireLapsedCredits(now: string, entryIdPrefix: string): Promise<number> {
    return transaction(async (client) => {
      const { rows } = await client.query<LotRow>(
        "SELECT * FROM credit_lots WHERE voided_at IS NULL AND remaining > 0 AND expires_at <= $1 FOR UPDATE",
        [now],
      );
      const due = dueForExpiry(rows.map(toLot), new Date(now));
      let index = 0;
      for (const expiry of due) {
        const lot = rows.map(toLot).find((l) => l.id === expiry.lotId);
        if (lot === undefined) continue;
        await client.query("UPDATE credit_lots SET remaining = 0 WHERE id = $1", [lot.id]);
        await insertEntry(client, {
          id: `${entryIdPrefix}-${index}`,
          at: now,
          accountId: lot.accountId,
          kind: "expire",
          amount: money(-expiry.amount),
          lotId: lot.id,
          idempotencyKey: `expire:${lot.id}`,
          reason: `Balance lapsed on ${expiry.expiredAt.slice(0, 10)}.`,
        });
        index += 1;
      }
      return due.length;
    });
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
