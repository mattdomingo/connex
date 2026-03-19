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
