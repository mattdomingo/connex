# Connex -- Relationship Graph Explorer

An invite-only relationship graph app for mapping real-world relationships and exploring how people are connected. Built as a full-stack TypeScript MVP.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express + TypeScript |
| Database | SQLite via better-sqlite3 |
| Frontend | React + Vite + TypeScript |
| Graph Viz | react-force-graph-2d (d3-force) |
| Auth | JWT + bcrypt |
| Testing | Vitest |
| Monorepo | npm workspaces |

## Quick Start

```bash
# Install all dependencies
npm install

# Build the shared types package
npm run build -w packages/shared

# Seed the database with demo data
npm run seed -w packages/backend

# Start both frontend and backend in development mode
npm run dev
```

The backend runs on `http://localhost:3001` and the frontend on `http://localhost:5173`.

## Demo Accounts

All demo accounts use password **`password123`**:

| Email | Name | Role in Graph |
|-------|------|--------------|
| alice@demo.com | Alice Chen | Central hub -- best for exploring |
| bob@demo.com | Bob Martinez | Well-connected engineer |
| carol@demo.com | Carol Williams | UX researcher |
| dave@demo.com | Dave Kumar | Data scientist |
| eva@demo.com | Eva Johansson | Engineering manager |
| frank@demo.com | Frank Okafor | Backend engineer |

**Bootstrap invite code: `WELCOME1`** -- use this to register a new account.

## Project Structure

```
connex/
  packages/
    shared/              # Shared TypeScript types & constants
      src/index.ts       # API contracts, enums, graph types
    backend/
      src/
        db/              # Schema, migrations, seed data
        graph/           # Graph traversal & entitlement logic
        middleware/       # Auth middleware
        routes/          # Express API routes
        services/        # Business logic (auth, invites, persons, connections)
        server.ts        # Express app entry point
      tests/             # Vitest test suites
    frontend/
      src/
        api/             # API client
        components/      # React components (graph, panels)
        hooks/           # Auth context & hooks
        pages/           # Route pages
  package.json           # Workspace root
```

## Key Commands

```bash
npm run dev              # Start frontend + backend concurrently
npm run test             # Run all backend tests
npm run seed             # Re-seed the database (destructive)
npm run build            # Build all packages for production
```

## Running Tests

```bash
npm run test
# or with watch mode:
npm run test:watch -w packages/backend
```

44 tests covering:
- Invite creation, validation, redemption, and expiration
- Graph traversal (BFS, degree calculation, shortest path)
- Degree-based access gating (free vs premium policies)
- Connection creation, confirmation workflow, and constraints
- Entitlement policy structure

## Schema

### Tables

- **users** -- Authentication (email, password_hash)
- **persons** -- All graph nodes. Registered users have `user_id` set; contacts have it NULL
- **connections** -- Edges with type, closeness score, status (pending/accepted/rejected), created-by metadata
- **invites** -- Invite codes with expiration, max uses, recipient metadata
- **invite_redemptions** -- Tracks who redeemed which invite
- **google_accounts** -- OAuth tokens (encrypted at rest) for linked Google accounts
- **gmail_sync_runs** -- Sync job history with cursor for incremental sync
- **email_interactions** -- Gmail metadata (no body content): message ID, direction, counterparty, timestamps
- **relationship_scores** -- Computed tie-strength scores per user-person pair

### Key Constraints

- No self-connections (CHECK constraint)
- No duplicate active connections between the same pair in either direction (unique partial index)
- Foreign keys enforced throughout
- Closeness score bounded 1-10

## Architecture & Design Decisions

### Mixed Person Model
Every graph node is a `person`. Registered users link to a person via `user_id`. Non-user contacts exist as persons with `user_id = NULL`. When a new user signs up with an email matching an existing contact, the system can link them (the model and API support this; automated fuzzy matching is a future enhancement).

### Connection Trust Workflow
- Connections between two registered users start as **pending** until the target accepts
- Connections to non-user contacts are **auto-accepted** (there's no one to confirm)
- **Pending connections are visible in the graph** (dashed lines) but **excluded from shortest-path calculations and degree computation**
- Rejected connections are hidden from the graph entirely

### Degree-Based Access Gating
- **Free tier**: See up to 2nd-degree connections. 3rd-degree+ nodes appear as "Locked" with no identifying info
- **Premium tier**: Unlimited graph exploration (not yet wired to a subscription system)
- The entitlement check is a single function (`getPolicyForUser`) in `graph/entitlements.ts` -- swap it to check a subscription table to add monetization
- The graph traversal engine accepts an `EntitlementPolicy` parameter, keeping policy logic cleanly separated from BFS/pathfinding

### Graph Traversal
- BFS from the center person on accepted connections only
- Shortest path via BFS with parent tracking and path reconstruction
- Degree gating: BFS discovers up to `maxDegree + 1` (to show locked boundary nodes)
- All traversal logic is in `packages/backend/src/graph/traversal.ts`, tested independently of HTTP/UI

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/signup | No | Register with invite code |
| POST | /api/auth/signin | No | Sign in |
| GET | /api/auth/me | Yes | Get current user + profile |
| GET | /api/persons/me | Yes | Get own profile |
| PUT | /api/persons/me | Yes | Update own profile |
| POST | /api/persons | Yes | Create a non-user contact |
| GET | /api/persons/:id | Yes | Get a person by ID |
| GET | /api/persons?q= | Yes | Search persons |
| POST | /api/connections | Yes | Create a connection |
| GET | /api/connections/mine | Yes | List my connections |
| GET | /api/connections/pending | Yes | List pending requests |
| PUT | /api/connections/:id/respond | Yes | Accept/reject a connection |
| POST | /api/invites | Yes | Create an invite code |
| GET | /api/invites/mine | Yes | List my invites |
| GET | /api/invites/validate/:code | No | Validate an invite code |
| GET | /api/graph/explore | Yes | Get graph data (BFS from center) |
| GET | /api/graph/path/:from/:to | Yes | Find shortest path |
| GET | /api/graph/search?q= | Yes | Search with degree info |
| GET | /api/integrations/google/connect/start | Yes | Redirect to Google OAuth consent |
| GET | /api/integrations/google/connect/callback | No* | OAuth callback (state carries userId) |
| POST | /api/integrations/google/disconnect | Yes | Remove linked Google account |
| GET | /api/integrations/google/status | Yes | Check Google connection status |
| POST | /api/gmail/sync | Yes | Trigger Gmail metadata sync + scoring |
| GET | /api/gmail/sync/status | Yes | Latest sync run status |
| GET | /api/me/top-connections?limit= | Yes | Ranked contacts by tie strength |
| GET | /api/me/connections?company= | Yes | Filter ranked contacts by domain |
| GET | /api/me/connections/:id/evidence | Yes | Interaction evidence for a person |

## Connect Google & Gmail Sync

### Setup

1. Create a Google Cloud project and enable the Gmail API
2. Create OAuth 2.0 credentials (Web application type)
3. Add `http://localhost:3001/api/integrations/google/connect/callback` as an authorized redirect URI
4. Set environment variables:

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_REDIRECT_URI="http://localhost:3001/api/integrations/google/connect/callback"
export GOOGLE_OAUTH_ENCRYPTION_KEY="any-random-secret-for-token-encryption"
export GMAIL_BACKFILL_DAYS=180    # optional, default 180
export GMAIL_BATCH_SIZE=100       # optional, default 100
```

### Usage

```bash
# 1. Sign in and get a token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@demo.com","password":"password123"}' | jq -r .token)

# 2. Connect Google (opens browser)
open "http://localhost:3001/api/integrations/google/connect/start?redirect=true"
# (must be authenticated via cookie or pass token — use browser session)

# 3. Trigger sync
curl -X POST http://localhost:3001/api/gmail/sync \
  -H "Authorization: Bearer $TOKEN"

# 4. Get top connections
curl http://localhost:3001/api/me/top-connections?limit=20 \
  -H "Authorization: Bearer $TOKEN"

# 5. Filter by company/domain
curl "http://localhost:3001/api/me/connections?company=google.com" \
  -H "Authorization: Bearer $TOKEN"

# 6. Get evidence for a specific person
curl http://localhost:3001/api/me/connections/42/evidence \
  -H "Authorization: Bearer $TOKEN"
```

### Tie-Strength Scoring Formula

Each email interaction is weighted:
- **Direct** (to/from): 1.0
- **CC**: 0.3
- **BCC**: 0.1

Recency decay: `exp(-ln(2)/90 * days_ago)` (half-life of 90 days)

Direction balance: `1 - |sent_fraction - 0.5| * 2` (rewards two-way communication)

Final: `recency_weighted_sum * (0.5 + 0.5 * direction_balance)`, normalized to [0, 1] per user.

### Security & Privacy

- OAuth tokens are encrypted at rest using AES-256-GCM
- No email body content is ever stored -- only metadata (from/to/cc, timestamps, thread IDs)
- All Gmail-derived data is scoped to the owning user
- Tokens are never logged
