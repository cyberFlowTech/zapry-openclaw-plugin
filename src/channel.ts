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
import type { ResolvedZapryAccount } from "./types.js";
import { syncProfileToZapry } from "./profile-sync.js";

const IS_STANDARD_CHAT_ID = /^[gup]_\d+$/;

function isProfileSyncEnabled(ctx: any, accountId: string): boolean {
  const zapryCfg = ctx?.cfg?.channels?.zapry;
  const globalEnabled = zapryCfg?.profileSync?.enabled;
  const accountEnabled = zapryCfg?.accounts?.[accountId]?.profileSync?.enabled;

  if (typeof accountEnabled === "boolean") return accountEnabled;
  if (typeof globalEnabled === "boolean") return globalEnabled;
  return true;
}

async function resolveOutboundTarget(account: ResolvedZapryAccount, to: string): Promise<string> {
  const trimmed = to.trim();
  if (IS_STANDARD_CHAT_ID.test(trimmed) || trimmed.startsWith("chat:") || /^\d+$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
    const resp = await client.getMyGroups(1, 100);
    if (!resp.ok) return trimmed;
    const raw = (resp as any).result;
    const groups: any[] = Array.isArray(raw) ? raw : raw?.items ?? raw?.groups ?? [];
    for (const g of groups) {
      const info = g.info ?? g;
      const gName = info.group_name ?? info.name ?? info.title ?? "";
      const gId = info.chat_id ?? info.group_id ?? info.id ?? "";
      if (String(gName) === trimmed && gId) return String(gId);
    }
    for (const g of groups) {
      const info = g.info ?? g;
      const gName = String(info.group_name ?? info.name ?? info.title ?? "");
      const gId = info.chat_id ?? info.group_id ?? info.id ?? "";
      if (gName.includes(trimmed) && gId) return String(gId);
    }
  } catch {}
  return trimmed;
}

export const zapryPlugin = {
  id: "zapry",
  meta: {
    id: "zapry",
    name: "Zapry",
    emoji: "⚡",
    description: "Zapry social platform — messaging, groups, feed, clubs",
  },

  capabilities: {
    chatTypes: ["direct", "channel", "group"] as const,
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
    normalizeTarget: (to: string) => to.replace(/^(chat|zapry):/i, "").trim(),
    targetResolver: {
      looksLikeId: (input: string) => /^(g_)?\d+$/.test(input.replace(/^(chat|zapry):/i, "").trim()),
      hint: "<chatId|chat:ID>",
    },
  },

  agentPrompt: {
    messageToolHints: () => [
      `For ALL Zapry operations, prefer "zapry_action" tool. ` +
      `To send text messages: use "zapry_action" action="send-message" with chat_id and text — supports group names (auto-resolved). ` +
      `To send photos: use "zapry_action" action="send-photo" with "prompt" parameter to auto-generate images (e.g. prompt="cute cat"). ` +
      `To send video/audio/document: use "zapry_action" with send-video/send-audio/send-document. ` +
      `IMPORTANT: Do NOT use "message" tool for Zapry group chats — it cannot resolve group names. Always use zapry_action instead. ` +
      `To publish to feed (广场), use "zapry_post" with content and optional images.`,
    ],
  },

  actions: {
    listActions: () => [
      "send",
    ],
    extractToolSend: (ctx: any) => {
      if (ctx.action === "send" || ctx.action === "send-message") {
        const result: Record<string, any> = {
          to: ctx.params?.to ?? ctx.params?.chatId ?? ctx.params?.chat_id,
          text: ctx.params?.message ?? ctx.params?.text,
        };
        const mediaUrl =
          ctx.params?.photo ?? ctx.params?.video ?? ctx.params?.animation ??
          ctx.params?.document ?? ctx.params?.audio ?? ctx.params?.voice ??
          ctx.params?.mediaUrl ?? ctx.params?.media_url ?? ctx.params?.media;
        if (mediaUrl) result.mediaUrl = mediaUrl;
        return result;
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
    resolveTarget: ({ to }: { to: string }) => to.replace(/^(chat|zapry):/i, "").trim(),
    sendText: async ({ to, text, accountId, deps, replyToId }: any) => {
      const cfg = deps?.cfg;
      const account = resolveZapryAccount(cfg, accountId);
      const resolvedTo = await resolveOutboundTarget(account, to);
      const result = await sendMessageZapry(account, resolvedTo, text, { replyTo: replyToId });
      return { channel: "zapry", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, deps, replyToId }: any) => {
      const cfg = deps?.cfg;
      const account = resolveZapryAccount(cfg, accountId);
      const resolvedTo = await resolveOutboundTarget(account, to);
      const result = await sendMessageZapry(account, resolvedTo, text || "", { mediaUrl, replyTo: replyToId });
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

      const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);

      try {
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

      client.setMyPresence(true).catch(() => {});
      ctx.log?.info(`[${account.accountId}] presence set to online`);

      const profileSyncEnabled = isProfileSyncEnabled(ctx, account.accountId);
      if (profileSyncEnabled) {
        const projectRoot =
          ctx.runtime?.projectRoot ?? ctx.runtime?.config?.projectRoot ?? process.cwd();
        syncProfileToZapry(account, { projectRoot, log: ctx.log }).catch((err) => {
          ctx.log?.warn?.(
            `[${account.accountId}] profile sync failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      } else {
        ctx.log?.info?.(`[${account.accountId}] profile sync disabled by config`);
      }

      ctx.abortSignal?.addEventListener("abort", () => {
        client.setMyPresence(false).catch(() => {});
        ctx.log?.info(`[${account.accountId}] presence set to offline`);
      });

      const effectiveRuntime = ctx.channelRuntime
        ? { ...ctx.runtime, channel: ctx.channelRuntime }
        : ctx.runtime;

      return monitorZapryProvider({
        account,
        cfg: ctx.cfg,
        runtime: effectiveRuntime,
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
