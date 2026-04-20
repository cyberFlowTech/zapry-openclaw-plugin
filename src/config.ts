import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_API_BASE_URL,
  type ResolvedZapryAccount,
  type ZapryChannelConfig,
} from "./types.js";

function getZapryConfig(cfg: any): ZapryChannelConfig | undefined {
  return cfg?.channels?.zapry;
}

export function listZapryAccountIds(cfg: any): string[] {
  const zapry = getZapryConfig(cfg);
  if (!zapry) return [];
  if (zapry.accounts && Object.keys(zapry.accounts).length > 0) {
    return Object.keys(zapry.accounts);
  }
  if (zapry.botToken) return [DEFAULT_ACCOUNT_ID];
  const envToken = process.env.ZAPRY_BOT_TOKEN;
  if (envToken) return [DEFAULT_ACCOUNT_ID];
  return [];
}

export function resolveZapryAccount(
  cfg: any,
  accountId?: string,
): ResolvedZapryAccount {
  const zapry = getZapryConfig(cfg) ?? {};
  const configuredIds =
    zapry.accounts && Object.keys(zapry.accounts).length > 0
      ? Object.keys(zapry.accounts)
      : [];
  const resolvedId =
    accountId ??
    (configuredIds.length === 1 ? configuredIds[0] : DEFAULT_ACCOUNT_ID);

  const envToken = process.env.ZAPRY_BOT_TOKEN;
  const fallbackToken = zapry.botToken ?? envToken ?? "";

  const acct = zapry.accounts?.[resolvedId];
  if (acct) {
    const token = acct.botToken ?? fallbackToken;
    return {
      accountId: resolvedId,
      name: acct.name,
      enabled: acct.enabled !== false,
      botToken: token,
      tokenSource: acct.botToken ? "config" : (zapry.botToken ? "config" : "env"),
      config: {
        apiBaseUrl: acct.apiBaseUrl ?? zapry.apiBaseUrl ?? DEFAULT_API_BASE_URL,
        mode: acct.mode ?? zapry.mode ?? "polling",
        webhookUrl: acct.webhookUrl ?? zapry.webhookUrl,
        dm: acct.dm ?? zapry.dm,
      },
    };
  }

  const token = fallbackToken;
  return {
    accountId: resolvedId,
    name: undefined,
    enabled: zapry.enabled !== false,
    botToken: token,
    tokenSource: zapry.botToken ? "config" : "env",
    config: {
      apiBaseUrl: zapry.apiBaseUrl ?? DEFAULT_API_BASE_URL,
      mode: zapry.mode ?? "polling",
      webhookUrl: zapry.webhookUrl,
      dm: zapry.dm,
    },
  };
}

export function resolveDefaultZapryAccountId(cfg: any): string {
  const ids = listZapryAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}
