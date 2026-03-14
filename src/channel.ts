import {
  listZapryAccountIds,
  resolveDefaultZapryAccountId,
  resolveZapryAccount,
} from "./config.js";
import { sendMessageZapry } from "./send.js";
import { monitorZapryProvider } from "./monitor.js";
import { handleZapryAction } from "./actions.js";
import { ZapryApiClient } from "./api-client.js";
import { DEFAULT_ACCOUNT_ID } from "./types.js";

export const zapryPlugin = {
  id: "zapry",
  meta: {
    id: "zapry",
    name: "Zapry",
    emoji: "⚡",
    description: "Zapry social platform — messaging, groups, feed, clubs",
  },

  capabilities: {
    chatTypes: ["direct", "channel"] as const,
    polls: false,
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: true,
  },

  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1000, idleMs: 800 },
  },

  reload: { configPrefixes: ["channels.zapry"] },

  config: {
    listAccountIds: (cfg: any) => listZapryAccountIds(cfg),
    resolveAccount: (cfg: any, accountId?: string) => resolveZapryAccount(cfg, accountId),
    defaultAccountId: (cfg: any) => resolveDefaultZapryAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }: any) => {
      const next = structuredClone(cfg);
      const zapry = next.channels?.zapry;
      if (!zapry) return next;
      if (zapry.accounts?.[accountId]) {
        zapry.accounts[accountId].enabled = enabled;
      } else if (accountId === DEFAULT_ACCOUNT_ID) {
        zapry.enabled = enabled;
      }
      return next;
    },
    deleteAccount: ({ cfg, accountId }: any) => {
      const next = structuredClone(cfg);
      const zapry = next.channels?.zapry;
      if (!zapry) return next;
      if (zapry.accounts?.[accountId]) {
        delete zapry.accounts[accountId];
      }
      return next;
    },
    isConfigured: (account: any) => Boolean(account.botToken?.trim()),
    describeAccount: (account: any) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.botToken?.trim()),
      tokenSource: account.tokenSource,
    }),
  },

  security: {
    resolveDmPolicy: ({ account }: any) => ({
      policy: account.config.dm?.policy ?? "open",
      allowFrom: account.config.dm?.allowFrom ?? [],
      allowFromPath: `channels.zapry.dm.`,
    }),
  },

  messaging: {
    normalizeTarget: (to: string) => to.replace(/^chat:/i, "").trim(),
    targetResolver: {
      looksLikeId: (input: string) => /^\d+$/.test(input.replace(/^chat:/i, "")),
      hint: "<chatId|chat:ID>",
    },
  },

  agentPrompt: {
    messageToolHints: () => [
      `For Zapry, use "message" tool only for sending chat messages with action "send". ` +
      `For all non-messaging Zapry operations, use "zapry_action". ` +
      `To publish to feed (广场), use "zapry_post" with content and optional images.`,
    ],
  },

  actions: {
    listActions: () => [
      "send",
    ],
    extractToolSend: (ctx: any) => {
      if (ctx.action === "send" || ctx.action === "send-message") {
        return {
          to: ctx.params?.to ?? ctx.params?.chatId ?? ctx.params?.chat_id,
          text: ctx.params?.message ?? ctx.params?.text,
        };
      }
      return null;
    },
    handleAction: async (ctx: any) => {
      const account = resolveZapryAccount(ctx.cfg, ctx.accountId);
      return handleZapryAction({
        action: ctx.action,
        channel: "zapry",
        account,
        params: ctx.params ?? {},
      });
    },
  },

  outbound: {
    deliveryMode: "direct" as const,
    chunker: null,
    textChunkLimit: 4096,
    resolveTarget: ({ to }: { to: string }) => to.replace(/^chat:/i, "").trim(),
    sendText: async ({ to, text, accountId, deps, replyToId }: any) => {
      const cfg = deps?.cfg;
      const account = resolveZapryAccount(cfg, accountId);
      const result = await sendMessageZapry(account, to, text, { replyTo: replyToId });
      return { channel: "zapry", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, deps, replyToId }: any) => {
      const cfg = deps?.cfg;
      const account = resolveZapryAccount(cfg, accountId);
      const result = await sendMessageZapry(account, to, text || "", { mediaUrl, replyTo: replyToId });
      return { channel: "zapry", ...result };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },
    probeAccount: async ({ account, timeoutMs }: any) => {
      try {
        const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
        const resp = await client.getMe();
        if (!resp.ok) {
          return {
            ok: false,
            errorCode: resp.error_code,
            error: resp.description ?? "getMe failed",
          };
        }
        return { ok: true, bot: resp.result };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    buildAccountSnapshot: ({ account, runtime, probe }: any) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.botToken?.trim()),
      tokenSource: account.tokenSource,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      probe,
    }),
  },

  gateway: {
    startAccount: async (ctx: any) => {
      const { account } = ctx;
      ctx.log?.info(`[${account.accountId}] starting Zapry provider (${account.config.mode} mode)`);

      try {
        const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
        const probe = await client.getMe();
        if (probe.ok) {
          const bot = probe.result as any;
          ctx.log?.info(`[${account.accountId}] bot: ${bot?.name ?? bot?.username ?? "unknown"}`);
          ctx.setStatus?.({ accountId: account.accountId, bot });
        } else {
          ctx.log?.warn(
            `[${account.accountId}] getMe probe failed: ` +
              `${probe.error_code ?? "unknown"}:${probe.description ?? "unknown"}`,
          );
        }
      } catch {
        // probe is best-effort
      }

      return monitorZapryProvider({
        account,
        cfg: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        onUpdate: ctx.onUpdate,
        onMessage: ctx.onMessage,
        statusSink: (patch) => {
          if (typeof ctx.setStatus === "function") {
            ctx.setStatus({ accountId: ctx.accountId, ...patch });
          }
        },
        log: ctx.log,
      });
    },
  },
};
