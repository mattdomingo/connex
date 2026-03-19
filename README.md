# Connex

An invite-only relationship graph app for mapping real-world relationships and
exploring how people are connected.

---

## Stack

| Layer     | Choice                              | Why                                                    |
| --------- | ----------------------------------- | ------------------------------------------------------ |
| Monorepo  | npm workspaces                      | Zero extra tooling, one `npm install`                  |
| Backend   | Fastify (TypeScript)                | Lightweight, first-class TS, schema validation         |
| Database  | SQLite (`better-sqlite3`) + Drizzle | Real file-backed DB, no external setup, typed queries  |
| Frontend  | Vite + React + React Router         | Standard, fast HMR                                     |
| Graph viz | `react-force-graph-2d`              | Canvas force layout, handles a few hundred nodes fine  |
| Auth      | bcrypt + JWT (httpOnly cookie)      | Simple, secure-enough session model for a prototype    |
| Testing   | Vitest                              | Native TS, consistent with Vite                        |

## Layout

```
packages/
  shared/   — shared TypeScript contracts (request/response shapes, enums)
  server/
    src/
      db/           — schema, connection, seed
      domain/       — PURE graph algorithms, entitlement policy, invites, connections
      routes/       — Fastify route handlers (thin; delegate to domain)
      auth/         — bcrypt/JWT helpers + requireAuth middleware
    tests/          — Vitest unit tests for domain logic
  web/
    src/
      api/          — fetch client + auth context
      pages/        — Login, Register, Graph, Connections, People, Invites, Profile
data/               — SQLite file lives here (git-ignored)
```

## Key domain decisions

1. **Unified person model.** Every identity is a row in `people` — registered
   users *and* non-user "contacts". `users.person_id` points at a `people` row.
   When someone registers with an email matching an existing unclaimed person,
   the account claims that node. All graph edges reference `people.id`, never
   `users.id`, so future merges are just pointer rewrites.

2. **Undirected canonical edges.** Connections store `a_person_id < b_person_id`
   with a partial unique index on `(a, b, relationship_type) WHERE status != 'rejected'`.
   You can be both a *friend* and *coworker* of someone, but not have two
   *friend* edges.

3. **Confirmation model.** Edges between two *registered* users start `pending`
   and the other party must accept. Edges involving an unclaimed person are
   `active` immediately (no one to confirm). Edges a third party maps between
   two other people are also `active` — revisit if gaming becomes an issue.
   **Pending edges do not participate in pathfinding** — you can't fabricate a
   route by claiming an unconfirmed connection.

4. **Entitlement is separate from traversal.** `domain/graph.ts` computes full
   BFS/shortest-path over active edges. `domain/entitlement.ts` is a pure
   policy function (`maxVisibleDegree(viewer)`). `domain/graph-service.ts`
   glues them: computes truth, then masks. Free tier sees 1°–2° fully; 3°+
   nodes are returned with `locked: true` and redacted names (initials only).
   Premium sees through 6°.

5. **Shortest-path gating.** If path length exceeds entitlement, the result
   is returned with `locked: true`, start + target revealed, intermediaries
   redacted — useful as a teaser.

---

## Setup

Prerequisites: Node ≥ 20.

```bash
npm install
npm run seed     # creates data/connex.db and populates demo network
npm run dev      # starts backend (:3001) + frontend (:5173) concurrently
```

Open **http://localhost:5173**.

### Demo accounts

| Email               | Password      | Tier    | Notes                               |
| ------------------- | ------------- | ------- | ----------------------------------- |
| `alice@example.com` | `password123` | premium | 5 direct connections, deep network  |
| `bob@example.com`   | `password123` | free    | Good for testing locked 3° view     |
| `carol@example.com` | `password123` | free    |                                     |

Alice has a pending family-connection request from Bob in her inbox.

### Registering fresh accounts

Use the bootstrap invite code **`CONNEX-BOOTSTRAP`** (or any code generated on
the Invites page). Direct link: `http://localhost:5173/register?invite=CONNEX-BOOTSTRAP`

---

## Scripts

| Command            | Does                                              |
| ------------------ | ------------------------------------------------- |
| `npm run dev`      | Run server + web together with hot reload         |
| `npm run seed`     | Wipe and repopulate `data/connex.db` with demo    |
| `npm run test`     | Run backend domain tests (Vitest)                 |
| `npm run typecheck`| Typecheck all workspaces                          |
| `npm run build`    | Production build of all packages                  |

Per-package scripts are available under `npm run <script> -w @connex/<pkg>`.

---

## Testing locked-degree behavior manually

1. Log in as **bob@example.com** (free tier).
2. Graph page → set Depth to **3°**.
3. Purple-bordered nodes with initials like `M.S. (locked)` are 3°+ people.
4. Click one — the detail panel shows "hidden on your current plan".
5. Search for `Sakura` (a company) with max degree 3 → locked result row.
6. Switch to **alice@example.com** (premium) → same depth, all unlocked.

## API surface (all under `/api`)

| Method | Path                        | Auth | Description                        |
| ------ | --------------------------- | ---- | ---------------------------------- |
| POST   | `/auth/register`            |      | Invite-gated signup                |
| POST   | `/auth/login`               |      | Cookie session                     |
| POST   | `/auth/logout`              |      |                                    |
| GET    | `/auth/me`                  | ✓    | Current user + profile             |
| GET    | `/auth/invite/:code`        |      | Pre-validate an invite             |
| PATCH  | `/profile`                  | ✓    | Update own person fields           |
| GET    | `/invites`                  | ✓    | Your invite codes                  |
| POST   | `/invites`                  | ✓    | Generate invite                    |
| POST   | `/invites/:id/revoke`       | ✓    |                                    |
| GET    | `/people?q=`                | ✓    | Name-search for autocomplete       |
| POST   | `/people`                   | ✓    | Add a non-user contact             |
| GET    | `/people/:id`               | ✓    |                                    |
| GET    | `/connections`              | ✓    | Your edges (hydrated)              |
| GET    | `/connections/pending`      | ✓    | Requests awaiting your confirmation|
| POST   | `/connections`              | ✓    | Create edge (may start pending)    |
| POST   | `/connections/:id/respond`  | ✓    | Accept/reject                      |
| GET    | `/graph/explore?degree=N`   | ✓    | BFS neighborhood + entitlement mask|
| GET    | `/graph/path?to=ID`         | ✓    | Shortest path viewer→target        |
| GET    | `/graph/search?q=&...`      | ✓    | Degree-scoped people search        |
| GET    | `/gmail/status`             | ✓    | Connected account + last sync      |
| GET    | `/gmail/connect`            | ✓    | Begin Google OAuth redirect        |
| GET    | `/gmail/callback`           |      | OAuth code exchange (state-checked)|
| POST   | `/gmail/sync`               | ✓    | Ingest metadata → score → bridge   |
| POST   | `/gmail/revoke`             | ✓    | Disconnect + purge all Gmail data  |

---

## Gmail relationship ingestion

Connex can infer relationship edges from Gmail message **envelopes** (From / To
/ Cc / Date only — no subjects, no bodies, ever). Ingested contacts appear as
first-degree `other` connections in the graph with a trust score derived from
email volume, recency, thread count, and direction.

### Environment variables

| Var                     | Required | Default                                              | Purpose                                  |
| ----------------------- | -------- | ---------------------------------------------------- | ---------------------------------------- |
| `GOOGLE_CLIENT_ID`      | yes¹     |                                                      | OAuth client ID                          |
| `GOOGLE_CLIENT_SECRET`  | yes¹     |                                                      | OAuth client secret                      |
| `GOOGLE_REDIRECT_URI`   | no       | `http://localhost:3001/api/gmail/callback`           | Must match the console redirect URI      |
| `ENCRYPTION_KEY`        | yes¹     | all-zero dev key                                     | 64-hex-char AES-256-GCM key for tokens   |
| `GMAIL_LOOKBACK_DAYS`   | no       | `730`                                                | Window for the first full sync           |
| `GMAIL_MAX_PER_SYNC`    | no       | `2000`                                               | Hard cap on message fetches per sync     |

¹ Required to connect a real Google account. Tests mock the OAuth exchange and
Gmail API, so `npm run test` works without any of these set.

Generate an `ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Google Cloud setup (once)

1. Create a project and enable the **Gmail API**.
2. Create an **OAuth 2.0 Client ID** (type: Web application).
3. Add `http://localhost:3001/api/gmail/callback` as an authorized redirect URI.
4. Put the client ID/secret in `packages/server/.env`.

### Flow

```
/gmail/connect ─▶ Google consent ─▶ /gmail/callback ─▶ tokens encrypted at rest
                                                        └─▶ gmail_accounts row

/gmail/sync ──▶ list + get format=metadata ──▶ email_metadata (dedupe by msg-id)
                                              └─▶ identity_records (per unique email)
                                              └─▶ relationship_edges (scored 0..1)
                                              └─▶ connections (type="other", trust 1..10)
```

- **Sync state:** first sync pulls 2 years; later syncs use `last_synced_at`.
- **Idempotent:** `(user_id, message_id)` is unique; edges are fully recomputed
  from stored metadata on each run, so repeat syncs do not drift.
- **Tie-strength score:** weighted sum of log-volume, distinct threads, 60-day
  half-life recency, and direction (bidirectional > one-way). Mapped to
  `trust_score = round(1 + 9·score)`.
- **Bridging:** Gmail contacts become `people` rows and `connections` rows with
  `source="gmail"`. Existing manual edges of type `other` are never overwritten.
- **Revoke:** deletes the user's `gmail_accounts`, `email_metadata`,
  `identity_records`, `relationship_edges`, and all `connections` where
  `source="gmail"` and `created_by_user_id = you`. Other users' data is
  untouched.

---

## Where the interesting logic lives

| Concern                   | File                                           |
| ------------------------- | ---------------------------------------------- |
| Pure graph (BFS, path)    | `packages/server/src/domain/graph.ts`          |
| Entitlement policy        | `packages/server/src/domain/entitlement.ts`    |
| DB+entitlement glue       | `packages/server/src/domain/graph-service.ts`  |
| Invite rules              | `packages/server/src/domain/invites.ts`        |
| Edge rules / confirmation | `packages/server/src/domain/connections.ts`    |
| Schema                    | `packages/server/src/db/schema.ts`             |
| Seed data                 | `packages/server/src/db/seed.ts`               |
| Token encryption at rest  | `packages/server/src/crypto.ts`                |
| Gmail address parsing     | `packages/server/src/domain/gmail/identity.ts` |
| Tie-strength scoring      | `packages/server/src/domain/gmail/scoring.ts`  |
| Metadata ingest pipeline  | `packages/server/src/domain/gmail/ingest.ts`   |
| Edges → connections bridge| `packages/server/src/domain/gmail/bridge.ts`   |
| Revoke + purge            | `packages/server/src/domain/gmail/revoke.ts`   |

## Tests

83 tests covering:

- `graph.test.ts` — adjacency build (pending/rejected exclusion), BFS degrees, shortest path (multi-hop, unreachable, competing paths, pending-edge exclusion), neighborhood subgraph extraction
- `invites.test.ts` — creation defaults, maxUses clamping, expiry, revoked/exhausted/expired validation, redemption counter
- `entitlement.test.ts` — tier → max-degree mapping, neighborhood masking (free locks 3°, premium doesn't), path masking redacts intermediaries
- `connections.test.ts` — self-edge rejection, trust range, duplicate detection (order-independent), pending-vs-active lifecycle based on endpoint registration, confirmer-only accept, rejection permits retry
- `gmail/identity.test.ts` — `Name <email>` / quoted / bare parsing, list split (handles quoted commas), local-part name derivation
- `gmail/scoring.test.ts` — direction classification, bidirectional > one-way, volume/recency/thread monotonicity, clamping, 0..1 → 1..10 trust mapping
- `gmail/crypto.test.ts` — AES-256-GCM roundtrip, random IV, wrong-key failure, key-length validation
- `gmail/ingest.test.ts` — schema proves no subject/body columns, identity set excludes self, direction attribution, idempotency across runs (row counts + scores stable)
- `gmail/oauth.test.ts` — callback exchanges code, ciphertext ≠ plaintext, decrypt recovers token, invalid state → 400, `/connect` requires auth, `/status` before/after
- `gmail/revoke.test.ts` — full purge of user A, user B untouched
- `gmail/graph-regression.test.ts` — `/api/graph/explore` and `/api/graph/path` reflect Gmail-bridged edges as `relationshipType="other"`
