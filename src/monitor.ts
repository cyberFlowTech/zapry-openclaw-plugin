import { ZapryApiClient } from "./api-client.js";
import { processZapryInboundUpdate, tryHandleZapryInboundQuickPaths } from "./inbound.js";
import type { ResolvedZapryAccount } from "./types.js";

export type MonitorContext = {
  account: ResolvedZapryAccount;
  cfg?: any;
  runtime?: any;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  log?: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error?: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function summarizeUnhandledInboundUpdate(update: unknown): string {
  const record = asRecord(update);
  if (!record) {
    return "non-object update payload";
  }
  const topKeys = Object.keys(record);
  const messageLike =
    asRecord(record.message) ??
    asRecord(record.channel_post) ??
    asRecord(record.edited_message) ??
    asRecord(record.edited_channel_post) ??
    asRecord((record.callback_query as any)?.message) ??
    asRecord(record.msg) ??
    asRecord(record.Message);
  const messageKeys = messageLike ? Object.keys(messageLike) : [];
  return `top_keys=${JSON.stringify(topKeys.slice(0, 20))} message_keys=${JSON.stringify(messageKeys.slice(0, 24))}`;
}

export async function monitorZapryProvider(ctx: MonitorContext): Promise<void> {
  const { account } = ctx;
  if (account.config.mode === "webhook") {
    await startWebhookMode(ctx);
  } else {
    await startPollingMode(ctx);
  }
}

async function dispatchInboundUpdate(ctx: MonitorContext, update: any): Promise<boolean> {
  const { statusSink, log } = ctx;

  // Priority quick paths: handle deterministic moderation actions before any host callback mode.
  const handledByQuickPath = await tryHandleZapryInboundQuickPaths({
    account: ctx.account,
    update,
    statusSink,
    log,
  });
  if (handledByQuickPath) {
    return true;
  }

  return processZapryInboundUpdate({
    account: ctx.account,
    cfg: ctx.cfg,
    runtime: ctx.runtime,
    update,
    statusSink,
    log,
  });
}

async function startPollingMode(ctx: MonitorContext): Promise<void> {
  const { account, abortSignal, log } = ctx;
  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);

  await client.deleteWebhook();
  log?.info(`[${account.accountId}] polling mode started`);

  let offset = 0;
  let warnedMissingInboundHandler = false;
  let loggedUnhandledSample = false;
  let lastPollingApiError = "";
  while (!abortSignal?.aborted) {
    try {
      const resp = await client.getUpdates(offset, 100, 30);
      if (!resp.ok) {
        const errorSig = `${resp.error_code ?? "unknown"}:${resp.description ?? "unknown"}`;
        if (errorSig !== lastPollingApiError) {
          lastPollingApiError = errorSig;
          log?.warn(`[${account.accountId}] getUpdates failed: ${errorSig}`);
        }
        await sleep(3000);
        continue;
      }

      lastPollingApiError = "";
      if (!Array.isArray(resp.result)) {
        continue;
      }

      for (const update of resp.result) {
        const handled = await dispatchInboundUpdate(ctx, update);
        if (!handled && !warnedMissingInboundHandler) {
          warnedMissingInboundHandler = true;
          log?.warn(
            `[${account.accountId}] inbound update received but no compatible handler is available`,
          );
        }
        if (!handled && !loggedUnhandledSample) {
          loggedUnhandledSample = true;
          log?.warn(
            `[${account.accountId}] unhandled inbound update sample: ${summarizeUnhandledInboundUpdate(update)}`,
          );
        }
        const updateId = (update as any).update_id;
        if (typeof updateId === "number" && updateId >= offset) {
          offset = updateId + 1;
        }
      }
    } catch (err) {
      if (abortSignal?.aborted) break;
      log?.warn(`[${account.accountId}] polling error: ${String(err)}`);
      await sleep(3000);
    }
  }
  log?.info(`[${account.accountId}] polling stopped`);
}

async function startWebhookMode(ctx: MonitorContext): Promise<void> {
  const { account, log } = ctx;
  log?.warn(
    `[${account.accountId}] webhook inbound mode has been removed from the plugin runtime, falling back to polling`,
  );
  return startPollingMode(ctx);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
