import { createDb, initializeSchema } from "./schema.js";
import { hashPassword } from "../services/auth.js";
import { generateInviteCode } from "../services/invites.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "../../data/connex.db");

// Remove existing database
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  // Also remove WAL/SHM files
  for (const ext of ["-wal", "-shm"]) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  console.log("Removed existing database");
}

const db = createDb(dbPath);
initializeSchema(db);

console.log("Seeding Connex database...\n");

const bootstrapCode = "WELCOME1";

// ── Create demo users ──
const passwordHash = hashPassword("password123");

interface UserSeed {
  email: string;
  name: string;
  bio: string;
  company: string;
  school: string;
  location: string;
}

const demoUsers: UserSeed[] = [
  {
    email: "alice@demo.com",
    name: "Alice Chen",
    bio: "Product manager passionate about developer tools. Building the future of collaboration.",
    company: "Acme Corp",
    school: "MIT",
    location: "San Francisco, CA",
  },
  {
    email: "bob@demo.com",
    name: "Bob Martinez",
    bio: "Full-stack engineer. TypeScript enthusiast. Open source contributor.",
    company: "Acme Corp",
    school: "Stanford",
    location: "San Francisco, CA",
  },
  {
    email: "carol@demo.com",
    name: "Carol Williams",
    bio: "UX researcher focused on social software and network effects.",
    company: "DesignLab",
    school: "RISD",
    location: "New York, NY",
  },
  {
    email: "dave@demo.com",
    name: "Dave Kumar",
    bio: "Data scientist exploring graph algorithms and recommendation systems.",
    company: "DataFlow",
    school: "MIT",
    location: "Boston, MA",
  },
  {
    email: "eva@demo.com",
    name: "Eva Johansson",
    bio: "Engineering manager. Previously at three startups. Loves mentoring.",
    company: "TechStart",
    school: "KTH",
    location: "Stockholm, Sweden",
  },
  {
    email: "frank@demo.com",
    name: "Frank Okafor",
    bio: "Backend engineer specializing in distributed systems and graph databases.",
    company: "DataFlow",
    school: "Stanford",
    location: "Seattle, WA",
  },
];

const userIds: number[] = [];
const personIds: number[] = [];

const insertUser = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)");
const insertPerson = db.prepare(
  `INSERT INTO persons (name, email, bio, company, school, location, user_id, created_by_user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

for (const u of demoUsers) {
  const userResult = insertUser.run(u.email, passwordHash);
  const userId = Number(userResult.lastInsertRowid);
  userIds.push(userId);

  const personResult = insertPerson.run(
    u.name, u.email, u.bio, u.company, u.school, u.location, userId, userId,
  );
  personIds.push(Number(personResult.lastInsertRowid));
}

console.log(`Created ${demoUsers.length} demo users`);

// ── Make Alice a premium user ──
db.prepare("UPDATE users SET is_premium = 1 WHERE id = ?").run(userIds[0]);
console.log("Set Alice as premium user");

// ── Bootstrap invite (created by first user) ──
db.prepare(
  `INSERT INTO invites (code, created_by_user_id, recipient_name, max_uses, expires_at)
   VALUES (?, ?, 'Bootstrap User', 100, NULL)`
).run(bootstrapCode, userIds[0]);

// ── Create non-user contacts (people not yet registered) ──
interface ContactSeed {
  name: string;
  email: string | null;
  company: string | null;
  school: string | null;
  location: string | null;
  createdBy: number; // index into userIds
}

const contacts: ContactSeed[] = [
  { name: "Grace Park", email: "grace@example.com", company: "Acme Corp", school: "MIT", location: "San Francisco, CA", createdBy: 0 },
  { name: "Henry Nakamura", email: null, company: "TechStart", school: null, location: "Tokyo, Japan", createdBy: 4 },
  { name: "Iris Dubois", email: "iris@example.com", company: null, school: "RISD", location: "Paris, France", createdBy: 2 },
  { name: "Jack Thompson", email: null, company: "DataFlow", school: "Stanford", location: "Seattle, WA", createdBy: 5 },
  { name: "Keiko Tanaka", email: null, company: null, school: "KTH", location: "Stockholm, Sweden", createdBy: 4 },
  { name: "Liam O'Brien", email: "liam@example.com", company: "Acme Corp", school: null, location: "Dublin, Ireland", createdBy: 1 },
];

const insertContact = db.prepare(
  `INSERT INTO persons (name, email, company, school, location, created_by_user_id)
   VALUES (?, ?, ?, ?, ?, ?)`
);

for (const c of contacts) {
  const result = insertContact.run(
    c.name, c.email, c.company, c.school, c.location, userIds[c.createdBy],
  );
  personIds.push(Number(result.lastInsertRowid));
}

console.log(`Created ${contacts.length} non-user contacts`);

// ── Create connections ──
// Person indices: 0=Alice, 1=Bob, 2=Carol, 3=Dave, 4=Eva, 5=Frank,
//                 6=Grace, 7=Henry, 8=Iris, 9=Jack, 10=Keiko, 11=Liam

interface ConnectionSeed {
  source: number;
  target: number;
  type: string;
  closeness: number;
  note: string;
  status: string;
}

const connections: ConnectionSeed[] = [
  // 1st degree from Alice (person 0)
  { source: 0, target: 1, type: "coworker", closeness: 8, note: "Work together on the platform team at Acme", status: "accepted" },
  { source: 0, target: 2, type: "friend", closeness: 7, note: "Met at a design thinking workshop", status: "accepted" },
  { source: 0, target: 3, type: "classmate", closeness: 6, note: "MIT CS class of 2015", status: "accepted" },
  { source: 0, target: 6, type: "coworker", closeness: 5, note: "Grace is on the marketing team at Acme", status: "accepted" },

  // 2nd degree from Alice (connected through Bob, Carol, Dave, or Grace)
  { source: 1, target: 5, type: "classmate", closeness: 7, note: "Stanford CS together", status: "accepted" },
  { source: 1, target: 11, type: "coworker", closeness: 6, note: "Liam works on infrastructure at Acme", status: "accepted" },
  { source: 2, target: 8, type: "classmate", closeness: 8, note: "RISD industrial design program", status: "accepted" },
  { source: 2, target: 4, type: "friend", closeness: 5, note: "Met at a UX conference in Stockholm", status: "accepted" },
  { source: 3, target: 5, type: "coworker", closeness: 9, note: "Co-lead the ML team at DataFlow", status: "accepted" },

  // 3rd degree from Alice (connected through 2nd degree people)
  { source: 5, target: 9, type: "coworker", closeness: 7, note: "Jack is on the infra team at DataFlow", status: "accepted" },
  { source: 4, target: 7, type: "coworker", closeness: 6, note: "Henry leads the Tokyo office at TechStart", status: "accepted" },
  { source: 4, target: 10, type: "classmate", closeness: 8, note: "KTH engineering together", status: "accepted" },

  // A pending connection
  { source: 1, target: 4, type: "friend", closeness: 4, note: "Met at a TypeScript meetup", status: "pending" },

  // Cross-connections to make the graph interesting
  { source: 3, target: 6, type: "friend", closeness: 4, note: "Grace introduced Dave to graph theory", status: "accepted" },
  { source: 5, target: 4, type: "friend", closeness: 5, note: "Met at a distributed systems conference", status: "accepted" },
];

const insertConnection = db.prepare(
  `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, note, status, created_by_user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

for (const c of connections) {
  insertConnection.run(
    personIds[c.source],
    personIds[c.target],
    c.type,
    c.closeness,
    c.note,
    c.status,
    userIds[c.source < 6 ? c.source : 0],
  );
}

console.log(`Created ${connections.length} connections`);

// ── Create some invite codes ──
const insertInvite = db.prepare(
  `INSERT INTO invites (code, created_by_user_id, recipient_name, recipient_email, max_uses)
   VALUES (?, ?, ?, ?, ?)`
);

insertInvite.run(generateInviteCode(), userIds[0], "New Friend", null, 1);
insertInvite.run(generateInviteCode(), userIds[0], null, "test@example.com", 1);
insertInvite.run(generateInviteCode(), userIds[1], "Bob's Colleague", null, 3);

console.log("Created sample invite codes");

db.close();

console.log("\nSeed complete!");
console.log(`Database: ${dbPath}`);
console.log("\nDemo accounts (all passwords: password123):");
for (const u of demoUsers) {
  console.log(`  ${u.email} — ${u.name}`);
}
console.log(`\nBootstrap invite code: ${bootstrapCode}`);
console.log("Use this code to register a new account.\n");
