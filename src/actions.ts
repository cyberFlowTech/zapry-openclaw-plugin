import { ZapryApiClient } from "./api-client.js";
import type { ResolvedZapryAccount } from "./types.js";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

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

const ACTION_ALIASES: Record<string, string> = {
  send: "send",
  sendmessage: "send-message",
  sendphoto: "send-photo",
  sendvideo: "send-video",
  senddocument: "send-document",
  sendaudio: "send-audio",
  sendvoice: "send-voice",
  sendanimation: "send-animation",
  deletemessage: "delete-message",
  answercallbackquery: "answer-callback-query",

  getupdates: "get-updates",
  getfile: "get-file",
  setwebhook: "set-webhook",
  getwebhookinfo: "get-webhook-info",
  deletewebhook: "delete-webhook",
  webhookstoken: "webhooks-token",

  getmygroups: "get-my-groups",
  getmychats: "get-my-chats",
  getchatmember: "get-chat-member",
  getchatmembercount: "get-chat-member-count",
  getchatmemberscount: "get-chat-member-count",
  getchatadministrators: "get-chat-administrators",
  getchatadmins: "get-chat-administrators",
  mutechatmember: "mute-chat-member",
  kickchatmember: "kick-chat-member",
  setchattitle: "set-chat-title",
  setchatdescription: "set-chat-description",

  getme: "get-me",
  getuserprofilephotos: "get-user-profile-photos",
  setmywalletaddress: "set-my-wallet-address",
  setmyfriendverify: "set-my-friend-verify",
  getmycontacts: "get-my-contacts",
  getmyfriendrequests: "get-my-friend-requests",
  acceptfriendrequest: "accept-friend-request",
  rejectfriendrequest: "reject-friend-request",
  addfriend: "add-friend",
  deletefriend: "delete-friend",
  setmysoul: "set-my-soul",
  getmysoul: "get-my-soul",
  setmyskills: "set-my-skills",
  getmyskills: "get-my-skills",
  getmyprofile: "get-my-profile",
  setmyname: "set-my-name",
  setmydescription: "set-my-description",

  gettrendingposts: "get-trending-posts",
  getlatestposts: "get-latest-posts",
  getmyposts: "get-my-posts",
  searchposts: "search-posts",
  createpost: "create-post",
  commentpost: "comment-post",
  likepost: "like-post",
  sharepost: "share-post",

  getmyclubs: "get-my-clubs",
  createclub: "create-club",
  posttoclub: "post-to-club",
  updateclub: "update-club",
};

type SendMediaAction =
  | "send-photo"
  | "send-video"
  | "send-document"
  | "send-audio"
  | "send-voice"
  | "send-animation";

export async function handleZapryAction(ctx: ActionContext): Promise<ActionResult> {
  const { action, account, params } = ctx;
  const normalizedAction = normalizeActionName(action);
  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
  const normalized = normalizeActionParams(normalizedAction, params);
  const requiredError = validateRequiredParams(normalizedAction, normalized);
  if (requiredError) {
    return { ok: false, error: requiredError };
  }

  switch (normalizedAction) {
    // ── Messaging ──
    case "send":
      return handleCoreSendCompat(client, normalized);
    case "send-message":
      return wrap(
        client.sendMessage(normalized.chat_id, normalized.text, {
          replyToMessageId: normalized.reply_to_message_id,
          messageThreadId: normalized.message_thread_id,
          replyMarkup: normalized.reply_markup,
        }),
      );
    case "send-photo":
      return wrap(client.sendPhoto(normalized.chat_id, normalized.photo));
    case "send-video":
      return wrap(client.sendVideo(normalized.chat_id, normalized.video));
    case "send-document":
      return wrap(client.sendDocument(normalized.chat_id, normalized.document));
    case "send-audio":
      return wrap(client.sendAudio(normalized.chat_id, normalized.audio));
    case "send-voice":
      return wrap(client.sendVoice(normalized.chat_id, normalized.voice));
    case "send-animation":
      return wrap(client.sendAnimation(normalized.chat_id, normalized.animation));
    case "delete-message":
      return wrap(client.deleteMessage(normalized.chat_id, normalized.message_id));
    case "answer-callback-query":
      return wrap(
        client.answerCallbackQuery(normalized.chat_id, normalized.callback_query_id, {
          text: normalized.text,
          showAlert: normalized.show_alert === true,
        }),
      );

    // ── Receive / Webhook ──
    case "get-updates":
      return wrap(client.getUpdates(normalized.offset, normalized.limit, normalized.timeout));
    case "get-file":
      return wrap(client.getFile(normalized.file_id));
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

    // ── Skills ──
    case "set-my-soul":
      return wrap(
        client.setMySoul({
          soulMd: normalized.soulMd,
          version: normalized.version,
          source: normalized.source,
          agentKey: normalized.agentKey,
        }),
      );
    case "get-my-soul":
      return wrap(client.getMySoul());
    case "set-my-skills":
      return wrap(
        client.setMySkills({
          skills: normalized.skills,
          version: normalized.version,
          source: normalized.source,
          agentKey: normalized.agentKey,
        }),
      );
    case "get-my-skills":
      return wrap(client.getMySkills());
    case "get-my-profile":
      return wrap(client.getMyProfile());

    // ── Group Query & Moderation ──
    case "get-my-groups":
      return wrap(client.getMyGroups(normalized.page, normalized.page_size));
    case "get-my-chats":
      return wrap(client.getMyChats(normalized.page, normalized.page_size));
    case "get-chat-member":
      return wrap(client.getChatMember(normalized.chat_id, normalized.user_id));
    case "get-chat-member-count":
      return wrap(client.getChatMemberCount(normalized.chat_id));
    case "get-chat-administrators":
      return wrap(client.getChatAdministrators(normalized.chat_id));
    case "mute-chat-member":
      return wrap(client.muteChatMember(normalized.chat_id, normalized.user_id, normalized.mute));
    case "kick-chat-member":
      return wrap(client.kickChatMember(normalized.chat_id, normalized.user_id));
    case "set-chat-title":
      return wrap(client.setChatTitle(normalized.chat_id, normalized.title));
    case "set-chat-description":
      return wrap(client.setChatDescription(normalized.chat_id, normalized.description));

    // ── Feed ──
    case "get-trending-posts":
      return wrap(client.getTrendingPosts(normalized.page, normalized.page_size));
    case "get-latest-posts":
      return wrap(client.getLatestPosts(normalized.page, normalized.page_size));
    case "get-my-posts":
      return wrap(client.getMyPosts(normalized.page, normalized.page_size));
    case "search-posts":
      return wrap(client.searchPosts(normalized.keyword, normalized.page, normalized.page_size));
    case "create-post":
      return wrap(client.createPost(normalized.content, normalized.images));
    case "comment-post":
      return wrap(client.commentPost(normalized.dynamic_id, normalized.content));
    case "like-post":
      return wrap(client.likePost(normalized.dynamic_id));
    case "share-post":
      return wrap(client.sharePost(normalized.dynamic_id));

    // ── Clubs ──
    case "get-my-clubs":
      return wrap(client.getMyClubs(normalized.page, normalized.page_size));
    case "create-club":
      return wrap(client.createClub(normalized.name, normalized.desc, normalized.avatar));
    case "post-to-club":
      return wrap(client.postToClub(normalized.club_id, normalized.content, normalized.images));
    case "update-club":
      return wrap(
        client.updateClub(normalized.club_id, normalized.name, normalized.desc, normalized.avatar),
      );

    // ── Bot Self-Management ──
    case "get-me":
      return wrap(client.getMe());
    case "get-user-profile-photos":
      return wrap(client.getUserProfilePhotos(normalized.user_id));
    case "set-my-wallet-address":
      return wrap(client.setMyWalletAddress(normalized.wallet_address));
    case "set-my-friend-verify":
      return wrap(client.setMyFriendVerify(normalized.need_verify));
    case "get-my-contacts":
      return wrap(client.getMyContacts(normalized.page, normalized.page_size));
    case "get-my-friend-requests":
      return wrap(client.getMyFriendRequests(normalized.pending_only));
    case "accept-friend-request":
      return wrap(client.acceptFriendRequest(normalized.user_id));
    case "reject-friend-request":
      return wrap(client.rejectFriendRequest(normalized.user_id));
    case "add-friend":
      return wrap(client.addFriend(normalized.user_id, normalized.message, normalized.remark));
    case "delete-friend":
      return wrap(client.deleteFriend(normalized.user_id));
    case "set-my-name":
      return wrap(client.setMyName(normalized.name));
    case "set-my-description":
      return wrap(client.setMyDescription(normalized.description));

    default:
      return { ok: false, error: `unknown zapry action: ${action}` };
  }
}

async function handleCoreSendCompat(
  client: ZapryApiClient,
  params: Record<string, any>,
): Promise<ActionResult> {
  if (!hasRequiredValue(params.chat_id)) {
    return { ok: false, error: "missing required params for send: chat_id" };
  }
  const chatId = String(params.chat_id).trim();
  const mediaSource = pickCoreSendMediaSource(params);
  if (mediaSource) {
    const resolvedMediaSource = await materializeSendMediaSource(mediaSource);
    const mediaAction = inferCoreSendMediaAction(resolvedMediaSource, params);
    const mediaField = mediaFieldNameForAction(mediaAction);
    const mediaErr = validateMediaSource(resolvedMediaSource, mediaField);
    if (mediaErr) {
      return { ok: false, error: mediaErr };
    }

    switch (mediaAction) {
      case "send-photo":
        return wrap(client.sendPhoto(chatId, resolvedMediaSource));
      case "send-video":
        return wrap(client.sendVideo(chatId, resolvedMediaSource));
      case "send-document":
        return wrap(client.sendDocument(chatId, resolvedMediaSource));
      case "send-audio":
        return wrap(client.sendAudio(chatId, resolvedMediaSource));
      case "send-voice":
        return wrap(client.sendVoice(chatId, resolvedMediaSource));
      case "send-animation":
        return wrap(client.sendAnimation(chatId, resolvedMediaSource));
    }
  }

  if (!hasRequiredValue(params.text)) {
    return { ok: false, error: "missing required params for send: text or media" };
  }

  return wrap(
    client.sendMessage(chatId, String(params.text), {
      replyToMessageId: params.reply_to_message_id,
      messageThreadId: params.message_thread_id,
      replyMarkup: params.reply_markup,
    }),
  );
}

function pickCoreSendMediaSource(params: Record<string, any>): string | null {
  const direct = pickFirst(params, [
    "photo",
    "video",
    "document",
    "audio",
    "voice",
    "animation",
    "media",
    "media_url",
    "mediaUrl",
  ]);
  if (isNonEmptyString(direct)) {
    return direct.trim();
  }

  const mediaUrls = pickFirst(params, ["media_urls", "mediaUrls"]);
  if (Array.isArray(mediaUrls)) {
    for (const item of mediaUrls) {
      if (isNonEmptyString(item)) {
        return item.trim();
      }
    }
  }

  return null;
}

async function materializeSendMediaSource(mediaSource: string): Promise<string> {
  const source = mediaSource.trim();
  if (
    /^data:[^,]+,.+/i.test(source) ||
    source.startsWith("/_temp/media/") ||
    /^https?:\/\/[^/\s]+\/_temp\/media\//i.test(source)
  ) {
    return source;
  }

  const localPath = toLocalMediaPath(source);
  if (!localPath) {
    return source;
  }

  try {
    const binary = await readFile(localPath);
    const mime = inferMimeTypeFromPath(localPath);
    return `data:${mime};base64,${binary.toString("base64")}`;
  } catch {
    return source;
  }
}

function toLocalMediaPath(source: string): string | null {
  if (!source) {
    return null;
  }
  if (/^https?:\/\//i.test(source) || source.startsWith("data:")) {
    return null;
  }
  if (source.startsWith("file://")) {
    try {
      const url = new URL(source);
      return decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  if (source.startsWith("/")) {
    return source;
  }
  return resolvePath(process.cwd(), source);
}

function inferMimeTypeFromPath(filePath: string): string {
  const lower = filePath.trim().toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".opus")) return "audio/opus";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function inferCoreSendMediaAction(
  mediaSource: string,
  params: Record<string, any>,
): SendMediaAction {
  const mediaType = normalizeMediaType(pickFirst(params, ["media_type", "mediaType", "type"]));
  if (mediaType) {
    return mediaType;
  }

  const source = mediaSource.trim().toLowerCase();
  const dataUriMatch = /^data:([^;,]+)[;,]/i.exec(source);
  if (dataUriMatch) {
    const mime = dataUriMatch[1];
    if (mime.startsWith("image/")) {
      return mime === "image/gif" ? "send-animation" : "send-photo";
    }
    if (mime.startsWith("video/")) {
      return "send-video";
    }
    if (mime.startsWith("audio/")) {
      if (/(ogg|opus|amr|x-m4a|mp4)/i.test(mime)) {
        return "send-voice";
      }
      return "send-audio";
    }
    return "send-document";
  }

  const cleanSource = source.split("?")[0].split("#")[0];
  const dotIndex = cleanSource.lastIndexOf(".");
  const ext = dotIndex >= 0 ? cleanSource.slice(dotIndex + 1) : "";
  if (["jpg", "jpeg", "png", "webp", "bmp", "heic", "heif"].includes(ext)) {
    return "send-photo";
  }
  if (["gif"].includes(ext)) {
    return "send-animation";
  }
  if (["mp4", "mov", "avi", "webm", "m4v", "mkv"].includes(ext)) {
    return "send-video";
  }
  if (["mp3", "aac", "wav", "flac", "m4b"].includes(ext)) {
    return "send-audio";
  }
  if (["opus", "ogg", "oga", "amr", "m4a"].includes(ext)) {
    return "send-voice";
  }
  return "send-document";
}

function normalizeMediaType(value: unknown): SendMediaAction | null {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const mediaType = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["image", "photo", "send-photo"].includes(mediaType)) {
    return "send-photo";
  }
  if (["video", "movie", "send-video"].includes(mediaType)) {
    return "send-video";
  }
  if (["file", "doc", "document", "send-document"].includes(mediaType)) {
    return "send-document";
  }
  if (["audio", "music", "send-audio"].includes(mediaType)) {
    return "send-audio";
  }
  if (["voice", "voice-note", "send-voice"].includes(mediaType)) {
    return "send-voice";
  }
  if (["animation", "gif", "send-animation"].includes(mediaType)) {
    return "send-animation";
  }
  return null;
}

function mediaFieldNameForAction(action: SendMediaAction): string {
  switch (action) {
    case "send-photo":
      return "photo";
    case "send-video":
      return "video";
    case "send-document":
      return "document";
    case "send-audio":
      return "audio";
    case "send-voice":
      return "voice";
    case "send-animation":
      return "animation";
  }
}

function validateRequiredParams(action: string, params: Record<string, any>): string | null {
  const mediaByAction: Partial<Record<string, string>> = {
    "send-photo": "photo",
    "send-video": "video",
    "send-document": "document",
    "send-audio": "audio",
    "send-voice": "voice",
    "send-animation": "animation",
  };

  const requiredByAction: Record<string, string[]> = {
    // Messaging
    "send-message": ["chat_id", "text"],
    "send-photo": ["chat_id", "photo"],
    "send-video": ["chat_id", "video"],
    "send-document": ["chat_id", "document"],
    "send-audio": ["chat_id", "audio"],
    "send-voice": ["chat_id", "voice"],
    "send-animation": ["chat_id", "animation"],
    "delete-message": ["chat_id", "message_id"],
    "answer-callback-query": ["chat_id", "callback_query_id"],

    // Receive / Webhook
    "get-file": ["file_id"],
    "set-webhook": ["url"],

    // Skills
    "set-my-soul": ["soulMd"],
    "set-my-skills": ["skills"],

    // Group query & moderation
    "get-chat-member": ["chat_id", "user_id"],
    "get-chat-member-count": ["chat_id"],
    "get-chat-administrators": ["chat_id"],
    "mute-chat-member": ["chat_id", "user_id", "mute"],
    "kick-chat-member": ["chat_id", "user_id"],
    "set-chat-title": ["chat_id", "title"],
    "set-chat-description": ["chat_id", "description"],

    // Agent self management
    "set-my-wallet-address": ["wallet_address"],
    "set-my-friend-verify": ["need_verify"],
    "accept-friend-request": ["user_id"],
    "reject-friend-request": ["user_id"],
    "add-friend": ["user_id"],
    "delete-friend": ["user_id"],
    "set-my-name": ["name"],
    "set-my-description": ["description"],

    // Feed
    "search-posts": ["keyword"],
    "create-post": ["content"],
    "comment-post": ["dynamic_id", "content"],
    "like-post": ["dynamic_id"],
    "share-post": ["dynamic_id"],

    // Club
    "create-club": ["name"],
    "post-to-club": ["club_id", "content"],
    "update-club": ["club_id"],
  };

  const required = requiredByAction[action];
  if (!required || required.length === 0) {
    return null;
  }

  const missing = required.filter((key) => !hasRequiredValue(params[key]));
  if (missing.length > 0) {
    return `missing required params for ${action}: ${missing.join(", ")}`;
  }

  const mediaKey = mediaByAction[action];
  if (mediaKey) {
    const mediaErr = validateMediaSource(params[mediaKey], mediaKey);
    if (mediaErr) {
      return mediaErr;
    }
  }

  if (action === "set-my-skills") {
    const skillsErr = validateSkillsPayload(params.skills);
    if (skillsErr) {
      return skillsErr;
    }
  }

  return null;
}

function validateMediaSource(value: unknown, fieldName: string): string | null {
  if (!isNonEmptyString(value)) {
    return `missing required params: ${fieldName}`;
  }
  const source = String(value).trim();
  if (/^data:[^,]+,.+/i.test(source)) {
    return null;
  }
  if (source.startsWith("/_temp/media/")) {
    return null;
  }
  if (/^https?:\/\/[^/\s]+\/_temp\/media\//i.test(source)) {
    return null;
  }
  return (
    `invalid ${fieldName}: only data URI or /_temp/media URL is supported by Zapry OpenAPI ` +
    "(external http(s) file URL is not accepted)"
  );
}

function validateSkillsPayload(skills: unknown): string | null {
  if (!Array.isArray(skills) || skills.length === 0) {
    return "invalid skills: non-empty array is required";
  }
  for (const [idx, skill] of skills.entries()) {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
      return `invalid skills[${idx}]: object is required`;
    }
    const item = skill as Record<string, unknown>;
    if (!isNonEmptyString(item.skillKey)) {
      return `invalid skills[${idx}].skillKey: non-empty string is required`;
    }
    if (!isNonEmptyString(item.content)) {
      return `invalid skills[${idx}].content: non-empty string is required`;
    }
  }
  return null;
}

function hasRequiredValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined && value !== null;
}

function normalizeActionName(action: string): string {
  const raw = String(action ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const hyphen = lower.replace(/[\s_]+/g, "-");
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return ACTION_ALIASES[lower] ?? ACTION_ALIASES[hyphen] ?? ACTION_ALIASES[compact] ?? hyphen;
}

function normalizeActionParams(action: string, raw: Record<string, any>): Record<string, any> {
  const params = { ...(raw ?? {}) };

  const chatId = pickFirst(params, ["chat_id", "chatId", "chat", "to"]);
  const userId = pickFirst(params, ["user_id", "userId"]);
  const messageId = pickFirst(params, ["message_id", "messageId"]);
  const callbackQueryId = pickFirst(params, ["callback_query_id", "callbackQueryId"]);
  const fileId = pickFirst(params, ["file_id", "fileId"]);
  const languageCode = pickFirst(params, ["language_code", "languageCode"]);
  const replyMarkup = pickFirst(params, ["reply_markup", "replyMarkup"]);
  const replyToMessageId = pickFirst(params, ["reply_to_message_id", "replyTo", "replyToMessageId"]);
  const messageThreadId = pickFirst(params, ["message_thread_id", "messageThreadId"]);
  const showAlert = pickFirst(params, ["show_alert", "showAlert"]);
  const mute = pickFirst(params, ["mute"]);
  const walletAddress = pickFirst(params, ["wallet_address", "walletAddress"]);
  const needVerify = pickFirst(params, ["need_verify", "needVerify", "friend_verify"]);
  const pendingOnly = pickFirst(params, ["pending_only", "pendingOnly"]);
  const pageSize = pickFirst(params, ["page_size", "pageSize"]);
  const dynamicId = pickFirst(params, ["dynamic_id", "dynamicId"]);
  const clubId = pickFirst(params, ["club_id", "clubId"]);
  const soulMd = pickFirst(params, ["soulMd", "soul_md"]);
  const agentKey = pickFirst(params, ["agentKey", "agent_key"]);
  const skills = pickFirst(params, ["skills"]);
  const images = pickFirst(params, ["images", "image", "image_url", "imageUrl"]);

  if (chatId !== undefined) params.chat_id = normalizeChatId(chatId);
  if (userId !== undefined) params.user_id = String(userId).trim();
  if (messageId !== undefined) params.message_id = String(messageId).trim();
  if (callbackQueryId !== undefined) params.callback_query_id = String(callbackQueryId).trim();
  if (fileId !== undefined) params.file_id = String(fileId).trim();
  if (languageCode !== undefined) params.language_code = String(languageCode).trim();
  if (replyMarkup !== undefined) params.reply_markup = replyMarkup;
  if (replyToMessageId !== undefined) params.reply_to_message_id = String(replyToMessageId).trim();
  if (messageThreadId !== undefined) params.message_thread_id = String(messageThreadId).trim();
  if (showAlert !== undefined) params.show_alert = toBoolean(showAlert);
  if (mute !== undefined) params.mute = toBoolean(mute);
  if (walletAddress !== undefined) params.wallet_address = String(walletAddress).trim();
  if (needVerify !== undefined) params.need_verify = toBoolean(needVerify);
  if (pendingOnly !== undefined) params.pending_only = toBoolean(pendingOnly);
  if (pageSize !== undefined) params.page_size = toNumberIfPossible(pageSize);
  if (dynamicId !== undefined) params.dynamic_id = toNumberIfPossible(dynamicId);
  if (clubId !== undefined) params.club_id = toNumberIfPossible(clubId);
  if (soulMd !== undefined) params.soulMd = String(soulMd);
  if (agentKey !== undefined) params.agentKey = String(agentKey).trim();

  const text = pickFirst(params, ["text", "message"]);
  if (text !== undefined) params.text = String(text);
  const content = pickFirst(params, ["content"]);
  if (content !== undefined) params.content = String(content).trim();

  const keyword = pickFirst(params, ["keyword", "q", "query"]);
  if (keyword !== undefined) params.keyword = String(keyword).trim();
  const title = pickFirst(params, ["title"]);
  if (title !== undefined) params.title = String(title).trim();
  const description = pickFirst(params, ["description"]);
  if (description !== undefined) params.description = String(description).trim();
  const name = pickFirst(params, ["name"]);
  if (name !== undefined) params.name = String(name).trim();
  const desc = pickFirst(params, ["desc"]);
  if (desc !== undefined) params.desc = String(desc).trim();
  const avatar = pickFirst(params, ["avatar"]);
  if (avatar !== undefined) params.avatar = String(avatar).trim();

  if (skills !== undefined) {
    if (Array.isArray(skills)) {
      params.skills = skills;
    } else if (typeof skills === "string") {
      try {
        params.skills = JSON.parse(skills);
      } catch {
        params.skills = skills;
      }
    } else {
      params.skills = skills;
    }
  }

  const source = pickFirst(params, ["source"]);
  if (source !== undefined) params.source = String(source).trim();
  const version = pickFirst(params, ["version"]);
  if (version !== undefined) params.version = String(version).trim();

  const offset = pickFirst(params, ["offset"]);
  if (offset !== undefined) params.offset = toNumberIfPossible(offset);
  const limit = pickFirst(params, ["limit"]);
  if (limit !== undefined) params.limit = toNumberIfPossible(limit);
  const timeout = pickFirst(params, ["timeout"]);
  if (timeout !== undefined) params.timeout = toNumberIfPossible(timeout);

  const page = pickFirst(params, ["page"]);
  if (page !== undefined) params.page = toNumberIfPossible(page);
  const url = pickFirst(params, ["url", "webhook_url", "webhookUrl"]);
  if (url !== undefined) params.url = String(url).trim();

  const photo = pickFirst(params, ["photo", "image", "image_url", "imageUrl"]);
  if (photo !== undefined) params.photo = String(photo).trim();
  const video = pickFirst(params, ["video"]);
  if (video !== undefined) params.video = String(video).trim();
  const document = pickFirst(params, ["document", "file", "file_url", "fileUrl"]);
  if (document !== undefined) params.document = String(document).trim();
  const audio = pickFirst(params, ["audio", "audio_url"]);
  if (audio !== undefined) params.audio = String(audio).trim();
  const voice = pickFirst(params, ["voice", "voice_url"]);
  if (voice !== undefined) params.voice = String(voice).trim();
  const animation = pickFirst(params, ["animation", "animation_url"]);
  if (animation !== undefined) params.animation = String(animation).trim();

  if (images !== undefined) {
    const normalizedImages = normalizeStringArray(images);
    if (normalizedImages) {
      params.images = normalizedImages;
    }
  }

  // For query-style actions, keep plain endpoint behavior and avoid over-coercion.
  if (action === "get-user-profile-photos" && params.user_id !== undefined) {
    params.user_id = String(params.user_id).trim();
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        // fall through to plain string handling
      }
    }
    if (trimmed.includes(",")) {
      return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    }
    return [trimmed];
  }
  return null;
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
