import type {
  ZapryApiResponse,
  SetMyProfilePayload,
  SetMyProfileResponse,
  FeedListResponse,
  CreatePostResponse,
  ChatHistoryResponse,
  ZapryUpdate,
} from "./types.js";

type SetMySoulPayload = {
  soulMd: string;
  version?: string;
  source?: string;
  agentKey?: string;
};

type SetMySkillsPayload = {
  skills: Array<Record<string, unknown>>;
  version?: string;
  source?: string;
  agentKey?: string;
};

export type SendMessageCardPayload = {
  chatId: string;
  url: string;
  title: string;
  content?: string;
  text?: string;
  iconUrl?: string;
  imageUrl?: string;
  source?: string;
  openMode?: string;
  fallbackText?: string;
  extra?: Record<string, unknown>;
  replyToMessageId?: string;
  messageThreadId?: string;
  replyMarkup?: unknown;
};

export type CreateGroupChatPayload = {
  title: string;
  description?: string;
  avatar?: string;
  userIds?: string[];
  botIds?: string[];
};

export class ZapryApiClient {
  constructor(
    private baseUrl: string,
    private botToken: string,
    private options?: {
      defaultHeaders?: Record<string, string>;
    },
  ) {}

  private buildHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    return {
      ...(this.options?.defaultHeaders ?? {}),
      ...(extraHeaders ?? {}),
    };
  }

  getRequestHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    return this.buildHeaders(extraHeaders);
  }

  private async request<T = unknown>(opts: {
    methodPath: string;
    method: "GET" | "POST";
    body?: Record<string, unknown>;
  }): Promise<ZapryApiResponse<T>> {
    const { methodPath, method, body } = opts;
    const url = `${this.baseUrl}/${this.botToken}/${methodPath}`;
    const resp = await fetch(url, {
      method,
      headers: this.buildHeaders({ "Content-Type": "application/json" }),
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    if (!resp.ok) {
      let errorBody = "";
      try { errorBody = await resp.text(); } catch {}
      const errorJson = (() => { try { return JSON.parse(errorBody); } catch { return null; } })();
      const desc = errorJson?.description ?? errorBody.slice(0, 200) ?? resp.statusText;
      return {
        ok: false,
        error_code: resp.status,
        description: `HTTP ${resp.status} ${resp.statusText}${desc ? ` — ${desc}` : ""}`,
      };
    }
    return (await resp.json()) as ZapryApiResponse<T>;
  }

  private async post<T = unknown>(
    methodPath: string,
    body?: Record<string, unknown>,
  ): Promise<ZapryApiResponse<T>> {
    return this.request({ methodPath, method: "POST", body });
  }

  private async get<T = unknown>(methodPath: string): Promise<ZapryApiResponse<T>> {
    return this.request({ methodPath, method: "GET" });
  }

  // ── Messaging ──

  async sendMessage(
    chatId: string,
    text: string,
    opts?: {
      replyToMessageId?: string;
      messageThreadId?: string;
      replyMarkup?: unknown;
    },
  ) {
    return this.post("sendMessage", {
      chat_id: chatId,
      text,
      reply_to_message_id: opts?.replyToMessageId,
      message_thread_id: opts?.messageThreadId,
      reply_markup: opts?.replyMarkup,
    });
  }

	async sendMessageCard(payload: SendMessageCardPayload) {
		return this.post("sendMessageCard", {
      chat_id: payload.chatId,
      url: payload.url,
      title: payload.title,
      content: payload.content,
      text: payload.text,
      icon_url: payload.iconUrl,
      image_url: payload.imageUrl,
      source: payload.source,
      open_mode: payload.openMode,
      fallback_text: payload.fallbackText,
      options: {
        url: payload.url,
        title: payload.title,
        content: payload.content,
        text: payload.text,
        icon_url: payload.iconUrl,
        image_url: payload.imageUrl,
        source: payload.source,
        open_mode: payload.openMode,
        fallback_text: payload.fallbackText,
        extra: payload.extra,
      },
      reply_to_message_id: payload.replyToMessageId,
      message_thread_id: payload.messageThreadId,
      reply_markup: payload.replyMarkup,
    });
  }

  async sendPhoto(chatId: string, photo: string) {
    return this.post("sendPhoto", { chat_id: chatId, photo });
  }

  async sendVideo(chatId: string, video: string) {
    return this.post("sendVideo", { chat_id: chatId, video });
  }

  async sendDocument(chatId: string, document: string) {
    return this.post("sendDocument", { chat_id: chatId, document });
  }

  async sendAudio(chatId: string, audio: string) {
    return this.post("sendAudio", { chat_id: chatId, audio });
  }

  async sendVoice(chatId: string, voice: string) {
    return this.post("sendVoice", { chat_id: chatId, voice });
  }

  async sendAnimation(chatId: string, animation: string) {
    return this.post("sendAnimation", { chat_id: chatId, animation });
  }

  async sendChatAction(chatId: string, action: string) {
    return this.post("sendChatAction", { chat_id: chatId, action });
  }

  async deleteMessage(chatId: string, messageId: string) {
    return this.post("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  async answerCallbackQuery(
    chatId: string,
    callbackQueryId: string,
    opts?: {
      text?: string;
      showAlert?: boolean;
    },
  ) {
    return this.post("answerCallbackQuery", {
      chat_id: chatId,
      callback_query_id: callbackQueryId,
      text: opts?.text,
      show_alert: opts?.showAlert,
    });
  }

  // ── Receive / Webhook ──

  async getUpdates(offset?: number, limit?: number, timeout?: number): Promise<ZapryApiResponse<ZapryUpdate[]>> {
    return this.post("getUpdates", { offset, limit, timeout });
  }

  async getFile(fileId: string) {
    return this.post("getFile", { file_id: fileId });
  }

  async setWebhook(url: string) {
    return this.post("setWebhook", { url });
  }

  async getWebhookInfo() {
    return this.post("getWebhookInfo");
  }

  async deleteWebhook() {
    return this.post("deleteWebhook");
  }

  // ── Skills ──

  async setMySoul(payload: SetMySoulPayload) {
    return this.post("setMySoul", payload);
  }

  async getMySoul() {
    return this.get("getMySoul");
  }

  async setMySkills(payload: SetMySkillsPayload) {
    return this.post("setMySkills", payload);
  }

  async getMySkills() {
    return this.get("getMySkills");
  }

  async getMyProfile() {
    return this.post("getMyProfile");
  }

  async setMyProfile(payload: SetMyProfilePayload): Promise<ZapryApiResponse<SetMyProfileResponse>> {
    return this.post("setMyProfile", payload as unknown as Record<string, unknown>);
  }

  // ── Group Query & Moderation ──

  async getMyGroups(page?: number, pageSize?: number) {
    return this.post("getMyGroups", { page, page_size: pageSize });
  }

  async getMyChats(page?: number, pageSize?: number) {
    return this.post("getMyChats", { page, page_size: pageSize });
  }

  async getChatMember(chatId: string, userId: string) {
    return this.post("getChatMember", { chat_id: chatId, user_id: userId });
  }

  async getChatMembers(chatId: string, opts?: { page?: number; pageSize?: number; keyword?: string }) {
    return this.post("getChatMembers", {
      chat_id: chatId,
      page: opts?.page,
      page_size: opts?.pageSize,
      keyword: opts?.keyword,
    });
  }

  async getChatMemberCount(chatId: string) {
    return this.post("getChatMemberCount", { chat_id: chatId });
  }

  async getChatHistory(chatId: string, limit?: number): Promise<ZapryApiResponse<ChatHistoryResponse>> {
    return this.post("getChatHistory", { chat_id: chatId, limit: limit ?? 50 });
  }

  async getChatAdministrators(chatId: string) {
    return this.post("getChatAdministrators", { chat_id: chatId });
  }

  async createGroupChat(payload: CreateGroupChatPayload) {
    return this.post("createGroupChat", {
      title: payload.title,
      description: payload.description,
      avatar: payload.avatar,
      user_ids: payload.userIds,
      bot_ids: payload.botIds,
    });
  }

  async dismissGroupChat(chatId: string, reason?: string) {
    return this.post("dismissGroupChat", { chat_id: chatId, reason });
  }

  async muteChatMember(chatId: string, userId: string, mute: boolean) {
    return this.post("muteChatMember", { chat_id: chatId, user_id: userId, mute });
  }

  async kickChatMember(chatId: string, userId: string) {
    return this.post("kickChatMember", { chat_id: chatId, user_id: userId });
  }

  async inviteChatMember(chatId: string, userId: string) {
    return this.post("inviteChatMember", { chat_id: chatId, user_id: userId });
  }

  async setChatTitle(chatId: string, title: string) {
    return this.post("setChatTitle", { chat_id: chatId, title });
  }

  async setChatDescription(chatId: string, description: string) {
    return this.post("setChatDescription", { chat_id: chatId, description });
  }

  // ── Agent Self Management ──

  async getMe() {
    return this.get("getMe");
  }

  async getUserProfilePhotos(userId?: string) {
    return this.post("getUserProfilePhotos", { user_id: userId });
  }

  async setMyWalletAddress(walletAddress: string) {
    return this.post("setMyWalletAddress", { wallet_address: walletAddress });
  }

  async setMyFriendVerify(needVerify: boolean) {
    return this.post("setMyFriendVerify", { need_verify: needVerify });
  }

  async getMyContacts(page?: number, pageSize?: number) {
    return this.post("getMyContacts", { page, page_size: pageSize });
  }

  async getMyFriendRequests(pendingOnly?: boolean) {
    return this.post("getMyFriendRequests", { pending_only: pendingOnly });
  }

  async acceptFriendRequest(userId: string) {
    return this.post("acceptFriendRequest", { user_id: userId });
  }

  async rejectFriendRequest(userId: string) {
    return this.post("rejectFriendRequest", { user_id: userId });
  }

  async addFriend(userId: string, message?: string, remark?: string) {
    return this.post("addFriend", { user_id: userId, message, remark });
  }

  async deleteFriend(userId: string) {
    return this.post("deleteFriend", { user_id: userId });
  }

  async setMyName(name: string) {
    return this.post("setMyName", { name });
  }

  async setMyDescription(description: string) {
    return this.post("setMyDescription", { description });
  }

  // ── Feed ──

  async getTrendingPosts(page?: number, pageSize?: number): Promise<ZapryApiResponse<FeedListResponse>> {
    return this.post("getTrendingPosts", { page, page_size: pageSize });
  }

  async getLatestPosts(page?: number, pageSize?: number): Promise<ZapryApiResponse<FeedListResponse>> {
    return this.post("getLatestPosts", { page, page_size: pageSize });
  }

  async getMyPosts(page?: number, pageSize?: number): Promise<ZapryApiResponse<FeedListResponse>> {
    return this.post("getMyPosts", { page, page_size: pageSize });
  }

  async searchPosts(keyword: string, page?: number, pageSize?: number): Promise<ZapryApiResponse<FeedListResponse>> {
    return this.post("searchPosts", { keyword, page, page_size: pageSize });
  }

  async createPost(content: string, images?: string[]): Promise<ZapryApiResponse<CreatePostResponse>> {
    return this.post("createPost", { content, images });
  }

  async deletePost(dynamicId: number) {
    return this.post("deletePost", { dynamic_id: dynamicId });
  }

  async commentPost(dynamicId: number, content: string) {
    return this.post("commentPost", { dynamic_id: dynamicId, content });
  }

  async likePost(dynamicId: number) {
    return this.post("likePost", { dynamic_id: dynamicId });
  }

  async sharePost(dynamicId: number) {
    return this.post("sharePost", { dynamic_id: dynamicId });
  }

  // ── Club ──

  async getMyClubs(page?: number, pageSize?: number) {
    return this.post("getMyClubs", { page, page_size: pageSize });
  }

  async createClub(name: string, desc?: string, avatar?: string) {
    return this.post("createClub", { name, desc, avatar });
  }

  async updateClub(clubId: number, name?: string, desc?: string, avatar?: string) {
    return this.post("updateClub", { club_id: clubId, name, desc, avatar });
  }

  async createClubInvite(clubId: number) {
    return this.post("createClubInvite", { club_id: clubId });
  }

  async applyClub(clubId: number, message?: string, shareCode?: string) {
    return this.post("applyClub", { club_id: clubId, message, share_code: shareCode });
  }

  async approveClubApply(clubId: number, userId: string, approve: boolean) {
    return this.post("approveClubApply", { club_id: clubId, user_id: userId, approve });
  }

  async muteClubMember(clubId: number, userId: string, mute: boolean, durationSeconds?: number) {
    return this.post("muteClubMember", {
      club_id: clubId,
      user_id: userId,
      mute,
      duration_seconds: durationSeconds,
    });
  }

  async kickClubMember(clubId: number, userId: string) {
    return this.post("kickClubMember", { club_id: clubId, user_id: userId });
  }

  async setMyPresence(online: boolean) {
    return this.post("setMyPresence", { online });
  }
}
