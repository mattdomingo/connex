import { describe, it, expect } from "vitest";
import {
  parseAddress,
  parseAddressList,
  deriveNameFromEmail,
} from "../../src/domain/gmail/identity.js";

describe("identity parsing — parseAddress", () => {
  it("parses Name <email>", () => {
    const p = parseAddress("Alice Smith <alice@example.com>");
    expect(p).toEqual({ email: "alice@example.com", displayName: "Alice Smith" });
  });

  it("parses quoted name", () => {
    const p = parseAddress('"Smith, Alice" <alice@example.com>');
    expect(p).toEqual({ email: "alice@example.com", displayName: "Smith, Alice" });
  });

  it("parses bare email", () => {
    const p = parseAddress("bob@example.com");
    expect(p?.email).toBe("bob@example.com");
    expect(p?.displayName).toBe("Bob");
  });

  it("parses <email> with no name", () => {
    const p = parseAddress("<carol@example.com>");
    expect(p?.email).toBe("carol@example.com");
    expect(p?.displayName).toBe("Carol");
  });

  it("lowercases the email", () => {
    const p = parseAddress("Dave <DAVE.Kim@Example.COM>");
    expect(p?.email).toBe("dave.kim@example.com");
  });

  it("returns null for malformed input", () => {
    expect(parseAddress("")).toBeNull();
    expect(parseAddress("not an email")).toBeNull();
    expect(parseAddress("<<>>")).toBeNull();
  });

  it("derives name from local-part when no name present", () => {
    const p = parseAddress("eve.zhang@example.com");
    expect(p?.displayName).toBe("Eve Zhang");
  });

  it("strips +tags when deriving", () => {
    expect(deriveNameFromEmail("frank.osei+newsletter@example.com")).toBe(
      "Frank Osei",
    );
  });

  it("handles underscore-separated local parts", () => {
    expect(deriveNameFromEmail("grace_lee@example.com")).toBe("Grace Lee");
  });
});

describe("identity parsing — parseAddressList", () => {
  it("splits comma-separated addresses", () => {
    const list = parseAddressList(
      "Alice <a@x.com>, b@x.com, Carol D <c@x.com>",
    );
    expect(list.map((p) => p.email)).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("respects commas inside quoted names", () => {
    const list = parseAddressList(
      '"Smith, Alice" <a@x.com>, "Doe, Bob" <b@x.com>',
    );
    expect(list).toHaveLength(2);
    expect(list[0].displayName).toBe("Smith, Alice");
    expect(list[1].displayName).toBe("Doe, Bob");
  });

  it("skips malformed entries but keeps valid ones", () => {
    const list = parseAddressList("valid@x.com, garbage, also@y.com");
    expect(list.map((p) => p.email)).toEqual(["valid@x.com", "also@y.com"]);
  });

  it("returns empty for empty input", () => {
    expect(parseAddressList("")).toEqual([]);
  });
});
