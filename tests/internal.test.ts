import { describe, expect, it } from "vitest";
import {
  buildPeerSessionKey,
  isOwnerInvocation,
  normalizeRouteSessionKey,
  parseAgentIdFromSessionKey,
  resolveOwnerIdFromBotToken,
  sameUserIdentity,
  stripZapryTargetPrefix,
} from "../src/internal.js";

describe("stripZapryTargetPrefix", () => {
  it("[U-01] strips legacy chat: prefix", () => {
    expect(stripZapryTargetPrefix("chat:g_123")).toBe("g_123");
  });

  it("[U-02] strips single zapry:group: prefix", () => {
    expect(stripZapryTargetPrefix("zapry:group:g_123")).toBe("g_123");
  });

  it("[U-03] strips a chain of group: segments after zapry:", () => {
    expect(stripZapryTargetPrefix("zapry:group:group:g_123")).toBe("g_123");
  });

  it("[U-03b] only strips one zapry: wrapper per call (documented limitation)", () => {
    // Double-wrapped ids require two passes; the regex runs once per call.
    expect(stripZapryTargetPrefix("zapry:group:zapry:group:g_123")).toBe(
      "zapry:group:g_123",
    );
  });

  it("[U-04] leaves unprefixed ids untouched", () => {
    expect(stripZapryTargetPrefix("g_123")).toBe("g_123");
  });

  it("[U-05] is case-insensitive for known prefixes", () => {
    expect(stripZapryTargetPrefix("ZAPRY:GROUP:g_123")).toBe("g_123");
    expect(stripZapryTargetPrefix("CHAT:g_123")).toBe("g_123");
  });

  it("[U-06] also strips a bare zapry: wrapper (any kind after zapry: survives)", () => {
    // The regex treats `group:` as optional (0 or more), so any `zapry:...`
    // gets its leading `zapry:` removed. Downstream must rely on stripping
    // behaviour + its own parsing, not on a preserved `zapry:direct:` tag.
    expect(stripZapryTargetPrefix("zapry:direct:123")).toBe("direct:123");
    expect(stripZapryTargetPrefix("zapry:123")).toBe("123");
  });

  it("handles empty string gracefully", () => {
    expect(stripZapryTargetPrefix("")).toBe("");
  });
});

describe("parseAgentIdFromSessionKey", () => {
  it("[U-07] extracts agentId from agent-scoped key", () => {
    expect(parseAgentIdFromSessionKey("agent:botA:zapry:group:g_1")).toBe("botA");
  });

  it("[U-08] returns undefined for legacy 'main' key", () => {
    expect(parseAgentIdFromSessionKey("main")).toBeUndefined();
  });

  it("[U-09] returns undefined for empty or null input", () => {
    expect(parseAgentIdFromSessionKey("")).toBeUndefined();
    expect(parseAgentIdFromSessionKey(undefined)).toBeUndefined();
  });

  it("tolerates whitespace around the value", () => {
    expect(parseAgentIdFromSessionKey("  agent:foo:bar  ")).toBe("foo");
  });
});

describe("normalizeRouteSessionKey", () => {
  const peer = { kind: "group" as const, id: "g_1" };

  it("[U-10] fills in a peer-scoped key when sessionKey is missing", () => {
    const result = normalizeRouteSessionKey(
      { agentId: "main", accountId: "A", sessionKey: "" },
      peer,
    );
    expect(result.sessionKey).toBe("agent:main:zapry:group:g_1");
  });

  it("[U-11] rewrites legacy 'main' or 'agent:{id}:main' keys", () => {
    expect(
      normalizeRouteSessionKey(
        { agentId: "main", accountId: "A", sessionKey: "main" },
        peer,
      ).sessionKey,
    ).toBe("agent:main:zapry:group:g_1");

    expect(
      normalizeRouteSessionKey(
        { agentId: "bot1", accountId: "A", sessionKey: "agent:bot1:main" },
        peer,
      ).sessionKey,
    ).toBe("agent:bot1:zapry:group:g_1");
  });

  it("[U-12] preserves an already-specific sessionKey verbatim", () => {
    const route = {
      agentId: "bot1",
      accountId: "A",
      sessionKey: "agent:bot1:zapry:group:g_2",
    };
    expect(normalizeRouteSessionKey(route, peer)).toEqual(route);
  });

  it("defaults missing agentId to 'main'", () => {
    const result = normalizeRouteSessionKey(
      { agentId: "", accountId: "A", sessionKey: "" },
      peer,
    );
    expect(result.agentId).toBe("main");
    expect(result.sessionKey).toBe("agent:main:zapry:group:g_1");
  });

  it("does not rewrite a non-'main' legacy-looking key", () => {
    const route = {
      agentId: "main",
      accountId: "A",
      sessionKey: "agent:main:custom",
    };
    expect(normalizeRouteSessionKey(route, peer)).toEqual(route);
  });
});

describe("buildPeerSessionKey", () => {
  it("builds the canonical group key", () => {
    expect(buildPeerSessionKey("main", { kind: "group", id: "g_1" })).toBe(
      "agent:main:zapry:group:g_1",
    );
  });

  it("builds the canonical direct key", () => {
    expect(buildPeerSessionKey("bot1", { kind: "direct", id: "9999" })).toBe(
      "agent:bot1:zapry:direct:9999",
    );
  });
});

describe("sameUserIdentity", () => {
  it("[U-17] treats '123' and '0123' as the same numeric identity", () => {
    expect(sameUserIdentity("123", "0123")).toBe(true);
  });

  it("[U-18] does not cross-match non-numeric ids that differ in case", () => {
    expect(sameUserIdentity("abc", "ABC")).toBe(false);
  });

  it("matches identical strings", () => {
    expect(sameUserIdentity("user_1", "user_1")).toBe(true);
  });

  it("returns false when either side is empty", () => {
    expect(sameUserIdentity("", "123")).toBe(false);
    expect(sameUserIdentity("123", "")).toBe(false);
  });

  it("returns false for numeric vs non-numeric mismatch", () => {
    expect(sameUserIdentity("123", "one")).toBe(false);
  });
});

describe("resolveOwnerIdFromBotToken", () => {
  it("extracts owner id before the colon", () => {
    expect(resolveOwnerIdFromBotToken("10086:AAEbot_secret")).toBe("10086");
  });

  it("returns empty string when no colon is present", () => {
    expect(resolveOwnerIdFromBotToken("not-a-token")).toBe("");
  });

  it("returns empty string for leading-colon tokens", () => {
    expect(resolveOwnerIdFromBotToken(":secret")).toBe("");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(resolveOwnerIdFromBotToken("   10086:secret   ")).toBe("10086");
  });

  it("tolerates null/undefined tokens", () => {
    expect(resolveOwnerIdFromBotToken(undefined as unknown as string)).toBe("");
    expect(resolveOwnerIdFromBotToken(null as unknown as string)).toBe("");
  });
});

describe("isOwnerInvocation", () => {
  const token = "10086:secret";

  it("[U-19] trusts explicit senderIsOwner=true without inspecting the token", () => {
    expect(
      isOwnerInvocation({ senderIsOwner: true, senderId: "", botToken: "" }),
    ).toBe(true);
  });

  it("[U-20] fails closed when senderId is missing and no explicit trust flag", () => {
    expect(
      isOwnerInvocation({ senderIsOwner: undefined, senderId: "", botToken: token }),
    ).toBe(false);
    expect(
      isOwnerInvocation({ senderIsOwner: false, senderId: "   ", botToken: token }),
    ).toBe(false);
  });

  it("[U-21] allows invocation when senderId matches the owner encoded in the bot token", () => {
    expect(
      isOwnerInvocation({ senderIsOwner: false, senderId: "10086", botToken: token }),
    ).toBe(true);
    expect(
      isOwnerInvocation({ senderIsOwner: undefined, senderId: "010086", botToken: token }),
    ).toBe(true);
  });

  it("denies invocation when senderId does not match the owner", () => {
    expect(
      isOwnerInvocation({ senderIsOwner: false, senderId: "42", botToken: token }),
    ).toBe(false);
  });

  it("denies invocation when the bot token is malformed", () => {
    expect(
      isOwnerInvocation({
        senderIsOwner: false,
        senderId: "10086",
        botToken: "malformed",
      }),
    ).toBe(false);
  });
});
