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

## Tests

38 tests covering:

- `graph.test.ts` — adjacency build (pending/rejected exclusion), BFS degrees, shortest path (multi-hop, unreachable, competing paths, pending-edge exclusion), neighborhood subgraph extraction
- `invites.test.ts` — creation defaults, maxUses clamping, expiry, revoked/exhausted/expired validation, redemption counter
- `entitlement.test.ts` — tier → max-degree mapping, neighborhood masking (free locks 3°, premium doesn't), path masking redacts intermediaries
- `connections.test.ts` — self-edge rejection, trust range, duplicate detection (order-independent), pending-vs-active lifecycle based on endpoint registration, confirmer-only accept, rejection permits retry
