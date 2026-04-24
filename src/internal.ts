// Pure helpers used across index.ts, src/actions.ts and src/inbound.ts.
// Extracted here so they are both tree-shakable and unit-testable without
// pulling in the OpenClaw runtime or the Zapry HTTP client.
//
// Rules:
//   • No I/O, no process.env reads, no dynamic imports.
//   • Deterministic: same input → same output.
//   • Safe to import from any layer (channel / actions / inbound / tests).

/**
 * Strip a single leading Zapry-side target prefix from a chat id.
 *
 *   "chat:g_123"              → "g_123"
 *   "zapry:g_123"             → "g_123"
 *   "zapry:group:g_123"       → "g_123"
 *   "zapry:group:group:g_123" → "g_123"  (repeated `group:` segments are chained)
 *   "zapry:direct:123"        → "direct:123" (any trailing kind is preserved after `zapry:` is stripped)
 *   "g_123"                   → "g_123"  (no-op)
 *
 * Caveat: The regex matches once and is anchored at the start, so a
 * double-wrapped id like `zapry:group:zapry:group:g_123` will only lose its
 * outermost wrapper (→ `zapry:group:g_123`). Call again if a legacy producer
 * is known to emit double wraps.
 */
export function stripZapryTargetPrefix(value: string): string {
  return value.replace(/^(?:chat:|zapry:(?:group:)*)/i, "");
}

/**
 * Extract the agent id from a structured sessionKey of the form
 *   `agent:{agentId}:...`
 * Returns undefined if the key does not match the agent-scoped shape
 * (e.g. legacy `"main"` or an empty string).
 */
export function parseAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const value = `${sessionKey || ""}`.trim();
  const match = /^agent:([^:]+):/.exec(value);
  return match?.[1]?.trim() || undefined;
}

/**
 * Structural identity check for two user id strings.
 *
 * Zapry user ids are typically numeric; the same underlying id may arrive as
 * `"123"` or `"0123"`. We accept a numeric match when both sides parse to a
 * finite number. Non-numeric ids fall back to strict equality.
 */
export function sameUserIdentity(left: string, right: string): boolean {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftNum = Number(normalizedLeft);
  const rightNum = Number(normalizedRight);
  return Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum === rightNum;
}

/**
 * Zapry bot tokens are `{ownerId}:{secret}`. Returns ownerId or empty string
 * if the token is malformed (missing colon, leading colon, etc).
 */
export function resolveOwnerIdFromBotToken(botToken: string): string {
  const trimmed = String(botToken ?? "").trim();
  const separatorIdx = trimmed.indexOf(":");
  if (separatorIdx <= 0) {
    return "";
  }
  return trimmed.slice(0, separatorIdx).trim();
}

/**
 * Canonical session key for a (agent, zapry peer) pair.
 *
 *   agent:{agentId}:zapry:{kind}:{peerId}
 */
export function buildPeerSessionKey(
  agentId: string,
  peer: { kind: "group" | "direct"; id: string },
): string {
  return `agent:${agentId}:zapry:${peer.kind}:${peer.id}`;
}

export type RouteLike = {
  agentId: string;
  accountId: string;
  sessionKey: string;
};

/**
 * Ensure a route emitted by the OpenClaw router has a peer-scoped sessionKey.
 *
 * Legacy routers sometimes return the agent's "main" session key (`"main"` or
 * `agent:{agentId}:main`) which conflates every peer into a single thread.
 * When that happens we rebuild the key using {@link buildPeerSessionKey}.
 * Any other non-empty sessionKey is preserved verbatim.
 */
export function normalizeRouteSessionKey(
  route: RouteLike,
  peer: { kind: "group" | "direct"; id: string },
): RouteLike {
  const agentId = `${route.agentId || ""}`.trim() || "main";
  const sessionKey = `${route.sessionKey || ""}`.trim();
  if (!sessionKey) {
    return {
      ...route,
      agentId,
      sessionKey: buildPeerSessionKey(agentId, peer),
    };
  }

  const defaultMainSessionKey = `agent:${agentId}:main`;
  if (sessionKey === "main" || sessionKey === defaultMainSessionKey) {
    return {
      ...route,
      agentId,
      sessionKey: buildPeerSessionKey(agentId, peer),
    };
  }

  return route;
}

/**
 * Decide whether a tool invocation is coming from the bot's owner.
 *
 * Precedence:
 *   1. Explicit trust from the caller (`senderIsOwner === true`) wins.
 *   2. Missing sender id → fail closed (return false).
 *   3. Otherwise compare the runtime sender id with the id embedded in the
 *      bot token via {@link sameUserIdentity}.
 */
export function isOwnerInvocation(params: {
  senderIsOwner?: boolean;
  senderId: string;
  botToken: string;
}): boolean {
  if (params.senderIsOwner === true) {
    return true;
  }
  const senderId = `${params.senderId || ""}`.trim();
  if (!senderId) {
    return false;
  }
  const ownerId = resolveOwnerIdFromBotToken(params.botToken);
  return sameUserIdentity(senderId, ownerId);
}

const NON_OWNER_ALLOWED_ZAPRY_ACTIONS = new Set([
  "send",
  "send-message",
  "send-photo",
  "send-video",
  "send-document",
  "send-audio",
  "send-voice",
  "send-animation",
  "generate-audio",
  "get-file",
]);

const ZAPRY_ACTION_PERMISSION_ALIASES: Record<string, string> = {
  sendmessage: "send-message",
  sendphoto: "send-photo",
  sendvideo: "send-video",
  senddocument: "send-document",
  sendaudio: "send-audio",
  sendvoice: "send-voice",
  sendanimation: "send-animation",
  generateaudio: "generate-audio",
  renderaudio: "generate-audio",
  ttsaudio: "generate-audio",
  getfile: "get-file",
};

export function normalizeZapryActionForPermission(action: string | undefined): string {
  const raw = `${action || ""}`.trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const hyphen = lower.replace(/[\s_]+/g, "-");
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return ZAPRY_ACTION_PERMISSION_ALIASES[lower]
    ?? ZAPRY_ACTION_PERMISSION_ALIASES[hyphen]
    ?? ZAPRY_ACTION_PERMISSION_ALIASES[compact]
    ?? hyphen;
}

export function canNonOwnerExecuteZapryAction(params: {
  action: string | undefined;
  requestedChatId?: string;
  invocationChatId?: string;
}): boolean {
  const action = normalizeZapryActionForPermission(params.action);
  if (!NON_OWNER_ALLOWED_ZAPRY_ACTIONS.has(action)) {
    return false;
  }
  if (action === "get-file") {
    return true;
  }

  const invocationChatId = stripZapryTargetPrefix(`${params.invocationChatId || ""}`.trim());
  const requestedChatId = stripZapryTargetPrefix(`${params.requestedChatId || ""}`.trim());
  if (!invocationChatId || !requestedChatId) {
    return false;
  }
  return requestedChatId === invocationChatId;
}
