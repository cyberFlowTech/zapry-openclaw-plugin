import { ZapryApiClient } from "./api-client.js";
import type { ResolvedZapryAccount } from "./types.js";

export type MonitorContext = {
  account: ResolvedZapryAccount;
  abortSignal?: AbortSignal;
  onUpdate?: (update: any) => void;
  log?: { info: (...args: any[]) => void; warn: (...args: any[]) => void; debug?: (...args: any[]) => void };
};

export async function monitorZapryProvider(ctx: MonitorContext): Promise<void> {
  const { account } = ctx;
  if (account.config.mode === "webhook") {
    await startWebhookMode(ctx);
  } else {
    await startPollingMode(ctx);
  }
}

async function startPollingMode(ctx: MonitorContext): Promise<void> {
  const { account, abortSignal, onUpdate, log } = ctx;
  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);

  await client.deleteWebhook();
  log?.info(`[${account.accountId}] polling mode started`);

  let offset = 0;
  while (!abortSignal?.aborted) {
    try {
      const resp = await client.getUpdates(offset, 100, 30);
      if (resp.ok && Array.isArray(resp.result)) {
        for (const update of resp.result) {
          onUpdate?.(update);
          const updateId = (update as any).update_id;
          if (typeof updateId === "number" && updateId >= offset) {
            offset = updateId + 1;
          }
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
  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);

  const webhookUrl = account.config.webhookUrl;
  if (!webhookUrl) {
    log?.warn(`[${account.accountId}] webhook mode requires webhookUrl, falling back to polling`);
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
