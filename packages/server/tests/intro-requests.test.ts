import { describe, it, expect } from "vitest";
import { setup, addUser, addPerson, addActiveEdge } from "./helpers.js";
import {
  createIntroRequest,
  respondToIntroRequest,
  cancelIntroRequest,
  listSentRequests,
  listInboxRequests,
  IntroRequestError,
} from "../src/domain/intro-requests.js";

/**
 * Build: alice —— bob —— carol —— dave
 * Shortest alice→carol = 2 (via bob); alice→dave = 3 (via bob, carol).
 */
function chain() {
  const db = setup();
  const alice = addUser(db, "Alice", "a@x.com", "premium");
  const bob = addUser(db, "Bob", "b@x.com");
  const carol = addUser(db, "Carol", "c@x.com");
  const dave = addPerson(db, "Dave");
  addActiveEdge(db, alice.personId, bob.personId, "friend", 7, alice.userId);
  addActiveEdge(db, bob.personId, carol.personId, "coworker", 6, bob.userId);
  addActiveEdge(db, carol.personId, dave, "friend", 5, carol.userId);
  return { db, alice, bob, carol, dave };
}

function mk(
  db: ReturnType<typeof setup>,
  who: { userId: number; personId: number },
  target: number,
  via: number,
  tier: "free" | "premium" = "premium",
  note?: string,
) {
  return createIntroRequest(db, {
    requesterUserId: who.userId,
    requesterPersonId: who.personId,
    requesterTier: tier,
    targetPersonId: target,
    intermediaryPersonId: via,
    note,
  });
}

describe("intro-requests — creation", () => {
  it("creates pending with note and hydrates lists", () => {
    const { db, alice, bob, carol } = chain();
    const row = mk(db, alice, carol.personId, bob.personId, "premium", "please intro");
    expect(row.status).toBe("pending");
    expect(row.requestNote).toBe("please intro");
    expect(row.respondedAt).toBeNull();

    const sent = listSentRequests(db, alice.userId);
    expect(sent.length).toBe(1);
    expect(sent[0].requester.name).toBe("Alice");
    expect(sent[0].target.name).toBe("Carol");
    expect(sent[0].intermediary.name).toBe("Bob");

    const inbox = listInboxRequests(db, bob.personId);
    expect(inbox.length).toBe(1);
    expect(inbox[0].id).toBe(row.id);
  });

  it("rejects self-target", () => {
    const { db, alice, bob } = chain();
    expect(() => mk(db, alice, alice.personId, bob.personId)).toThrow(
      IntroRequestError,
    );
  });

  it("rejects self-intermediary", () => {
    const { db, alice, carol } = chain();
    expect(() => mk(db, alice, carol.personId, alice.personId)).toThrow(
      IntroRequestError,
    );
  });

  it("rejects target == intermediary", () => {
    const { db, alice, carol } = chain();
    expect(() => mk(db, alice, carol.personId, carol.personId)).toThrow(
      IntroRequestError,
    );
  });

  it("rejects unknown target or intermediary", () => {
    const { db, alice, bob } = chain();
    expect(() => mk(db, alice, 9999, bob.personId)).toThrow(IntroRequestError);
    expect(() => mk(db, alice, bob.personId, 9999)).toThrow(IntroRequestError);
  });
});

describe("intro-requests — path validation", () => {
  it("rejects when target is unreachable", () => {
    const { db, alice, bob } = chain();
    const island = addPerson(db, "Island");
    expect(() => mk(db, alice, island, bob.personId)).toThrow(IntroRequestError);
    try {
      mk(db, alice, island, bob.personId);
    } catch (e) {
      expect((e as IntroRequestError).code).toBe("UNREACHABLE");
    }
  });

  it("rejects intermediary not on a shortest path", () => {
    const { db, alice, carol, dave } = chain();
    // alice → carol shortest = 2 via bob. Dave is distance 3 from alice;
    // alice→dave (3) + dave→carol (1) = 4 != 2.
    expect(() => mk(db, alice, carol.personId, dave)).toThrow(IntroRequestError);
    try {
      mk(db, alice, carol.personId, dave);
    } catch (e) {
      expect((e as IntroRequestError).code).toBe("NOT_ON_PATH");
    }
  });

  it("accepts any node on a shortest path, not just the BFS-chosen one", () => {
    // Diamond: alice — {bob, carol} — target. Two distinct 2-hop paths.
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com", "premium");
    const bob = addUser(db, "Bob", "b@x.com");
    const carol = addUser(db, "Carol", "c@x.com");
    const target = addPerson(db, "Target");
    addActiveEdge(db, alice.personId, bob.personId, "friend", 5, alice.userId);
    addActiveEdge(db, alice.personId, carol.personId, "friend", 5, alice.userId);
    addActiveEdge(db, bob.personId, target, "friend", 5, bob.userId);
    addActiveEdge(db, carol.personId, target, "friend", 5, carol.userId);

    const r1 = mk(db, alice, target, bob.personId);
    expect(r1.status).toBe("pending");
    const r2 = mk(db, alice, target, carol.personId);
    expect(r2.status).toBe("pending");
  });

  it("enforces entitlement: free user cannot request beyond their path visibility", () => {
    const { db, alice, bob, carol, dave } = chain();
    // alice → dave is length 3; free tier max = 2.
    const freeAlice = { userId: alice.userId, personId: alice.personId };
    expect(() => mk(db, freeAlice, dave, bob.personId, "free")).toThrow(
      IntroRequestError,
    );
    expect(() => mk(db, freeAlice, dave, carol.personId, "free")).toThrow(
      IntroRequestError,
    );
    // But premium succeeds.
    const row = mk(db, alice, dave, carol.personId, "premium");
    expect(row.status).toBe("pending");
  });
});

describe("intro-requests — duplicates & retries", () => {
  it("rejects duplicate pending for same triplet", () => {
    const { db, alice, bob, carol } = chain();
    mk(db, alice, carol.personId, bob.personId);
    expect(() => mk(db, alice, carol.personId, bob.personId)).toThrow(
      IntroRequestError,
    );
  });

  it("rejects duplicate while an accepted request exists", () => {
    const { db, alice, bob, carol } = chain();
    const r = mk(db, alice, carol.personId, bob.personId);
    respondToIntroRequest(db, r.id, bob.personId, "accept");
    expect(() => mk(db, alice, carol.personId, bob.personId)).toThrow(
      IntroRequestError,
    );
  });

  it("allows retry after decline", () => {
    const { db, alice, bob, carol } = chain();
    const r1 = mk(db, alice, carol.personId, bob.personId);
    respondToIntroRequest(db, r1.id, bob.personId, "decline", "too busy");
    const r2 = mk(db, alice, carol.personId, bob.personId);
    expect(r2.status).toBe("pending");
    expect(r2.id).not.toBe(r1.id);
  });

  it("allows retry after cancel", () => {
    const { db, alice, bob, carol } = chain();
    const r1 = mk(db, alice, carol.personId, bob.personId);
    cancelIntroRequest(db, r1.id, alice.userId);
    const r2 = mk(db, alice, carol.personId, bob.personId);
    expect(r2.status).toBe("pending");
  });
});

describe("intro-requests — respond", () => {
  it("only intermediary may respond", () => {
    const { db, alice, bob, carol } = chain();
    const r = mk(db, alice, carol.personId, bob.personId);
    expect(() =>
      respondToIntroRequest(db, r.id, alice.personId, "accept"),
    ).toThrow(IntroRequestError);
    expect(() =>
      respondToIntroRequest(db, r.id, carol.personId, "accept"),
    ).toThrow(IntroRequestError);
    const out = respondToIntroRequest(db, r.id, bob.personId, "accept");
    expect(out.status).toBe("accepted");
  });

  it("accept sets status + respondedAt and preserves note", () => {
    const { db, alice, bob, carol } = chain();
    const r = mk(db, alice, carol.personId, bob.personId);
    const out = respondToIntroRequest(
      db,
      r.id,
      bob.personId,
      "accept",
      "will do",
    );
    expect(out.status).toBe("accepted");
    expect(out.responseNote).toBe("will do");
    expect(out.respondedAt).not.toBeNull();
  });

  it("decline sets status + respondedAt", () => {
    const { db, alice, bob, carol } = chain();
    const r = mk(db, alice, carol.personId, bob.personId);
    const out = respondToIntroRequest(db, r.id, bob.personId, "decline");
    expect(out.status).toBe("declined");
    expect(out.respondedAt).not.toBeNull();
  });

  it("cannot respond to non-pending", () => {
    const { db, alice, bob, carol } = chain();
    const r = mk(db, alice, carol.personId, bob.personId);
    respondToIntroRequest(db, r.id, bob.personId, "accept");
    expect(() =>
      respondToIntroRequest(db, r.id, bob.personId, "decline"),
    ).toThrow(IntroRequestError);
  });
});

describe("intro-requests — cancel", () => {
  it("only requester may cancel, pending only", () => {
    const { db, alice, bob, carol } = chain();
    const r = mk(db, alice, carol.personId, bob.personId);
    expect(() => cancelIntroRequest(db, r.id, bob.userId)).toThrow(
      IntroRequestError,
    );
    const out = cancelIntroRequest(db, r.id, alice.userId);
    expect(out.status).toBe("cancelled");
    expect(out.respondedAt).not.toBeNull();
    // cannot cancel twice
    expect(() => cancelIntroRequest(db, r.id, alice.userId)).toThrow(
      IntroRequestError,
    );
  });

  it("cannot cancel after accept", () => {
    const { db, alice, bob, carol } = chain();
    const r = mk(db, alice, carol.personId, bob.personId);
    respondToIntroRequest(db, r.id, bob.personId, "accept");
    expect(() => cancelIntroRequest(db, r.id, alice.userId)).toThrow(
      IntroRequestError,
    );
  });
});
