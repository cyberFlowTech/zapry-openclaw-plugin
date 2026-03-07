import { getZapryRuntime } from "./runtime.js";
import { sendMessageZapry } from "./send.js";
import type { ResolvedZapryAccount } from "./types.js";

type RuntimeLog = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
};

type StatusSink = (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;

type ProcessInboundParams = {
  account: ResolvedZapryAccount;
  cfg?: any;
  runtime?: any;
  update: any;
  statusSink?: StatusSink;
  log?: RuntimeLog;
};

type ParsedInboundMessage = {
  rawBody: string;
  senderId: string;
  senderName?: string;
  chatId: string;
  chatType?: string;
  isGroup: boolean;
  messageSid: string;
  timestampMs?: number;
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Zapry/Telegram-like payloads usually use second-level timestamps.
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num < 1_000_000_000_000 ? num * 1000 : num;
    }
  }
  return undefined;
}

function parseInboundMessage(update: any): ParsedInboundMessage | null {
  const message = update?.message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const rawBody = asNonEmptyString(message.text) ?? asNonEmptyString(message.caption);
  if (!rawBody) {
    return null;
  }

  const chat = (message.chat ?? {}) as Record<string, unknown>;
  const from = (message.from ?? message.sender ?? {}) as Record<string, unknown>;

  const chatId =
    asNonEmptyString(chat.id != null ? String(chat.id) : undefined) ??
    asNonEmptyString(message.chat_id != null ? String(message.chat_id) : undefined) ??
    asNonEmptyString(message.chatId != null ? String(message.chatId) : undefined);
  if (!chatId) {
    return null;
  }

  const senderId =
    asNonEmptyString(from.id != null ? String(from.id) : undefined) ??
    asNonEmptyString(message.sender_id != null ? String(message.sender_id) : undefined) ??
    asNonEmptyString(message.from_id != null ? String(message.from_id) : undefined) ??
    chatId;

  const senderName =
    asNonEmptyString(from.name) ??
    asNonEmptyString(from.username) ??
    asNonEmptyString(from.first_name) ??
    asNonEmptyString(message.sender_name);

  const chatType = asNonEmptyString(chat.type);
  const isGroup =
    chatType === "group" ||
    chatType === "supergroup" ||
    chatType === "channel" ||
    chatId !== senderId;

  const messageSid = String(message.message_id ?? update?.update_id ?? Date.now());

  return {
    rawBody,
    senderId,
    senderName,
    chatId,
    chatType,
    isGroup,
    messageSid,
    timestampMs:
      parseTimestampMs(message.date) ??
      parseTimestampMs(message.timestamp) ??
      parseTimestampMs(update?.date),
  };
}

function resolveRuntime(explicitRuntime?: any): any | null {
  const isPluginRuntime = (candidate: any): boolean =>
    typeof candidate?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher === "function";

  if (isPluginRuntime(explicitRuntime)) {
    return explicitRuntime;
  }
  try {
    const fallback = getZapryRuntime();
    return isPluginRuntime(fallback) ? fallback : null;
  } catch {
    return null;
  }
}

function resolveConfig(explicitCfg: any, runtime: any): any {
  if (explicitCfg) {
    return explicitCfg;
  }
  const loadConfig = runtime?.config?.loadConfig;
  if (typeof loadConfig === "function") {
    try {
      return loadConfig();
    } catch {
      return {};
    }
  }
  return {};
}

function resolveStorePath(runtime: any, cfg: any, agentId?: string): string | undefined {
  const resolver = runtime?.channel?.session?.resolveStorePath;
  if (typeof resolver !== "function") {
    return undefined;
  }
  try {
    return resolver(cfg?.session?.store, { agentId });
  } catch {
    return undefined;
  }
}

function resolveRoute(params: {
  runtime: any;
  cfg: any;
  accountId: string;
  peer: { kind: "group" | "direct"; id: string };
}): { agentId: string; accountId: string; sessionKey: string } {
  const resolver = params.runtime?.channel?.routing?.resolveAgentRoute;
  if (typeof resolver === "function") {
    try {
      const route = resolver({
        cfg: params.cfg,
        channel: "zapry",
        accountId: params.accountId,
        peer: params.peer,
      });
      if (
        route &&
        typeof route.agentId === "string" &&
        typeof route.accountId === "string" &&
        typeof route.sessionKey === "string"
      ) {
        return route;
      }
    } catch {
      // fall through to local fallback
    }
  }
  return {
    agentId: "main",
    accountId: params.accountId,
    sessionKey: `agent:main:zapry:${params.peer.kind}:${params.peer.id}`,
  };
}

function extractMediaUrls(payload: any): string[] {
  const urls: string[] = [];

  if (Array.isArray(payload?.mediaUrls)) {
    for (const item of payload.mediaUrls) {
      if (typeof item === "string" && item.trim()) {
        urls.push(item.trim());
      }
    }
  }

  if (typeof payload?.mediaUrl === "string" && payload.mediaUrl.trim()) {
    urls.push(payload.mediaUrl.trim());
  }

  return urls;
}

async function deliverZapryReply(params: {
  runtime: any;
  cfg: any;
  account: ResolvedZapryAccount;
  chatId: string;
  payload: any;
  statusSink?: StatusSink;
  log?: RuntimeLog;
}): Promise<void> {
  const { runtime, cfg, account, chatId, payload, statusSink, log } = params;

  const textRuntime = runtime?.channel?.text;
  const tableMode =
    typeof textRuntime?.resolveMarkdownTableMode === "function"
      ? textRuntime.resolveMarkdownTableMode({
          cfg,
          channel: "zapry",
          accountId: account.accountId,
        })
      : "code";

  let text = typeof payload?.text === "string" ? payload.text : "";
  if (typeof textRuntime?.convertMarkdownTables === "function") {
    try {
      text = textRuntime.convertMarkdownTables(text, tableMode);
    } catch {
      // Keep original text when table conversion fails.
    }
  }

  const mediaUrls = extractMediaUrls(payload);
  for (const mediaUrl of mediaUrls) {
    const mediaResult = await sendMessageZapry(account, `chat:${chatId}`, "", { mediaUrl });
    if (!mediaResult.ok) {
      log?.warn?.(`[${account.accountId}] Zapry media reply failed: ${mediaResult.error ?? "unknown"}`);
      continue;
    }
    statusSink?.({ lastOutboundAt: Date.now() });
  }

  if (!text.trim()) {
    return;
  }

  const chunkMode =
    typeof textRuntime?.resolveChunkMode === "function"
      ? textRuntime.resolveChunkMode(cfg, "zapry", account.accountId)
      : undefined;
  const chunks =
    typeof textRuntime?.chunkMarkdownTextWithMode === "function"
      ? textRuntime.chunkMarkdownTextWithMode(text, 4096, chunkMode)
      : [text];

  const normalizedChunks = Array.isArray(chunks) && chunks.length > 0 ? chunks : [text];
  for (const chunk of normalizedChunks) {
    if (typeof chunk !== "string" || !chunk.trim()) {
      continue;
    }
    const textResult = await sendMessageZapry(account, `chat:${chatId}`, chunk);
    if (!textResult.ok) {
      log?.warn?.(`[${account.accountId}] Zapry text reply failed: ${textResult.error ?? "unknown"}`);
      continue;
    }
    statusSink?.({ lastOutboundAt: Date.now() });
  }
}

export async function processZapryInboundUpdate(params: ProcessInboundParams): Promise<boolean> {
  const { account, update, statusSink, log } = params;
  const parsed = parseInboundMessage(update);
  if (!parsed) {
    return false;
  }

  const runtime = resolveRuntime(params.runtime);
  if (!runtime) {
    return false;
  }

  const dispatchReply = runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (typeof dispatchReply !== "function") {
    return false;
  }

  const cfg = resolveConfig(params.cfg, runtime);
  const route = resolveRoute({
    runtime,
    cfg,
    accountId: account.accountId,
    peer: {
      kind: parsed.isGroup ? "group" : "direct",
      id: parsed.chatId,
    },
  });

  const storePath = resolveStorePath(runtime, cfg, route.agentId);
  const previousTimestamp =
    typeof runtime?.channel?.session?.readSessionUpdatedAt === "function" && storePath
      ? runtime.channel.session.readSessionUpdatedAt({
          storePath,
          sessionKey: route.sessionKey,
        })
      : undefined;

  const envelopeOptions =
    typeof runtime?.channel?.reply?.resolveEnvelopeFormatOptions === "function"
      ? runtime.channel.reply.resolveEnvelopeFormatOptions(cfg)
      : undefined;

  const fromLabel = parsed.isGroup
    ? parsed.chatType === "channel"
      ? `channel:${parsed.chatId}`
      : `group:${parsed.chatId}`
    : parsed.senderName || `user:${parsed.senderId}`;

  const body =
    typeof runtime?.channel?.reply?.formatAgentEnvelope === "function"
      ? runtime.channel.reply.formatAgentEnvelope({
          channel: "Zapry",
          from: fromLabel,
          timestamp: parsed.timestampMs,
          previousTimestamp,
          envelope: envelopeOptions,
          body: parsed.rawBody,
        })
      : parsed.rawBody;

  const inboundCtxBase = {
    Body: body,
    BodyForAgent: parsed.rawBody,
    RawBody: parsed.rawBody,
    CommandBody: parsed.rawBody,
    From: parsed.isGroup ? `zapry:group:${parsed.chatId}` : `zapry:${parsed.senderId}`,
    To: `zapry:${parsed.chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: parsed.isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: parsed.senderName || undefined,
    SenderId: parsed.senderId,
    Provider: "zapry",
    Surface: "zapry",
    MessageSid: parsed.messageSid,
    OriginatingChannel: "zapry",
    OriginatingTo: `zapry:${parsed.chatId}`,
  };

  const ctxPayload =
    typeof runtime?.channel?.reply?.finalizeInboundContext === "function"
      ? runtime.channel.reply.finalizeInboundContext(inboundCtxBase)
      : inboundCtxBase;

  if (typeof runtime?.channel?.session?.recordInboundSession === "function" && storePath) {
    await runtime.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err: unknown) => {
        log?.warn?.(`[${account.accountId}] zapry session meta update failed: ${String(err)}`);
      },
    });
  }

  statusSink?.({ lastInboundAt: Date.now() });

  await dispatchReply({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      deliver: async (payload: any) => {
        await deliverZapryReply({
          runtime,
          cfg,
          account,
          chatId: parsed.chatId,
          payload,
          statusSink,
          log,
        });
      },
      onError: (err: unknown, info: { kind?: string }) => {
        log?.warn?.(
          `[${account.accountId}] Zapry ${info?.kind ?? "reply"} dispatch failed: ${String(err)}`,
        );
      },
    },
  });

  return true;
}
