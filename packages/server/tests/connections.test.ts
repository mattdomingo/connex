import { describe, it, expect } from "vitest";
import { setup, addUser, addPerson } from "./helpers.js";
import {
  createConnection,
  respondToConnection,
  ConnectionError,
} from "../src/domain/connections.js";

describe("connections — creation rules", () => {
  it("rejects self-edges", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    expect(() =>
      createConnection(db, {
        createdByUserId: alice.userId,
        creatorPersonId: alice.personId,
        sourcePersonId: alice.personId,
        targetPersonId: alice.personId,
        relationshipType: "friend",
        trustScore: 5,
      }),
    ).toThrow(ConnectionError);
  });

  it("rejects trust score out of range", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const p = addPerson(db, "Bob");
    expect(() =>
      createConnection(db, {
        createdByUserId: alice.userId,
        creatorPersonId: alice.personId,
        sourcePersonId: alice.personId,
        targetPersonId: p,
        relationshipType: "friend",
        trustScore: 11,
      }),
    ).toThrow(ConnectionError);
  });

  it("rejects duplicate non-rejected edge of same type", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const p = addPerson(db, "Bob");
    const first = createConnection(db, {
      createdByUserId: alice.userId,
      creatorPersonId: alice.personId,
      sourcePersonId: alice.personId,
      targetPersonId: p,
      relationshipType: "friend",
      trustScore: 5,
    });
    expect(first.status).toBe("active");
    expect(() =>
      createConnection(db, {
        createdByUserId: alice.userId,
        creatorPersonId: alice.personId,
        sourcePersonId: p, // reversed order should still collide
        targetPersonId: alice.personId,
        relationshipType: "friend",
        trustScore: 6,
      }),
    ).toThrow(ConnectionError);
  });

  it("allows different relationship types between the same pair", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const p = addPerson(db, "Bob");
    createConnection(db, {
      createdByUserId: alice.userId,
      creatorPersonId: alice.personId,
      sourcePersonId: alice.personId,
      targetPersonId: p,
      relationshipType: "friend",
      trustScore: 5,
    });
    const second = createConnection(db, {
      createdByUserId: alice.userId,
      creatorPersonId: alice.personId,
      sourcePersonId: alice.personId,
      targetPersonId: p,
      relationshipType: "coworker",
      trustScore: 7,
    });
    expect(second.status).toBe("active");
  });
});

describe("connections — confirmation workflow", () => {
  it("starts pending when both endpoints are registered and creator is an endpoint", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const bob = addUser(db, "Bob", "b@x.com");
    const c = createConnection(db, {
      createdByUserId: alice.userId,
      creatorPersonId: alice.personId,
      sourcePersonId: alice.personId,
      targetPersonId: bob.personId,
      relationshipType: "friend",
      trustScore: 8,
    });
    expect(c.status).toBe("pending");
    expect(c.confirmRequiredFromPersonId).toBe(bob.personId);
  });

  it("is active immediately when one endpoint is not a registered user", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const contact = addPerson(db, "Some Contact");
    const c = createConnection(db, {
      createdByUserId: alice.userId,
      creatorPersonId: alice.personId,
      sourcePersonId: alice.personId,
      targetPersonId: contact,
      relationshipType: "friend",
      trustScore: 5,
    });
    expect(c.status).toBe("active");
    expect(c.confirmRequiredFromPersonId).toBeNull();
  });

  it("is active when a third party maps two registered users", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const bob = addUser(db, "Bob", "b@x.com");
    const carol = addUser(db, "Carol", "c@x.com");
    const c = createConnection(db, {
      createdByUserId: carol.userId,
      creatorPersonId: carol.personId,
      sourcePersonId: alice.personId,
      targetPersonId: bob.personId,
      relationshipType: "coworker",
      trustScore: 4,
    });
    // Third-party observation: no confirmation asked. Product decision
    // documented in connections.ts — revisit if gaming becomes an issue.
    expect(c.status).toBe("active");
  });

  it("only the designated confirmer may accept", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const bob = addUser(db, "Bob", "b@x.com");
    const c = createConnection(db, {
      createdByUserId: alice.userId,
      creatorPersonId: alice.personId,
      sourcePersonId: alice.personId,
      targetPersonId: bob.personId,
      relationshipType: "friend",
      trustScore: 8,
    });
    expect(() =>
      respondToConnection(db, c.id, alice.personId, "accept"),
    ).toThrow(ConnectionError);
    const accepted = respondToConnection(db, c.id, bob.personId, "accept");
    expect(accepted.status).toBe("active");
    expect(accepted.confirmRequiredFromPersonId).toBeNull();
  });

  it("rejection transitions to rejected and permits a new edge of same type", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const bob = addUser(db, "Bob", "b@x.com");
    const c = createConnection(db, {
      createdByUserId: alice.userId,
      creatorPersonId: alice.personId,
      sourcePersonId: alice.personId,
      targetPersonId: bob.personId,
      relationshipType: "friend",
      trustScore: 5,
    });
    respondToConnection(db, c.id, bob.personId, "reject");
    // New one allowed
    const c2 = createConnection(db, {
      createdByUserId: bob.userId,
      creatorPersonId: bob.personId,
      sourcePersonId: bob.personId,
      targetPersonId: alice.personId,
      relationshipType: "friend",
      trustScore: 6,
    });
    expect(c2.status).toBe("pending");
  });
});
