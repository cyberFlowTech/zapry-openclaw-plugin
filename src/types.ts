export const DEFAULT_ACCOUNT_ID = "default";
export const DEFAULT_API_BASE_URL = "https://openapi-dev.mimo.immo";

export type ZapryAccountConfig = {
  botToken?: string;
  apiBaseUrl?: string;
  mode?: "polling" | "webhook";
  webhookUrl?: string;
  enabled?: boolean;
  name?: string;
  dm?: {
    policy?: string;
    allowFrom?: string[];
  };
};

export type ZapryChannelConfig = {
  enabled?: boolean;
  botToken?: string;
  apiBaseUrl?: string;
  mode?: "polling" | "webhook";
  webhookUrl?: string;
  accounts?: Record<string, ZapryAccountConfig>;
  dm?: {
    policy?: string;
    allowFrom?: string[];
  };
};

export type ResolvedZapryAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  botToken: string;
  tokenSource: "config" | "env";
  config: {
    apiBaseUrl: string;
    mode: "polling" | "webhook";
    webhookUrl?: string;
    dm?: { policy?: string; allowFrom?: string[] };
  };
};

export type ZapryApiResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
};

export type ZaprySendOpts = {
  replyToMessageId?: string;
  messageThreadId?: string;
  replyMarkup?: unknown;
  accountId?: string;
};

export type ZaprySendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};
