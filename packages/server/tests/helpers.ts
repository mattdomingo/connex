import { createTestDb, type DB } from "../src/db/index.js";
import { people, users, connections } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

export function setup(): DB {
  return createTestDb();
}

export function addPerson(
  db: DB,
  name: string,
  opts: { email?: string; claimed?: boolean } = {},
): number {
  const [p] = db
    .insert(people)
    .values({ name, email: opts.email ?? null })
    .returning()
    .all();
  return p.id;
}

export function addUser(
  db: DB,
  name: string,
  email: string,
  tier: "free" | "premium" = "free",
): { userId: number; personId: number } {
  const personId = addPerson(db, name, { email });
  const [u] = db
    .insert(users)
    .values({
      email,
      passwordHash: "x",
      personId,
      tier,
    })
    .returning()
    .all();
  db.update(people)
    .set({ claimedByUserId: u.id })
    .where(eq(people.id, personId))
    .run();
  return { userId: u.id, personId };
}

export function addActiveEdge(
  db: DB,
  a: number,
  b: number,
  type: "friend" | "coworker" | "classmate" | "family" | "other" = "friend",
  trust = 5,
  createdByUserId = 1,
) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  db.insert(connections)
    .values({
      aPersonId: lo,
      bPersonId: hi,
      relationshipType: type,
      trustScore: trust,
      status: "active",
      createdByUserId,
    })
    .run();
}
