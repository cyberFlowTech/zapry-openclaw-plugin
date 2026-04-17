import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_API_BASE_URL,
  type ResolvedZapryAccount,
  type ZapryChannelConfig,
} from "./types.js";

function getZapryConfig(cfg: any): ZapryChannelConfig | undefined {
  return cfg?.channels?.zapry;
}

function normalizeZapryApiBase(raw: string | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return DEFAULT_API_BASE_URL;
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  const normalized = withoutTrailingSlash.replace(/\/bot$/i, "");
  return normalized || DEFAULT_API_BASE_URL;
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
  const resolvedId = accountId ?? DEFAULT_ACCOUNT_ID;

  const acct = zapry.accounts?.[resolvedId];
  if (acct) {
    return {
      accountId: resolvedId,
      name: acct.name,
      enabled: acct.enabled !== false,
      botToken: acct.botToken ?? "",
      tokenSource: "config",
      config: {
        apiBaseUrl: normalizeZapryApiBase(acct.apiBaseUrl ?? zapry.apiBaseUrl ?? DEFAULT_API_BASE_URL),
        mode: acct.mode ?? zapry.mode ?? "polling",
        webhookUrl: acct.webhookUrl ?? zapry.webhookUrl,
        dm: acct.dm ?? zapry.dm,
      },
    };
  }

  const envToken = process.env.ZAPRY_BOT_TOKEN;
  const token = zapry.botToken ?? envToken ?? "";
  return {
    accountId: resolvedId,
    name: undefined,
    enabled: zapry.enabled !== false,
    botToken: token,
    tokenSource: zapry.botToken ? "config" : "env",
    config: {
      apiBaseUrl: normalizeZapryApiBase(zapry.apiBaseUrl ?? DEFAULT_API_BASE_URL),
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
