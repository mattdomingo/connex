/**
 * Seed script — creates a demo network with:
 *  - 3 registered users (alice, bob, carol) with known passwords
 *  - ~20 additional non-user people
 *  - connections forming a mesh so that:
 *      • alice has 5 direct connections
 *      • second-degree set is meaningful (10+)
 *      • there are clear 3rd-degree nodes to exercise gating
 *      • bob and carol are reachable from alice via distinct paths
 *
 * Run: npm run seed (from repo root)
 */

import { openDatabase, rawDb } from "./index.js";
import { people, users, connections, invites } from "./schema.js";
import { hashPassword } from "../auth/index.js";
import { config } from "../config.js";
import { eq } from "drizzle-orm";
import fs from "node:fs";

// Wipe the DB file for a clean seed.
if (fs.existsSync(config.dbPath)) {
  fs.rmSync(config.dbPath);
  // also remove wal/shm if present
  for (const ext of ["-wal", "-shm"]) {
    const p = config.dbPath + ext;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

const db = openDatabase();

interface SeedPerson {
  name: string;
  email?: string;
  company?: string;
  school?: string;
  location?: string;
  bio?: string;
}

const seedPeople: SeedPerson[] = [
  // Registered users (first 3)
  { name: "Alice Nguyen", email: "alice@example.com", company: "Lumen AI", school: "MIT", location: "San Francisco", bio: "PM focused on graph products" },
  { name: "Bob Patel", email: "bob@example.com", company: "Lumen AI", school: "Stanford", location: "Palo Alto", bio: "Backend engineer" },
  { name: "Carol Díaz", email: "carol@example.com", company: "Orbital Bio", school: "UC Berkeley", location: "Oakland", bio: "Scientist" },

  // 1st-degree from Alice
  { name: "Dave Kim", company: "Lumen AI", school: "MIT", location: "San Francisco" },
  { name: "Eve Zhang", company: "Northwind", school: "CMU", location: "Seattle" },
  { name: "Frank Osei", company: "Freelance", school: "NYU", location: "Brooklyn" },

  // 2nd-degree (via Dave/Eve/Frank/Bob)
  { name: "Grace Lee", company: "Northwind", school: "CMU", location: "Seattle" },
  { name: "Hiro Tanaka", company: "Sakura Robotics", school: "UTokyo", location: "Tokyo" },
  { name: "Ivy Chen", company: "Orbital Bio", school: "UC Berkeley", location: "Oakland" },
  { name: "Jack O'Neill", company: "USAF", location: "Colorado Springs" },
  { name: "Kira Novak", company: "Northwind", location: "Seattle" },
  { name: "Liam Murphy", company: "Lumen AI", school: "Trinity", location: "Dublin" },

  // 3rd-degree — should be locked for free tier
  { name: "Maya Singh", company: "Sakura Robotics", location: "Tokyo" },
  { name: "Noah Weiss", company: "Northwind", location: "Berlin" },
  { name: "Olga Petrov", school: "Moscow State", location: "Moscow" },
  { name: "Paulo Costa", company: "Orbital Bio", location: "São Paulo" },
  { name: "Quinn Baker", school: "NYU", location: "Brooklyn" },

  // 4th-degree / fringe
  { name: "Rita Vance", location: "Austin" },
  { name: "Sam Okafor", company: "Freelance", location: "Lagos" },
  { name: "Tara Jones", company: "Northwind", location: "Seattle" },
];

console.log("Seeding people…");
const personIds: Record<string, number> = {};
for (const sp of seedPeople) {
  const [row] = db.insert(people).values({
    name: sp.name,
    email: sp.email ?? null,
    company: sp.company ?? null,
    school: sp.school ?? null,
    location: sp.location ?? null,
    bio: sp.bio ?? null,
  }).returning().all();
  personIds[sp.name] = row.id;
}

console.log("Seeding users…");
const demoUsers = [
  { name: "Alice Nguyen", email: "alice@example.com", tier: "premium" as const },
  { name: "Bob Patel", email: "bob@example.com", tier: "free" as const },
  { name: "Carol Díaz", email: "carol@example.com", tier: "free" as const },
];

const password = "password123";
const pwHash = hashPassword(password);
const userIds: Record<string, number> = {};

for (const u of demoUsers) {
  const personId = personIds[u.name];
  const [row] = db.insert(users).values({
    email: u.email,
    passwordHash: pwHash,
    personId,
    tier: u.tier,
  }).returning().all();
  userIds[u.name] = row.id;
  db.update(people)
    .set({ claimedByUserId: row.id })
    .where(eq(people.id, personId))
    .run();
}

console.log("Seeding connections…");
type Rel = "friend" | "coworker" | "classmate" | "family" | "other";

function pid(n: string) {
  return personIds[n];
}

const edges: Array<[string, string, Rel, number, string?]> = [
  // Alice direct (degree 1)
  ["Alice Nguyen", "Bob Patel", "coworker", 8, "Same team at Lumen"],
  ["Alice Nguyen", "Carol Díaz", "friend", 7, "College friends"],
  ["Alice Nguyen", "Dave Kim", "coworker", 6],
  ["Alice Nguyen", "Eve Zhang", "classmate", 5, "MIT cohort"],
  ["Alice Nguyen", "Frank Osei", "friend", 4],

  // Degree 2 (reachable through Alice's 1st-degree)
  ["Bob Patel", "Liam Murphy", "coworker", 7],
  ["Bob Patel", "Ivy Chen", "friend", 5],
  ["Carol Díaz", "Ivy Chen", "coworker", 8],
  ["Carol Díaz", "Paulo Costa", "coworker", 4],
  ["Dave Kim", "Liam Murphy", "coworker", 6],
  ["Dave Kim", "Hiro Tanaka", "classmate", 5],
  ["Eve Zhang", "Grace Lee", "coworker", 8],
  ["Eve Zhang", "Kira Novak", "coworker", 6],
  ["Frank Osei", "Jack O'Neill", "friend", 3],
  ["Frank Osei", "Quinn Baker", "classmate", 5],

  // Degree 3
  ["Hiro Tanaka", "Maya Singh", "coworker", 7],
  ["Grace Lee", "Noah Weiss", "coworker", 4],
  ["Grace Lee", "Tara Jones", "coworker", 5],
  ["Kira Novak", "Noah Weiss", "friend", 3],
  ["Jack O'Neill", "Olga Petrov", "other", 2],
  ["Ivy Chen", "Paulo Costa", "coworker", 6],

  // Degree 4
  ["Noah Weiss", "Rita Vance", "friend", 4],
  ["Maya Singh", "Sam Okafor", "friend", 5],

  // Cross-links (create multiple paths)
  ["Bob Patel", "Grace Lee", "friend", 3],
  ["Carol Díaz", "Hiro Tanaka", "friend", 4],
];

const aliceUserId = userIds["Alice Nguyen"];

for (const [sa, sb, type, trust, note] of edges) {
  const a = pid(sa);
  const b = pid(sb);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  db.insert(connections).values({
    aPersonId: lo,
    bPersonId: hi,
    relationshipType: type,
    trustScore: trust,
    note: note ?? null,
    status: "active",
    createdByUserId: aliceUserId,
  }).run();
}

// One pending request: Bob → Alice, family
const aliceP = pid("Alice Nguyen");
const bobP = pid("Bob Patel");
const [lo, hi] = aliceP < bobP ? [aliceP, bobP] : [bobP, aliceP];
db.insert(connections).values({
  aPersonId: lo,
  bPersonId: hi,
  relationshipType: "family",
  trustScore: 9,
  status: "pending",
  createdByUserId: userIds["Bob Patel"],
  confirmRequiredFromPersonId: aliceP,
  note: "We're practically family at this point",
}).run();

console.log("Seeding bootstrap invite…");
// Bootstrap invite (idempotent-ish since we wiped the DB)
db.insert(invites).values({
  code: config.bootstrapInviteCode,
  createdByUserId: null,
  intendedName: "Bootstrap",
  maxUses: 1000,
}).run();

// One personal invite from Alice
db.insert(invites).values({
  code: "ALICE-DEMO-1",
  createdByUserId: aliceUserId,
  intendedName: "Demo friend",
  intendedEmail: "newuser@example.com",
  maxUses: 3,
}).run();

console.log("\nSeed complete.\n");
console.log("Demo accounts (password = password123):");
for (const u of demoUsers) {
  console.log(`  - ${u.email}  (${u.tier})`);
}
console.log(`\nBootstrap invite code: ${config.bootstrapInviteCode}`);
console.log(`Personal invite code:  ALICE-DEMO-1\n`);

rawDb().close();
