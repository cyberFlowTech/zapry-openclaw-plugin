import type { ZapryApiResponse } from "./types.js";

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

export class ZapryApiClient {
  constructor(
    private baseUrl: string,
    private botToken: string,
  ) {}

  private async request<T = unknown>(opts: {
    methodPath: string;
    method: "GET" | "POST";
    body?: Record<string, unknown>;
  }): Promise<ZapryApiResponse<T>> {
    const { methodPath, method, body } = opts;
    const url = `${this.baseUrl}/${this.botToken}/${methodPath}`;
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    if (!resp.ok) {
      return {
        ok: false,
        error_code: resp.status,
        description: `HTTP ${resp.status} ${resp.statusText}`,
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

  async getUpdates(offset?: number, limit?: number, timeout?: number) {
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

  // ── Skills & Commands ──

  async setMyCommands(commands: string, languageCode?: string) {
    return this.post("setMyCommands", {
      commands,
      language_code: languageCode,
    });
  }

  async getMyCommands(languageCode?: string) {
    return this.post("getMyCommands", {
      language_code: languageCode,
    });
  }

  async deleteMyCommands(languageCode?: string) {
    return this.post("deleteMyCommands", {
      language_code: languageCode,
    });
  }

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

  async getChatMemberCount(chatId: string) {
    return this.post("getChatMemberCount", { chat_id: chatId });
  }

  async getChatAdministrators(chatId: string) {
    return this.post("getChatAdministrators", { chat_id: chatId });
  }

  async muteChatMember(chatId: string, userId: string, mute: boolean) {
    return this.post("muteChatMember", { chat_id: chatId, user_id: userId, mute });
  }

  async kickChatMember(chatId: string, userId: string) {
    return this.post("kickChatMember", { chat_id: chatId, user_id: userId });
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

  async setMyName(name: string) {
    return this.post("setMyName", { name });
  }

  async setMyDescription(description: string) {
    return this.post("setMyDescription", { description });
  }

  // ── Feed ──

  async getTrendingPosts(page?: number, pageSize?: number) {
    return this.post("getTrendingPosts", { page, page_size: pageSize });
  }

  async getLatestPosts(page?: number, pageSize?: number) {
    return this.post("getLatestPosts", { page, page_size: pageSize });
  }

  async getMyPosts(page?: number, pageSize?: number) {
    return this.post("getMyPosts", { page, page_size: pageSize });
  }

  async searchPosts(keyword: string, page?: number, pageSize?: number) {
    return this.post("searchPosts", { keyword, page, page_size: pageSize });
  }

  async createPost(content: string, images?: string[]) {
    return this.post("createPost", { content, images });
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

  async postToClub(clubId: number, content: string, images?: string[]) {
    return this.post("postToClub", { club_id: clubId, content, images });
  }

  async updateClub(clubId: number, name?: string, desc?: string, avatar?: string) {
    return this.post("updateClub", { club_id: clubId, name, desc, avatar });
  }
}
