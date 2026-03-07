import { ZapryApiClient } from "./api-client.js";
import type { ResolvedZapryAccount } from "./types.js";

export type ActionContext = {
  action: string;
  channel: string;
  account: ResolvedZapryAccount;
  params: Record<string, any>;
};

export type ActionResult = {
  ok: boolean;
  result?: any;
  error?: string;
};

export async function handleZapryAction(ctx: ActionContext): Promise<ActionResult> {
  const { action, account, params } = ctx;
  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
  const normalized = normalizeActionParams(action, params);
  const requiredError = validateRequiredParams(action, normalized);
  if (requiredError) {
    return { ok: false, error: requiredError };
  }

  switch (action) {
    // ── Messaging ──
    case "send":
      return handleSend(client, normalized);
    case "send-audio":
      return wrap(client.sendAudio(normalized.chatId, normalized.audio));
    case "send-voice":
      return wrap(client.sendVoice(normalized.chatId, normalized.voice));
    case "send-animation":
      return wrap(client.sendAnimation(normalized.chatId, normalized.animation));
    case "delete":
      return wrap(client.deleteMessage(normalized.chatId, normalized.messageId));
    case "answer-callback-query":
      return wrap(
        client.answerCallbackQuery(
          normalized.callbackQueryId,
          normalized.text,
          normalized.showAlert === true,
        ),
      );
    case "get-file":
      return wrap(client.getFile(normalized.fileId));
    case "set-my-commands":
      return wrap(client.setMyCommands(normalized.commands, normalized.languageCode));
    case "get-my-commands":
      return wrap(client.getMyCommands(normalized.languageCode));
    case "delete-my-commands":
      return wrap(client.deleteMyCommands(normalized.languageCode));
    case "get-updates":
      return wrap(client.getUpdates(normalized.offset, normalized.limit, normalized.timeout));
    case "set-webhook":
      return wrap(client.setWebhook(normalized.url));
    case "get-webhook-info":
      return wrap(client.getWebhookInfo());
    case "delete-webhook":
      return wrap(client.deleteWebhook());
    case "webhooks-token":
      return {
        ok: true,
        result: {
          method: "POST",
          endpoint: `${account.config.apiBaseUrl}/webhooks/${account.botToken}`,
          note: "Inbound webhook endpoint for provider push updates.",
        },
      };

    // ── Group Management ──
    case "ban":
      return wrap(client.banChatMember(normalized.chatId, normalized.userId));
    case "unban":
      return wrap(client.unbanChatMember(normalized.chatId, normalized.userId));
    case "mute":
      return wrap(client.restrictChatMember(normalized.chatId, normalized.userId, true));
    case "unmute":
      return wrap(client.restrictChatMember(normalized.chatId, normalized.userId, false));
    case "kick":
      return wrap(client.kickChatMember(normalized.chatId, normalized.userId));
    case "set-chat-title":
      return wrap(client.setChatTitle(normalized.chatId, normalized.title));
    case "set-chat-description":
      return wrap(client.setChatDescription(normalized.chatId, normalized.description));
    case "get-chat-admins":
      return wrap(client.getChatAdministrators(normalized.chatId));
    case "get-chat-member":
      return wrap(client.getChatMember(normalized.chatId, normalized.userId));
    case "get-chat-member-count":
      return wrap(client.getChatMemberCount(normalized.chatId));

    // ── Feed ──
    case "create-post":
      return wrap(client.createPost(normalized.content, normalized.images));
    case "comment-post":
      return wrap(client.commentPost(normalized.dynamicId, normalized.content));
    case "like-post":
      return wrap(client.likePost(normalized.dynamicId));
    case "share-post":
      return wrap(client.sharePost(normalized.dynamicId));

    // ── Discovery ──
    case "get-trending":
      return wrap(client.getTrendingPosts(normalized.page, normalized.pageSize));
    case "get-latest-posts":
      return wrap(client.getLatestPosts(normalized.page, normalized.pageSize));
    case "get-my-posts":
      return wrap(client.getMyPosts(normalized.page, normalized.pageSize));
    case "search-posts":
      return wrap(client.searchPosts(normalized.keyword, normalized.page, normalized.pageSize));
    case "get-communities":
      return wrap(client.getPublicCommunities(normalized.page, normalized.pageSize));
    case "get-wallet-address":
      return wrap(client.getWalletAddress(normalized.userId));
    case "get-user-profile-photos":
      return wrap(client.getUserProfilePhotos(normalized.userId));

    // ── Clubs ──
    case "create-club":
      return wrap(client.createClub(normalized.name, normalized.desc, normalized.avatar));
    case "post-to-club":
      return wrap(client.postToClub(normalized.clubId, normalized.content, normalized.images));
    case "update-club":
      return wrap(
        client.updateClub(normalized.clubId, normalized.name, normalized.desc, normalized.avatar),
      );

    // ── Bot Self-Management ──
    case "get-me":
      return wrap(client.getMe());
    case "set-name":
      return wrap(client.setMyName(normalized.name));
    case "set-description":
      return wrap(client.setMyDescription(normalized.description));
    case "set-wallet-address":
      return wrap(client.setMyWalletAddress(normalized.walletAddress));
    case "set-profile":
      return wrap(client.setMyProfile(normalized.profileSource));
    case "get-profile":
      return wrap(client.getMyProfile());

    default:
      return { ok: false, error: `unknown zapry action: ${action}` };
  }
}

async function handleSend(client: ZapryApiClient, params: Record<string, any>): Promise<ActionResult> {
  const chatId = normalizeChatId(params.to ?? params.chatId ?? "");
  const text = params.message ?? params.text ?? "";
  const media = params.media ?? params.mediaUrl;

  if (media) {
    const ext = String(media).split(".").pop()?.toLowerCase() ?? "";
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp"];
    const videoExts = ["mp4", "mov", "avi", "webm"];

    if (imageExts.includes(ext)) {
      return wrap(client.sendPhoto(chatId, media));
    } else if (videoExts.includes(ext)) {
      return wrap(client.sendVideo(chatId, media));
    } else if (ext) {
      return wrap(client.sendDocument(chatId, media));
    }
    return wrap(client.sendPhoto(chatId, media));
  }

  return wrap(client.sendMessage(chatId, text, { replyToMessageId: params.replyTo }));
}

function validateRequiredParams(action: string, params: Record<string, any>): string | null {
  const hasText = typeof params.message === "string" || typeof params.text === "string";
  const hasMedia = typeof params.media === "string" || typeof params.mediaUrl === "string";

  const requiredByAction: Record<string, string[]> = {
    "send-audio": ["chatId", "audio"],
    "send-voice": ["chatId", "voice"],
    "send-animation": ["chatId", "animation"],
    delete: ["chatId", "messageId"],
    "answer-callback-query": ["callbackQueryId"],
    "get-file": ["fileId"],
    "set-my-commands": ["commands"],
    ban: ["chatId", "userId"],
    unban: ["chatId", "userId"],
    mute: ["chatId", "userId"],
    unmute: ["chatId", "userId"],
    kick: ["chatId", "userId"],
    "set-chat-title": ["chatId", "title"],
    "set-chat-description": ["chatId", "description"],
    "get-chat-admins": ["chatId"],
    "get-chat-member": ["chatId", "userId"],
    "get-chat-member-count": ["chatId"],
    "create-post": ["content"],
    "comment-post": ["dynamicId", "content"],
    "like-post": ["dynamicId"],
    "share-post": ["dynamicId"],
    "search-posts": ["keyword"],
    "get-wallet-address": ["userId"],
    "create-club": ["name"],
    "post-to-club": ["clubId", "content"],
    "update-club": ["clubId"],
    "set-name": ["name"],
    "set-description": ["description"],
    "set-wallet-address": ["walletAddress"],
    "set-profile": ["profileSource"],
  };

  if (action === "send") {
    const hasTarget = typeof params.to === "string" || typeof params.chatId === "string";
    if (!hasTarget) {
      return "missing required params for send: to/chatId";
    }
    if (!hasText && !hasMedia) {
      return "missing required params for send: message/text/media";
    }
    return null;
  }

  if (action === "set-my-commands") {
    const commands = params.commands;
    const isEmptyArray = Array.isArray(commands) && commands.length === 0;
    const isEmptyString = typeof commands === "string" && commands.trim().length === 0;
    if (commands === undefined || commands === null || isEmptyArray || isEmptyString) {
      return "missing required params for set-my-commands: commands";
    }
  }

  if (action === "post-to-club") {
    const hasClubId = params.clubId !== undefined && params.clubId !== null;
    const hasContent = typeof params.content === "string" && params.content.trim().length > 0;
    if (!hasClubId && hasContent) {
      return (
        "missing required params for post-to-club: clubId " +
        "(hint: for normal feed posts, use action=create-post)"
      );
    }
  }

  const required = requiredByAction[action];
  if (!required || required.length === 0) {
    return null;
  }

  const missing = required.filter((key) => {
    const value = params[key];
    if (typeof value === "string") {
      return value.trim().length === 0;
    }
    return value === undefined || value === null;
  });
  if (missing.length === 0) {
    return null;
  }
  return `missing required params for ${action}: ${missing.join(", ")}`;
}

function normalizeActionParams(action: string, raw: Record<string, any>): Record<string, any> {
  const params = { ...(raw ?? {}) };

  const text = pickFirst(params, ["message", "text"]);
  const media = pickFirst(params, ["mediaUrl", "media_url", "media"]);
  const audio = pickFirst(params, ["audio", "audio_url", "mediaUrl", "media_url", "media"]);
  const voice = pickFirst(params, ["voice", "voice_url", "mediaUrl", "media_url", "media"]);
  const animation = pickFirst(params, [
    "animation",
    "animation_url",
    "mediaUrl",
    "media_url",
    "media",
  ]);
  const chat = pickFirst(params, ["chatId", "chat_id", "chat", "to"]);
  const user = pickFirst(params, ["userId", "user_id"]);
  const messageId = pickFirst(params, ["messageId", "message_id"]);
  const callbackQueryId = pickFirst(params, ["callbackQueryId", "callback_query_id"]);
  const fileId = pickFirst(params, ["fileId", "file_id"]);
  const commands = pickFirst(params, ["commands", "commands_json"]);
  const languageCode = pickFirst(params, ["languageCode", "language_code"]);
  const offset = pickFirst(params, ["offset"]);
  const limit = pickFirst(params, ["limit"]);
  const timeout = pickFirst(params, ["timeout"]);
  const url = pickFirst(params, ["url", "webhookUrl", "webhook_url"]);
  const dynamicId = pickFirst(params, ["dynamicId", "dynamic_id"]);
  const clubId = pickFirst(params, ["clubId", "club_id"]);
  const page = pickFirst(params, ["page"]);
  const pageSize = pickFirst(params, ["pageSize", "page_size"]);
  const walletAddress = pickFirst(params, ["walletAddress", "wallet_address"]);
  const profileSource = pickFirst(params, ["profileSource", "profile_source"]);
  const replyTo = pickFirst(params, ["replyTo", "reply_to_message_id"]);
  const showAlert = pickFirst(params, ["showAlert", "show_alert"]);
  const description = pickFirst(params, ["description", "desc"]);
  const desc = pickFirst(params, ["desc", "description"]);

  if (chat !== undefined) {
    const normalizedChatId = normalizeChatId(chat);
    params.chatId = normalizedChatId;
    params.to = normalizedChatId;
  }
  if (user !== undefined) {
    params.userId = String(user).trim();
  }
  if (messageId !== undefined) {
    params.messageId = String(messageId).trim();
  }
  if (callbackQueryId !== undefined) {
    params.callbackQueryId = String(callbackQueryId).trim();
  }
  if (fileId !== undefined) {
    params.fileId = String(fileId).trim();
  }
  if (commands !== undefined) {
    params.commands = commands;
  }
  if (languageCode !== undefined) {
    params.languageCode = String(languageCode).trim();
  }
  if (offset !== undefined) {
    params.offset = toNumberIfPossible(offset);
  }
  if (limit !== undefined) {
    params.limit = toNumberIfPossible(limit);
  }
  if (timeout !== undefined) {
    params.timeout = toNumberIfPossible(timeout);
  }
  if (url !== undefined) {
    params.url = String(url).trim();
  }
  if (dynamicId !== undefined) {
    params.dynamicId = toNumberIfPossible(dynamicId);
  }
  if (clubId !== undefined) {
    params.clubId = toNumberIfPossible(clubId);
  }
  if (page !== undefined) {
    params.page = toNumberIfPossible(page);
  }
  if (pageSize !== undefined) {
    params.pageSize = toNumberIfPossible(pageSize);
  }
  if (walletAddress !== undefined) {
    params.walletAddress = String(walletAddress).trim();
  }
  if (profileSource !== undefined) {
    params.profileSource = profileSource;
  }
  if (replyTo !== undefined) {
    params.replyTo = String(replyTo).trim();
  }
  if (showAlert !== undefined) {
    params.showAlert = toBoolean(showAlert);
  }
  if (media !== undefined) {
    params.mediaUrl = String(media).trim();
    params.media = String(media).trim();
  }
  if (audio !== undefined) {
    params.audio = String(audio).trim();
  }
  if (voice !== undefined) {
    params.voice = String(voice).trim();
  }
  if (animation !== undefined) {
    params.animation = String(animation).trim();
  }
  if (text !== undefined) {
    params.message = String(text);
    params.text = String(text);
  }
  if (description !== undefined) {
    params.description = String(description);
  }
  if (desc !== undefined) {
    params.desc = String(desc);
  }

  return params;
}

function pickFirst(obj: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null) {
      if (typeof value !== "string" || value.trim().length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function normalizeChatId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^chat:/i, "");
}

function toNumberIfPossible(value: unknown): any {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return value;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return Boolean(value);
}

async function wrap(promise: Promise<any>): Promise<ActionResult> {
  try {
    const resp = await promise;
    if (resp.ok) {
      return { ok: true, result: resp.result };
    }
    return { ok: false, error: resp.description ?? "request failed" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
