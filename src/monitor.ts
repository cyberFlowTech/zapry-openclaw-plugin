import { ZapryApiClient } from "./api-client.js";
import { processZapryInboundUpdate } from "./inbound.js";
import type { ResolvedZapryAccount } from "./types.js";

export type MonitorContext = {
  account: ResolvedZapryAccount;
  cfg?: any;
  runtime?: any;
  abortSignal?: AbortSignal;
  onUpdate?: (update: any) => void;
  onMessage?: (message: any, update?: any) => void;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  log?: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error?: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
  };
};

export async function monitorZapryProvider(ctx: MonitorContext): Promise<void> {
  const { account } = ctx;
  if (account.config.mode === "webhook") {
    await startWebhookMode(ctx);
  } else {
    await startPollingMode(ctx);
  }
}

async function dispatchInboundUpdate(ctx: MonitorContext, update: any): Promise<boolean> {
  const { onUpdate, onMessage, statusSink, log } = ctx;
  const now = Date.now();

  // Compatibility mode #1: OpenClaw legacy gateway callback.
  if (typeof onUpdate === "function") {
    try {
      await Promise.resolve(onUpdate(update));
      statusSink?.({ lastInboundAt: now });
      return true;
    } catch (err) {
      log?.warn(`[${ctx.account.accountId}] legacy onUpdate failed: ${String(err)}`);
    }
  }

  // Compatibility mode #2: message-level callback style used in some forks.
  if (typeof onMessage === "function" && update?.message) {
    try {
      await Promise.resolve(onMessage(update.message, update));
      statusSink?.({ lastInboundAt: now });
      return true;
    } catch (err) {
      log?.warn(`[${ctx.account.accountId}] legacy onMessage failed: ${String(err)}`);
    }
  }

  // Compatibility mode #3: modern runtime pipeline (monitor + processMessage + statusSink).
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
  const { account, onUpdate, onMessage, log } = ctx;
  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);

  const webhookUrl = account.config.webhookUrl;
  if (!webhookUrl) {
    log?.warn(`[${account.accountId}] webhook mode requires webhookUrl, falling back to polling`);
    return startPollingMode(ctx);
  }

  // New runtime currently relies on plugin-managed polling for inbound processing.
  // Keep webhook path for backward-compatibility when legacy callbacks are wired by host.
  if (typeof onUpdate !== "function" && typeof onMessage !== "function") {
    log?.warn(
      `[${account.accountId}] webhook callback bridge unavailable in this host, falling back to polling`,
    );
    return startPollingMode(ctx);
  }

  const resp = await client.setWebhook(webhookUrl);
  if (!resp.ok) {
    log?.warn(`[${account.accountId}] setWebhook failed: ${resp.description}, falling back to polling`);
    return startPollingMode(ctx);
  }
  log?.info(`[${account.accountId}] webhook set to ${webhookUrl}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
