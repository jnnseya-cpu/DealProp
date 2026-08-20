# Architecture

How Lode is put together, why it is shaped this way, and where to extend it.

---

## 1. Layering

```
  ┌──────────────────────────────────────────────┐
  │  src/app          Next.js pages (server)     │  renders, never computes
  │    components/chrome.tsx  shared UI vocabulary│
  ├──────────────────────────────────────────────┤
  │  src/store        Repository over JSON        │  no domain logic
  ├──────────────────────────────────────────────┤
  │  src/domain       The engine                  │  pure, framework-free
  │    director.ts      orchestrates everything   │
  │    dealScore.ts     score + verdict           │
  │    strategies.ts    router, exits, recycling  │
  │    economics.ts     appraisal                 │
  │    capitalStack.ts  funding solver            │
  │    matching.ts      buy/funding boxes         │
  │    redteam.ts       stress testing            │
  │    protection.ts    seller safeguards         │
  │    goldmine.ts      opportunity mining        │
  │    completion.ts    close score, critical path│
  │    revenue.ts       monetisation              │
  │    motivation.ts    seller diagnostics        │
  │    jurisdictions/   ALL country-specific law  │
  ├──────────────────────────────────────────────┤
  │  src/lib/money.ts  Integer-pence primitives   │  depends on nothing
  └──────────────────────────────────────────────┘
```

**Dependency rule:** arrows point downward only. `src/domain` imports nothing
from `src/app` or `src/store`. The store imports domain *types* but no domain
*functions*. This is what makes the engine testable without a browser, a
database or a network, and it is why 229 tests run in under a second.

**The single-source rule:** the UI never computes a figure. `runDealDirector()`
returns one coherent position, and the page renders it. This is why the
memorandum, the Deal Score and the seller-facing options cannot disagree with
one another — there is only one place the number can come from.

---

## 2. Data flow for one deal

```
DealInputs (property + seller + price + finance + structure + exit)
    │
    ├─► getJurisdiction() ──► transfer tax, profit tax, structure rulings,
    │                          cost defaults, regulatory obligations
    │
    ├─► buildCostStack() ───► every cost, including the ones sourcers omit
    ├─► buildFunding() ─────► senior facility vs equity required
    ├─► buildExit() ────────► GDV, refinance advance, capital left in
    │        │
    │        └─► profitTax() ──► profit AFTER tax
    │
    ├─► diagnoseSeller() ───► motivation, urgency, complexity, flexibility
    ├─► assessSellerProtection() ──► flags, blocks, mandatory disclosures
    ├─► runRedTeam() ───────► 9 scenarios, tiered single vs compound
    ├─► scoreDeal() ────────► 9 components + hard gates + verdict
    ├─► routeStrategies() ──► 14 candidates, ranked, rejections explained
    ├─► buildExitMatrix() ──► how many ways out actually work
    ├─► capitalRecycle() ───► how much capital comes back
    └─► buildCapitalStack() ► layered funding, warnings
              │
              ▼
        DirectorBriefing ──► matching ──► Buy Boxes / Funding Boxes
                          └─► revenue  ──► permission-gated streams
```

Order matters. Protection and jurisdiction run before anything is presented: a
deal that must not be shown should not be scored, matched or packaged first.

---

## 3. Key types

`Money` is `number & { __brand: "Money" }` — a branded integer count of pence.
The brand means a raw `number` cannot be passed where money is expected, so
`price * 1.05` fails to compile and you are forced through `scale()`, which
rounds deterministically. `Bps` is the same idea for rates: 10,000 bps = 100%.

`JurisdictionPack` is the extension point for a new country. It carries the
transfer tax function, the profit tax estimator, cost defaults, per-structure
rulings and the regulatory obligations triggered by operating there.

`DealAppraisal` carries **both** `profitBeforeTax` and `profit` (after tax).
Everything downstream reads `profit`. `trueDiscountBps` is the honest
counterpart to `discountToOmvBps`.

`StressTier` (`single` | `compound`) is what stops the Red Team from flattening
every deal into one band — see §5.

---

## 4. Adding a jurisdiction

1. Create `src/domain/jurisdictions/xx-yy.ts` implementing `JurisdictionPack`.
2. Encode transfer tax as an explicit **band table**, not inline arithmetic, so
   updating rates is a data edit against a failing test.
3. Implement `profitTax` returning `requiresProfessionalReview: true` and real
   caveats. Do not guess rates you cannot cite.
4. Write a `structureStatus` ruling for **every** `StructureKind`. If you do not
   know, return `not-supported` — the engine treats that as "cannot be offered",
   which is the safe default. Never default to `permitted`.
5. Register in `jurisdictions/index.ts`.
6. Add to `DEAL_READY` **only** once the rates are verified and dated.
7. Add tests pinning the rates, including one asserting it differs from a
   neighbouring pack where it should.

`gb-sct.ts` is the reference implementation: different tax, different bands,
different surcharge, different conveyancing vocabulary, same interface.

---

## 5. Two subtleties worth preserving

**Stress tiering.** Compound scenarios stack several severe moves; the harshest
is deliberately near-unpassable. If a loss there capped the score the same way a
single-factor loss does, every deal would compress into one band and the score
would carry no information. So single-factor losses cap the composite;
compound-tail losses reduce it proportionately and are reported in full. If you
add a scenario, tag its tier honestly.

**Refurbishment tranching.** The senior facility advances against the purchase
price *plus* a works tranche, but interest is charged on roughly half the works
advance, because works are drawn progressively. Charging day-one interest on the
full budget overstates the cost of every phased project — which is all of them —
and makes well-financed BRR deals look unfundable. This was a real bug; the
comment in `seniorFacility()` explains it so it is not "simplified" back.

---

## 5a. Access control

`src/middleware.ts` is the outer boundary, and it is middleware rather than a
call at the top of each page for one reason: a guard that must be remembered is
a guard that gets forgotten the first time somebody adds a route. `/deals`,
`/invest` and `/capital` are denied by default; a new operator page is protected
by living under one of those paths.

Every operator page then calls `requireOperator()` as well. That is not
belt-and-braces for its own sake: Next.js has shipped middleware-bypass
advisories more than once — CVE-2025-29927 let a crafted
`x-middleware-subrequest` header skip middleware entirely — and these pages
render special-category personal data. A framework bug should not be the only
thing between an attacker and a seller's reported health concerns.

`src/lib/operator.ts` holds the session logic and uses Web Crypto rather than
`node:crypto`, because middleware runs in the edge runtime where `node:crypto`
is unavailable. `lib/tokens.ts` keeps using `node:crypto` since it only ever
runs on the server.

The cookie carries an HMAC of a fixed message under `OPERATOR_SECRET`, not the
secret. That means a stolen cookie cannot be replayed as the password, and
rotating the secret invalidates every live session without any stored state to
clear. With no secret set, the middleware returns 503 rather than rendering:
these pages carry special-category personal data and must not default to open.

Sellers have no account and never will need one to see their own result. Their
page is a capability URL — 32 bytes from a CSPRNG, the same model as the
newsletter confirm and unsubscribe links.

## 6. Storage

`src/store/` is three files and one interface:

- `schema.ts` — `DealRecord`, `Database`, and the `Store` interface both engines
  implement
- `fileStore.ts` — JSON on disk. Writes serialise through a promise chain and go
  via a temp file plus `rename()`, which is atomic on POSIX. Correct for a
  single-process dev server; **wrong on serverless**, where instances have
  separate ephemeral filesystems and never see each other's writes.
- `postgresStore.ts` — records stored whole as JSONB keyed by id. Read-modify-
  writes run in a transaction with `FOR UPDATE`; the newsletter's
  `lastSentWeek` check is in the `WHERE` clause, so two schedulers firing at
  once cannot both decide a subscriber is unstamped.

`repository.ts` selects between them on `DATABASE_URL` and is the only module
the rest of the app imports. The Postgres module is imported lazily, so a
machine with no database never loads the driver.

Storing records whole rather than relationally is deliberate. The domain types
are already the schema and are exhaustively tested; columns would be a second
definition of the same shapes, free to drift. `Money` is an integer count of
pence and survives JSON exactly, where a numeric column invites a float. What
Postgres is needed for is concurrency, durability and being reachable from more
than one process — none of which require the data to be relational. Querying
inside a record is what a JSONB index or a materialised view is for, and
neither changes this interface.

One contract suite runs against both engines. It is what keeps "swapping the
store changes no engine code" true rather than merely stated — and it has
already earned its place: it caught `{ ...EMPTY }` in the file store, a shallow
copy that let writes against a missing file mutate the module-level constant so
every later "empty" read started with the leftovers.

## 7. Where an LLM belongs

The engines here are deterministic on purpose. Financial arithmetic that decides
whether someone loses a deposit must be reproducible, testable and explainable,
and a language model is none of those things.

LLMs belong at the **edges**, converting unstructured input into the structured
types the engine already consumes, or structured output into prose:

| Task | Input | Output |
|---|---|---|
| Seller intake | Free-text narrative | `SellerSituation` + `SellerPriority[]` + `targetDays` |
| Title review | Register / lease PDF | `PropertyIssue[]` + a summary for the solicitor |
| Works estimation | Photographs, survey | `refurbishmentEstimate` with a stated range |
| Memorandum | `DirectorBriefing` | Investor-facing prose |
| Negotiation | `maxViablePrice` + diagnostics | A drafted approach to the agent |

The pattern in every row: the model proposes a **structured value**, the engine
decides. A model must never be able to set a score, clear a protection flag, or
assert that a structure is permitted.

---

## 8. Shared UI vocabulary

`src/app/components/chrome.tsx` holds everything visual that more than one page
needs: the mark, the header, the verdict labels and colours, the score scale.
These had each been re-implemented per page, which is how a verdict ends up
labelled "Negotiate" on one screen and something else on another. One
definition each.

The same rule applies to `src/lib/format.ts`, which is pure and framework-free
so the domain layer can use it. Five modules had each grown a private `fmt()`
that formatted pounds slightly differently — money shown to a seller in one
place and a lender in another must be formatted identically, or the figures
look like they disagree when they do not. Tailwind class helpers deliberately
live in chrome.tsx rather than lib/format, because lib/format is a domain
dependency and colour is not.

## 9. Build order from here

1. **Postgres** — once concurrent writes are real.
2. **Per-person auth and investor categorisation** — the shared operator
   password closes the data-exposure hole but is not accounts, and investor
   categorisation is still required before deal material reaches a private
   investor. See `docs/REGULATORY.md` §2.
3. **GoldMine adapter** — only after a licensed data source exists.
