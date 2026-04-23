import { describe, expect, it } from "vitest";
import { isOwnerInvocation } from "../src/internal.js";

/**
 * Integration-style coverage for the "register vs execute" permission model
 * introduced in PR #1. The plugin now ALWAYS registers Zapry owner tools
 * (because session snapshots are built before trusted sender context
 * attaches) and enforces ownership at EXECUTE time via
 * shouldExecuteZapryOwnerTools → resolveToolSenderIsOwner → isOwnerInvocation.
 *
 * We drive the execute-time gate directly here. This exercises the full
 * decision matrix without booting the OpenClaw runtime.
 */

type ExecuteGateInput = {
  senderIsOwner?: boolean;
  requesterSenderId?: string;
  invocationSenderId?: string;
  botToken: string;
};

// Mirrors resolveToolSenderId + resolveToolSenderIsOwner in index.ts.
function executeGate(input: ExecuteGateInput): boolean {
  const senderId =
    String(input.requesterSenderId ?? "").trim() ||
    String(input.invocationSenderId ?? "").trim();
  return isOwnerInvocation({
    senderIsOwner: input.senderIsOwner,
    senderId,
    botToken: input.botToken,
  });
}

describe("owner tool execute-time gate (I-01 / I-02)", () => {
  const token = "10086:bot-secret";

  it("[I-02] owner sender is allowed (toolCtx-provided id)", () => {
    expect(
      executeGate({ requesterSenderId: "10086", botToken: token }),
    ).toBe(true);
  });

  it("[I-02b] owner sender is allowed (skill invocation context id)", () => {
    expect(
      executeGate({ invocationSenderId: "10086", botToken: token }),
    ).toBe(true);
  });

  it("[I-02c] toolCtx id takes precedence over invocation-context id", () => {
    // Critical: the trusted chat-side id overrides anything in the ambient
    // skill invocation context, preventing a stale/mismatched context from
    // sneaking through.
    expect(
      executeGate({
        requesterSenderId: "10086",
        invocationSenderId: "99999",
        botToken: token,
      }),
    ).toBe(true);

    expect(
      executeGate({
        requesterSenderId: "99999",
        invocationSenderId: "10086",
        botToken: token,
      }),
    ).toBe(false);
  });

  it("[I-01] non-owner sender is denied", () => {
    expect(
      executeGate({ requesterSenderId: "42", botToken: token }),
    ).toBe(false);
  });

  it("[I-01b] anonymous invocation (no senderId anywhere) is denied", () => {
    expect(executeGate({ botToken: token })).toBe(false);
  });

  it("explicit senderIsOwner=true short-circuits the id check", () => {
    // Upstream runtime sometimes knows the owner via trusted out-of-band
    // context (OAuth, platform-native identity). We honour that signal.
    expect(
      executeGate({
        senderIsOwner: true,
        requesterSenderId: "",
        botToken: token,
      }),
    ).toBe(true);
  });

  it("explicit senderIsOwner=false is NOT hard-denying — token match still wins", () => {
    // This is the deliberate change in PR #1. The previous code had:
    //   if (senderIsOwner === false) return false;
    // which would override a correct sender-id match. The fix compares
    // ids regardless, so a real owner invocation is never dropped just
    // because an upstream layer set senderIsOwner=false by default.
    expect(
      executeGate({
        senderIsOwner: false,
        requesterSenderId: "10086",
        botToken: token,
      }),
    ).toBe(true);
  });

  it("malformed bot token denies every non-trusted sender", () => {
    // resolveOwnerIdFromBotToken returns "" for a token without a colon; an
    // empty ownerId can never equal any senderId (sameUserIdentity returns
    // false for empty sides), so the gate is closed by default.
    expect(
      executeGate({ requesterSenderId: "10086", botToken: "no-colon" }),
    ).toBe(false);
  });

  it("numeric-string equivalence (e.g. '10086' vs '010086') is respected", () => {
    expect(
      executeGate({ requesterSenderId: "010086", botToken: token }),
    ).toBe(true);
  });
});
