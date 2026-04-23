import { describe, expect, it } from "vitest";
import {
  extractAccountIdFromSessionEntry,
  resolveSessionAccountIdFromStore,
  type SessionStore,
} from "../src/internal.js";

// ─── extractAccountIdFromSessionEntry ────────────────────────────────────────

describe("extractAccountIdFromSessionEntry", () => {
  it("returns deliveryContext.accountId when set", () => {
    expect(
      extractAccountIdFromSessionEntry({
        deliveryContext: { accountId: "botA" },
        lastAccountId: "botB",
      }),
    ).toBe("botA");
  });

  it("falls back to lastAccountId when deliveryContext is missing", () => {
    expect(
      extractAccountIdFromSessionEntry({ lastAccountId: "botB" }),
    ).toBe("botB");
  });

  it("falls back to lastAccountId when deliveryContext.accountId is empty", () => {
    expect(
      extractAccountIdFromSessionEntry({
        deliveryContext: { accountId: "  " },
        lastAccountId: "botB",
      }),
    ).toBe("botB");
  });

  it("returns undefined when neither field is present", () => {
    expect(extractAccountIdFromSessionEntry({})).toBeUndefined();
  });

  it("returns undefined for null / undefined entry", () => {
    expect(extractAccountIdFromSessionEntry(null)).toBeUndefined();
    expect(extractAccountIdFromSessionEntry(undefined)).toBeUndefined();
  });

  it("tolerates wrong types on the entry fields", () => {
    expect(
      extractAccountIdFromSessionEntry({
        deliveryContext: { accountId: 42 as unknown as string },
        lastAccountId: false as unknown as string,
      }),
    ).toBeUndefined();
  });

  it("trims surrounding whitespace on the returned id", () => {
    expect(
      extractAccountIdFromSessionEntry({
        deliveryContext: { accountId: "  botA  " },
      }),
    ).toBe("botA");
  });
});

// ─── resolveSessionAccountIdFromStore ───────────────────────────────────────

describe("resolveSessionAccountIdFromStore", () => {
  const key = "agent:main:zapry:group:g_1";

  it("[I-03] returns the accountId recorded for the sessionKey", () => {
    const store: SessionStore = {
      [key]: { deliveryContext: { accountId: "botA" } },
    };
    expect(
      resolveSessionAccountIdFromStore({
        store,
        sessionKey: key,
        configuredAccountIds: ["botA", "botB"],
      }),
    ).toBe("botA");
  });

  it("[I-04] single-account deployment: silently falls back to the only account when no entry exists", () => {
    expect(
      resolveSessionAccountIdFromStore({
        store: {},
        sessionKey: key,
        configuredAccountIds: ["onlyBot"],
      }),
    ).toBe("onlyBot");
  });

  it("[I-05] multi-account deployment: returns undefined when entry is missing (R2 HARDENING)", () => {
    // This is the key safety property: in a multi-account deployment we
    // refuse to silently route to `configuredAccountIds[0]`. A caller that
    // sees `undefined` must either surface a clear error or prompt the agent
    // to pass an explicit accountId.
    expect(
      resolveSessionAccountIdFromStore({
        store: {},
        sessionKey: key,
        configuredAccountIds: ["botA", "botB"],
      }),
    ).toBeUndefined();
  });

  it("[I-05b] multi-account deployment: entry WITH accountId wins over the safety fallback", () => {
    const store: SessionStore = {
      [key]: { lastAccountId: "botB" },
    };
    expect(
      resolveSessionAccountIdFromStore({
        store,
        sessionKey: key,
        configuredAccountIds: ["botA", "botB"],
      }),
    ).toBe("botB");
  });

  it("[I-06] malformed-store scenario: a null store behaves like an empty one", () => {
    // Upstream callers pass `null` when sessions.json is missing or
    // unparseable. Single account → safe fallback; multi → undefined.
    expect(
      resolveSessionAccountIdFromStore({
        store: null,
        sessionKey: key,
        configuredAccountIds: ["onlyBot"],
      }),
    ).toBe("onlyBot");

    expect(
      resolveSessionAccountIdFromStore({
        store: null,
        sessionKey: key,
        configuredAccountIds: ["botA", "botB"],
      }),
    ).toBeUndefined();
  });

  it("[I-09] legacy 'main' entry is ignored when looking up a peer-scoped key", () => {
    // A deployment that used to route everything through `agent:main:main` will
    // have a large legacy entry under that key. Peer-scoped keys should not
    // inherit that entry's accountId (session isolation), so resolution for a
    // peer-scoped key must ignore it and fall through to the safety rule.
    const store: SessionStore = {
      "agent:main:main": {
        deliveryContext: { accountId: "botA" },
        lastAccountId: "botA",
      },
    };
    expect(
      resolveSessionAccountIdFromStore({
        store,
        sessionKey: key,
        configuredAccountIds: ["botA", "botB"],
      }),
    ).toBeUndefined();
  });

  it("single-account deployment with legacy 'main' entry: still safely falls back to the only account", () => {
    const store: SessionStore = {
      "agent:main:main": { deliveryContext: { accountId: "onlyBot" } },
    };
    expect(
      resolveSessionAccountIdFromStore({
        store,
        sessionKey: key,
        configuredAccountIds: ["onlyBot"],
      }),
    ).toBe("onlyBot");
  });

  it("no configured accounts at all: returns undefined instead of guessing", () => {
    expect(
      resolveSessionAccountIdFromStore({
        store: {},
        sessionKey: key,
        configuredAccountIds: [],
      }),
    ).toBeUndefined();
  });

  it("empty store object is indistinguishable from null store", () => {
    expect(
      resolveSessionAccountIdFromStore({
        store: {},
        sessionKey: key,
        configuredAccountIds: ["botA", "botB"],
      }),
    ).toBeUndefined();
  });

  it("entry with explicit deliveryContext.accountId beats lastAccountId (recency wins)", () => {
    const store: SessionStore = {
      [key]: {
        deliveryContext: { accountId: "new" },
        lastAccountId: "old",
      },
    };
    expect(
      resolveSessionAccountIdFromStore({
        store,
        sessionKey: key,
        configuredAccountIds: ["new", "old"],
      }),
    ).toBe("new");
  });
});
