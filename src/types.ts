export const DEFAULT_ACCOUNT_ID = "default";
export const DEFAULT_API_BASE_URL = "https://openapi.mimo.immo";

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

// ── Profile Source (auto-sync to Zapry platform) ──

export type ProfileSourceSkill = {
  skillKey: string;
  skillVersion: string;
  source: string;
  path: string;
  content: string;
  sha256: string;
  bytes: number;
};

export type ProfileSource = {
  version: string;
  source: string;
  agentKey: string;
  snapshotId: string;
  soulMd: string;
  skills: ProfileSourceSkill[];
};

export type DerivedProfile = {
  name?: string;
  role?: string;
  vibe?: string;
  emoji?: string;
  avatar?: string;
  tags?: string[];
  summary?: string;
  skills?: string[];
  routeTags?: string[];
  derivedVersion?: string;
  derivedAt?: string;
  overrideRevision?: number;
};

// ── Feed / Post (snake_case, 对齐 openapi-server 新响应格式) ──

export type PostComment = {
  id: number;
  user_id: number;
  text: string;
  time: number;
  nick: string;
  avatar: string;
  type: number;
};

export type PostInfo = {
  id: number;
  user_id: number;
  desc: string;
  text: string;
  media: string;
  ctime: number;
  nick: string;
  avatar: string;
  praise_count: number;
  comment_count: number;
  share_count: number;
  can_share: number;
};

export type FeedItem = {
  info: PostInfo;
  comments: PostComment[];
};

export type FeedListResponse = {
  items: FeedItem[];
  pages: number;
};

export type CreatePostResponse = {
  created: boolean;
  dynamic_id: number;
};

// ── Chat History ──

export type ChatHistoryMessage = {
  message_id: string;
  from_id: string;
  from_name?: string;
  is_bot: boolean;
  chat_id: string;
  text?: string;
  type: string;
  timestamp: number;
  media_url?: string;
};

export type ChatHistoryResponse = {
  chat_id: string;
  count: number;
  messages: ChatHistoryMessage[];
};

// ── Profile ──

export type SetMyProfilePayload = {
  profileSource: ProfileSource;
};

export type SetMyProfileResponse = {
  ok: boolean;
  unsupported_profile_source?: boolean;
  derived?: {
    snapshotId?: string;
    profile?: DerivedProfile;
  };
};
