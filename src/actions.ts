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

  switch (action) {
    // ── Messaging ──
    case "send":
      return handleSend(client, params);
    case "delete":
      return wrap(client.deleteMessage(params.chatId, params.messageId));

    // ── Group Management ──
    case "ban":
      return wrap(client.banChatMember(params.chatId, params.userId));
    case "unban":
      return wrap(client.unbanChatMember(params.chatId, params.userId));
    case "mute":
      return wrap(client.restrictChatMember(params.chatId, params.userId, true));
    case "unmute":
      return wrap(client.restrictChatMember(params.chatId, params.userId, false));
    case "kick":
      return wrap(client.kickChatMember(params.chatId, params.userId));
    case "set-chat-title":
      return wrap(client.setChatTitle(params.chatId, params.title));
    case "set-chat-description":
      return wrap(client.setChatDescription(params.chatId, params.description));
    case "get-chat-admins":
      return wrap(client.getChatAdministrators(params.chatId));
    case "get-chat-member":
      return wrap(client.getChatMember(params.chatId, params.userId));
    case "get-chat-member-count":
      return wrap(client.getChatMemberCount(params.chatId));

    // ── Feed ──
    case "create-post":
      return wrap(client.createPost(params.content, params.images));
    case "comment-post":
      return wrap(client.commentPost(params.dynamicId, params.content));
    case "like-post":
      return wrap(client.likePost(params.dynamicId));
    case "share-post":
      return wrap(client.sharePost(params.dynamicId));

    // ── Discovery ──
    case "get-trending":
      return wrap(client.getTrendingPosts(params.page, params.pageSize));
    case "search-posts":
      return wrap(client.searchPosts(params.keyword, params.page, params.pageSize));
    case "get-communities":
      return wrap(client.getPublicCommunities(params.page, params.pageSize));

    // ── Clubs ──
    case "create-club":
      return wrap(client.createClub(params.name, params.desc, params.avatar));
    case "post-to-club":
      return wrap(client.postToClub(params.clubId, params.content, params.images));
    case "update-club":
      return wrap(client.updateClub(params.clubId, params.name, params.desc, params.avatar));

    // ── Bot Self-Management ──
    case "get-me":
      return wrap(client.getMe());
    case "set-name":
      return wrap(client.setMyName(params.name));
    case "set-description":
      return wrap(client.setMyDescription(params.description));
    case "set-wallet-address":
      return wrap(client.setMyWalletAddress(params.walletAddress));
    case "set-profile":
      return wrap(client.setMyProfile(params.profileSource));
    case "get-profile":
      return wrap(client.getMyProfile());

    default:
      return { ok: false, error: `unknown zapry action: ${action}` };
  }
}

async function handleSend(client: ZapryApiClient, params: Record<string, any>): Promise<ActionResult> {
  const chatId = (params.to ?? params.chatId ?? "").replace(/^chat:/i, "");
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
