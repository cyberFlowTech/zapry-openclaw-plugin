import { ZapryApiClient } from "./api-client.js";
import type { ResolvedZapryAccount } from "./types.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join as joinPath, resolve as resolvePath } from "node:path";

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
  generateaudio: "generate-audio",
  renderaudio: "generate-audio",
  ttsaudio: "generate-audio",
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
  getchatmembers: "get-chat-members",
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
  deletepost: "delete-post",
  commentpost: "comment-post",
  likepost: "like-post",
  sharepost: "share-post",

  getmyclubs: "get-my-clubs",
  createclub: "create-club",
  updateclub: "update-club",
};

type SendMediaAction =
  | "send-photo"
  | "send-video"
  | "send-document"
  | "send-audio"
  | "send-voice"
  | "send-animation";

type GenerateAudioMode = "auto" | "tts" | "render";

type GeneratedAudioArtifact = {
  mode: Exclude<GenerateAudioMode, "auto">;
  buffer: Buffer;
  mimeType: "audio/mpeg" | "audio/wav";
  fileName: string;
  durationSeconds: number;
};

const DEFAULT_GENERATED_AUDIO_DURATION_SECONDS = 12;
const MIN_GENERATED_AUDIO_DURATION_SECONDS = 2;
const MAX_GENERATED_AUDIO_DURATION_SECONDS = 30;
const DEFAULT_GENERATE_AUDIO_FALLBACK_TEXT =
  "抱歉，我刚刚生成音频失败了。请换个描述重试，或让我先发文字版本。";

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
    case "generate-audio":
      return handleGenerateAudioAction(client, normalized);
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
    case "get-chat-members":
      return handleGetChatMembersAction(client, normalized);
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
    case "create-post": {
      const resolvedImages = await materializeCreatePostImages(normalized.images);
      const imageErr = validateCreatePostImageSources(resolvedImages);
      if (imageErr) {
        return { ok: false, error: imageErr };
      }
      return wrap(client.createPost(normalized.content, resolvedImages));
    }
    case "delete-post":
      return wrap(client.deletePost(normalized.dynamic_id));
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

async function materializeCreatePostImages(images: unknown): Promise<string[] | undefined> {
  if (!Array.isArray(images)) {
    return undefined;
  }
  const resolved: string[] = [];
  for (const item of images) {
    if (!isNonEmptyString(item)) {
      continue;
    }
    const source = String(item).trim();
    const materialized = await materializeSendMediaSource(source);
    resolved.push(materialized);
  }
  return resolved;
}

function validateCreatePostImageSources(images: string[] | undefined): string | null {
  if (!images || images.length === 0) {
    return null;
  }
  for (let idx = 0; idx < images.length; idx += 1) {
    const mediaErr = validateMediaSource(images[idx], `images[${idx}]`);
    if (mediaErr) {
      return (
        `invalid create-post images: ${mediaErr} ` +
        "(tip: provide local file path, data URI, or /_temp/media URL)"
      );
    }
  }
  return null;
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
    "generate-audio": ["chat_id"],
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
    "get-chat-members": ["chat_id"],
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
    "delete-post": ["dynamic_id"],
    "comment-post": ["dynamic_id", "content"],
    "like-post": ["dynamic_id"],
    "share-post": ["dynamic_id"],

    // Club
    "create-club": ["name"],
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
  const userId = pickFirst(params, [
    "user_id",
    "userId",
    "target_user_id",
    "targetUserId",
    "mentioned_user_id",
    "mentionedUserId",
    "reply_user_id",
    "replyUserId",
  ]);
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
  const prompt = pickFirst(params, ["prompt", "audio_prompt", "audioPrompt", "script"]);
  const audioMode = pickFirst(params, ["audio_mode", "audioMode", "generate_mode", "generateMode"]);
  const ttsVoice = pickFirst(params, ["tts_voice", "ttsVoice", "voice_name", "voiceName"]);
  const audioFormat = pickFirst(params, ["audio_format", "audioFormat", "format"]);
  const durationSeconds = pickFirst(params, ["duration_seconds", "durationSeconds", "duration"]);
  const fallbackText = pickFirst(params, ["fallback_text", "fallbackText", "error_fallback_text"]);

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
  if (prompt !== undefined) params.prompt = String(prompt);
  if (audioMode !== undefined) params.audio_mode = String(audioMode).trim();
  if (ttsVoice !== undefined) params.tts_voice = String(ttsVoice).trim();
  if (audioFormat !== undefined) params.audio_format = String(audioFormat).trim();
  if (durationSeconds !== undefined) params.duration_seconds = toNumberIfPossible(durationSeconds);
  if (fallbackText !== undefined) params.fallback_text = String(fallbackText).trim();

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

async function handleGetChatMembersAction(
  client: ZapryApiClient,
  params: Record<string, any>,
): Promise<ActionResult> {
  const response = await client.getChatMembers(params.chat_id, {
    page: params.page,
    pageSize: params.page_size,
    keyword: params.keyword,
  });
  if (response.ok) {
    return { ok: true, result: response.result };
  }

  const description = String(response.description ?? "request failed").trim() || "request failed";
  const loweredDescription = description.toLowerCase();
  const shouldFallbackToAdmins =
    response.error_code === 404 ||
    loweredDescription.includes("not found") ||
    loweredDescription.includes("404");
  if (!shouldFallbackToAdmins) {
    return { ok: false, error: description };
  }

  const fallbackResponse = await client.getChatAdministrators(params.chat_id);
  if (!fallbackResponse.ok) {
    return { ok: false, error: String(fallbackResponse.description ?? description) };
  }
  return {
    ok: true,
    result: normalizeChatMembersFallbackResult(fallbackResponse.result, {
      chatId: params.chat_id,
      page: params.page,
      pageSize: params.page_size,
      keyword: params.keyword,
    }),
  };
}

function normalizeChatMembersFallbackResult(
  payload: unknown,
  options: {
    chatId: string;
    page?: unknown;
    pageSize?: unknown;
    keyword?: unknown;
  },
): Record<string, unknown> {
  const page = parsePositiveInteger(options.page, 1);
  const pageSize = Math.min(200, parsePositiveInteger(options.pageSize, 50));
  const keyword = isNonEmptyString(options.keyword) ? options.keyword.trim() : "";
  const keywordLower = keyword.toLowerCase();
  const groupRecord = resolveGroupRecord(payload, options.chatId);
  if (!groupRecord) {
    return {
      chat_id: normalizeResultChatId(options.chatId),
      keyword,
      page,
      page_size: pageSize,
      total: 0,
      items: [],
    };
  }

  const ownerUserId = toNonZeroString(groupRecord.UserId ?? groupRecord.user_id);
  const managerIdsRaw = Array.isArray(groupRecord.Manages)
    ? groupRecord.Manages
    : Array.isArray(groupRecord.manages)
      ? groupRecord.manages
      : [];
  const managerIds = new Set<string>(
    managerIdsRaw
      .map((value) => toNonZeroString(value))
      .filter((value): value is string => Boolean(value)),
  );

  const membersRecord = asObjectRecord(
    asObjectRecord(groupRecord.Members)?.Member ??
      asObjectRecord(groupRecord.Members)?.member ??
      asObjectRecord(groupRecord.members)?.Member ??
      asObjectRecord(groupRecord.members)?.member,
  );

  const items: Array<Record<string, unknown>> = [];
  const seenUserIds = new Set<string>();

  for (const [rawUserId, rawMember] of Object.entries(membersRecord ?? {})) {
    const member = asObjectRecord(rawMember);
    if (!member) {
      continue;
    }
    const userId =
      toNonZeroString(rawUserId) ??
      toNonZeroString(member.user_id ?? member.userId ?? member.uid ?? member.Id ?? member.id);
    if (!userId) {
      continue;
    }
    const nick = toOptionalString(member.Nick ?? member.nick ?? member.name);
    const groupNick = toOptionalString(
      member.Gnick ?? member.gnick ?? member.group_nick ?? member.groupNick,
    );
    const displayName = groupNick ?? nick ?? `用户(${userId})`;
    const searchable = `${userId} ${displayName} ${groupNick ?? ""} ${nick ?? ""}`.toLowerCase();
    if (keywordLower && !searchable.includes(keywordLower)) {
      continue;
    }
    const role = userId === ownerUserId ? "owner" : managerIds.has(userId) ? "admin" : "member";
    seenUserIds.add(userId);
    items.push({
      user_id: userId,
      display_name: displayName,
      group_nick: groupNick ?? "",
      nick: nick ?? "",
      avatar: toOptionalString(member.Avatar ?? member.avatar) ?? "",
      status: toOptionalNumber(member.Status ?? member.status) ?? 0,
      role,
      is_owner: role === "owner",
      is_admin: role === "owner" || role === "admin",
      joined_at: toOptionalNumber(member.Ctime ?? member.ctime ?? member.joined_at) ?? 0,
    });
  }

  const adminCandidates = Array.from(managerIds);
  if (ownerUserId) {
    adminCandidates.unshift(ownerUserId);
  }
  for (const userId of adminCandidates) {
    if (!userId || seenUserIds.has(userId)) {
      continue;
    }
    const displayName = `用户(${userId})`;
    const searchable = `${userId} ${displayName}`.toLowerCase();
    if (keywordLower && !searchable.includes(keywordLower)) {
      continue;
    }
    const role = userId === ownerUserId ? "owner" : "admin";
    items.push({
      user_id: userId,
      display_name: displayName,
      group_nick: "",
      nick: "",
      avatar: "",
      status: 0,
      role,
      is_owner: role === "owner",
      is_admin: true,
      joined_at: 0,
    });
  }

  items.sort((left, right) => {
    const leftOwner = left.is_owner === true ? 1 : 0;
    const rightOwner = right.is_owner === true ? 1 : 0;
    if (leftOwner !== rightOwner) {
      return rightOwner - leftOwner;
    }
    const leftAdmin = left.is_admin === true ? 1 : 0;
    const rightAdmin = right.is_admin === true ? 1 : 0;
    if (leftAdmin !== rightAdmin) {
      return rightAdmin - leftAdmin;
    }
    const leftName = String(left.display_name ?? "").toLowerCase();
    const rightName = String(right.display_name ?? "").toLowerCase();
    if (leftName !== rightName) {
      return leftName.localeCompare(rightName);
    }
    return String(left.user_id ?? "").localeCompare(String(right.user_id ?? ""));
  });

  const total = items.length;
  const start = Math.min(Math.max(0, (page - 1) * pageSize), total);
  const end = Math.min(start + pageSize, total);
  return {
    chat_id: normalizeResultChatId(options.chatId),
    keyword,
    page,
    page_size: pageSize,
    total,
    items: items.slice(start, end),
  };
}

function resolveGroupRecord(payload: unknown, chatId: string): Record<string, unknown> | null {
  const root = asObjectRecord(payload);
  if (!root) {
    return null;
  }
  const normalizedChatId = normalizeResultChatId(chatId);
  const mapId = normalizedChatId.replace(/^g_/i, "");
  const byChatId = asObjectRecord(root[normalizedChatId]);
  if (byChatId) {
    return byChatId;
  }
  const byMapId = asObjectRecord(root[mapId]);
  if (byMapId) {
    return byMapId;
  }
  for (const value of Object.values(root)) {
    const record = asObjectRecord(value);
    if (record) {
      return record;
    }
  }
  return null;
}

function normalizeResultChatId(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("g_")) {
    return normalized;
  }
  return normalized.startsWith("chat:") ? normalized.slice(5) : normalized;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toNonZeroString(value: unknown): string | undefined {
  const normalized = toOptionalString(value);
  if (!normalized || normalized === "0") {
    return undefined;
  }
  return normalized;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = toOptionalNumber(value);
  if (!parsed || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

async function handleGenerateAudioAction(
  client: ZapryApiClient,
  params: Record<string, any>,
): Promise<ActionResult> {
  const chatId = String(params.chat_id ?? "").trim();
  if (!chatId) {
    return { ok: false, error: "missing required params for generate-audio: chat_id" };
  }

  const inputText = resolveGenerateAudioInputText(params);
  const requestedMode = normalizeGenerateAudioMode(params.audio_mode);
  const durationSeconds = resolveGenerateAudioDurationSeconds(params.duration_seconds);
  const fallbackText = isNonEmptyString(params.fallback_text)
    ? String(params.fallback_text).trim()
    : DEFAULT_GENERATE_AUDIO_FALLBACK_TEXT;
  const requestedFormat = normalizeGeneratedAudioFormat(params.audio_format);
  const ttsVoice = isNonEmptyString(params.tts_voice) ? String(params.tts_voice).trim() : undefined;

  try {
    const artifact = await generateAudioArtifact({
      mode: requestedMode,
      text: inputText,
      durationSeconds,
      format: requestedFormat,
      ttsVoice,
    });
    const mediaDataUri = `data:${artifact.mimeType};base64,${artifact.buffer.toString("base64")}`;
    const sendResp = await client.sendAudio(chatId, mediaDataUri);
    if (!sendResp.ok) {
      const error = sendResp.description ?? "sendAudio failed";
      await sendGenerateAudioFallback(client, chatId, fallbackText);
      return { ok: false, error: `generate-audio send failed: ${error}` };
    }
    return {
      ok: true,
      result: {
        ...(sendResp.result ?? {}),
        audio_generation: {
          mode: artifact.mode,
          file_name: artifact.fileName,
          mime_type: artifact.mimeType,
          duration_seconds: artifact.durationSeconds,
        },
      },
    };
  } catch (error) {
    await sendGenerateAudioFallback(client, chatId, fallbackText);
    return { ok: false, error: `generate-audio failed: ${String(error)}` };
  }
}

function resolveGenerateAudioInputText(params: Record<string, any>): string {
  const value = pickFirst(params, ["prompt", "text", "message", "script", "tts_text", "ttsText"]);
  if (!isNonEmptyString(value)) {
    return "";
  }
  const trimmed = String(value).trim();
  return trimmed.length > 800 ? trimmed.slice(0, 800) : trimmed;
}

function normalizeGenerateAudioMode(value: unknown): GenerateAudioMode {
  if (!isNonEmptyString(value)) {
    return "auto";
  }
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["tts", "speech", "read", "voice"].includes(normalized)) {
    return "tts";
  }
  if (["render", "ringtone", "music", "tone", "synth"].includes(normalized)) {
    return "render";
  }
  return "auto";
}

function normalizeGeneratedAudioFormat(value: unknown): "mp3" | "wav" {
  if (!isNonEmptyString(value)) {
    return "mp3";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "wav" || normalized === "wave") {
    return "wav";
  }
  return "mp3";
}

function resolveGenerateAudioDurationSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(numeric)) {
    return DEFAULT_GENERATED_AUDIO_DURATION_SECONDS;
  }
  return Math.max(
    MIN_GENERATED_AUDIO_DURATION_SECONDS,
    Math.min(MAX_GENERATED_AUDIO_DURATION_SECONDS, Math.floor(numeric)),
  );
}

function looksLikeSpeechSynthesisIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "朗读",
    "念一下",
    "播报",
    "配音",
    "旁白",
    "转语音",
    "读出来",
    "tts",
    "read aloud",
    "speech",
    "narration",
  ].some((token) => normalized.includes(token));
}

function looksLikeMusicRenderIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "铃声",
    "音效",
    "背景音乐",
    "bgm",
    "纯音乐",
    "电子",
    "伴奏",
    "ringtone",
    "music",
    "beat",
    "melody",
  ].some((token) => normalized.includes(token));
}

function resolveAutoAudioMode(text: string): Exclude<GenerateAudioMode, "auto"> {
  if (text && looksLikeSpeechSynthesisIntent(text) && !looksLikeMusicRenderIntent(text)) {
    return "tts";
  }
  return "render";
}

async function generateAudioArtifact(params: {
  mode: GenerateAudioMode;
  text: string;
  durationSeconds: number;
  format: "mp3" | "wav";
  ttsVoice?: string;
}): Promise<GeneratedAudioArtifact> {
  const resolvedMode: Exclude<GenerateAudioMode, "auto"> =
    params.mode === "auto" ? resolveAutoAudioMode(params.text) : params.mode;

  if (resolvedMode === "tts") {
    if (!params.text) {
      throw new Error("tts mode requires prompt/text");
    }
    try {
      return await generateTtsAudioArtifact({
        text: params.text,
        format: params.format,
        ttsVoice: params.ttsVoice,
        durationSeconds: params.durationSeconds,
      });
    } catch (error) {
      if (params.mode !== "auto") {
        throw error;
      }
      // Auto mode falls back to render when local TTS command is unavailable.
      return generateRenderedAudioArtifact({
        text: params.text,
        durationSeconds: params.durationSeconds,
        format: params.format,
      });
    }
  }

  return generateRenderedAudioArtifact({
    text: params.text,
    durationSeconds: params.durationSeconds,
    format: params.format,
  });
}

async function generateTtsAudioArtifact(params: {
  text: string;
  format: "mp3" | "wav";
  ttsVoice?: string;
  durationSeconds: number;
}): Promise<GeneratedAudioArtifact> {
  if (process.platform !== "darwin") {
    throw new Error("local TTS is only available on darwin");
  }

  const tmpDir = await mkdtemp(joinPath(os.tmpdir(), "zapry-generate-audio-tts-"));
  const aiffPath = joinPath(tmpDir, "speech.aiff");
  const wavPath = joinPath(tmpDir, "speech.wav");
  const mp3Path = joinPath(tmpDir, "speech.mp3");

  try {
    const sayArgs = ["-o", aiffPath];
    if (params.ttsVoice) {
      sayArgs.push("-v", params.ttsVoice);
    }
    sayArgs.push(params.text);
    await runProcessWithTimeout("say", sayArgs, 25000);

    await runProcessWithTimeout(
      "ffmpeg",
      ["-y", "-i", aiffPath, "-vn", "-ac", "1", "-ar", "24000", wavPath],
      25000,
    );

    if (params.format === "wav") {
      const buffer = await readFile(wavPath);
      return {
        mode: "tts",
        buffer,
        mimeType: "audio/wav",
        fileName: "tts-audio.wav",
        durationSeconds: params.durationSeconds,
      };
    }

    await runProcessWithTimeout(
      "ffmpeg",
      ["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "96k", mp3Path],
      25000,
    );
    const buffer = await readFile(mp3Path);
    return {
      mode: "tts",
      buffer,
      mimeType: "audio/mpeg",
      fileName: "tts-audio.mp3",
      durationSeconds: params.durationSeconds,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function generateRenderedAudioArtifact(params: {
  text: string;
  durationSeconds: number;
  format: "mp3" | "wav";
}): Promise<GeneratedAudioArtifact> {
  const wavBuffer = synthesizeRingtoneWavBuffer(params.text, params.durationSeconds);
  if (params.format === "wav") {
    return {
      mode: "render",
      buffer: wavBuffer,
      mimeType: "audio/wav",
      fileName: "generated-ringtone.wav",
      durationSeconds: params.durationSeconds,
    };
  }

  try {
    const mp3Buffer = await transcodeWavToMp3Buffer(wavBuffer);
    return {
      mode: "render",
      buffer: mp3Buffer,
      mimeType: "audio/mpeg",
      fileName: "generated-ringtone.mp3",
      durationSeconds: params.durationSeconds,
    };
  } catch {
    return {
      mode: "render",
      buffer: wavBuffer,
      mimeType: "audio/wav",
      fileName: "generated-ringtone.wav",
      durationSeconds: params.durationSeconds,
    };
  }
}

function synthesizeRingtoneWavBuffer(text: string, durationSeconds: number): Buffer {
  const sampleRate = 24000;
  const totalSamples = Math.max(
    sampleRate * MIN_GENERATED_AUDIO_DURATION_SECONDS,
    Math.floor(durationSeconds * sampleRate),
  );
  const pcm = new Int16Array(totalSamples);
  const seed = createHash("sha256").update(text || "zapry-generated-ringtone").digest();

  const highPitch = /高|清脆|明亮|bright|high/i.test(text);
  const lowPitch = /低沉|厚重|dark|low/i.test(text);
  const fastTempo = /快|急促|fast|upbeat/i.test(text);
  const slowTempo = /慢|舒缓|slow|calm/i.test(text);
  const beatDurationSec = fastTempo ? 0.18 : slowTempo ? 0.32 : 0.24;
  const beatSamples = Math.max(1, Math.floor(beatDurationSec * sampleRate));

  const notePool = lowPitch
    ? [174.61, 196.0, 220.0, 261.63, 293.66, 329.63, 349.23]
    : highPitch
      ? [392.0, 440.0, 523.25, 659.25, 783.99, 880.0, 987.77]
      : [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 659.25, 783.99];
  const melodyLength = 16;
  const melody = Array.from({ length: melodyLength }, (_, idx) => {
    const bucket = seed[idx % seed.length] ?? idx;
    return notePool[bucket % notePool.length];
  });

  const attackSamples = Math.max(1, Math.floor(sampleRate * 0.01));
  const releaseSamples = Math.max(1, Math.floor(sampleRate * 0.06));
  const masterFadeSamples = Math.min(Math.floor(sampleRate * 0.2), Math.floor(totalSamples / 8));

  for (let i = 0; i < totalSamples; i += 1) {
    const stepIndex = Math.floor(i / beatSamples) % melody.length;
    const stepOffset = i % beatSamples;
    const baseFreq = melody[stepIndex];
    const t = i / sampleRate;

    let envelope = 1;
    if (stepOffset < attackSamples) {
      envelope = stepOffset / attackSamples;
    } else {
      const remain = beatSamples - stepOffset;
      if (remain < releaseSamples) {
        envelope = Math.max(0, remain / releaseSamples);
      }
    }
    const gate = stepOffset < beatSamples * 0.7 ? 1 : 0.35;

    const carrier = Math.sin(2 * Math.PI * baseFreq * t);
    const harmonic2 = 0.34 * Math.sin(2 * Math.PI * baseFreq * 2 * t + 0.23);
    const harmonic3 = 0.17 * Math.sin(2 * Math.PI * baseFreq * 3 * t + 1.1);
    const sub = 0.2 * Math.sin(2 * Math.PI * Math.max(60, baseFreq / 2) * t);
    const pulse = stepIndex % 4 === 0
      ? 0.14 * Math.sin(2 * Math.PI * 120 * t) * Math.exp(-stepOffset / (sampleRate * 0.12))
      : 0;

    let sample =
      (carrier * 0.62 + harmonic2 + harmonic3 + sub) *
        envelope *
        gate +
      pulse;

    if (i < masterFadeSamples) {
      sample *= i / masterFadeSamples;
    } else if (i > totalSamples - masterFadeSamples) {
      sample *= (totalSamples - i) / masterFadeSamples;
    }

    const clamped = Math.max(-1, Math.min(1, sample));
    pcm[i] = Math.round(clamped * 32767);
  }

  return encodePcm16MonoWav(pcm, sampleRate);
}

function encodePcm16MonoWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buffer;
}

async function transcodeWavToMp3Buffer(wavBuffer: Buffer): Promise<Buffer> {
  const tmpDir = await mkdtemp(joinPath(os.tmpdir(), "zapry-generate-audio-render-"));
  const inputPath = joinPath(tmpDir, "input.wav");
  const outputPath = joinPath(tmpDir, "output.mp3");
  try {
    await writeFile(inputPath, wavBuffer);
    await runProcessWithTimeout(
      "ffmpeg",
      ["-y", "-i", inputPath, "-codec:a", "libmp3lame", "-b:a", "96k", outputPath],
      25000,
    );
    return await readFile(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runProcessWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} failed (${code}): ${stderr.trim() || "no stderr"}`));
      }
    });
  });
}

async function sendGenerateAudioFallback(
  client: ZapryApiClient,
  chatId: string,
  fallbackText: string,
): Promise<void> {
  if (!chatId || !fallbackText.trim()) {
    return;
  }
  try {
    await client.sendMessage(chatId, fallbackText.trim());
  } catch {
    // best effort only
  }
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
