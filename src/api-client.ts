import type { ZapryApiResponse } from "./types.js";

export class ZapryApiClient {
  constructor(
    private baseUrl: string,
    private botToken: string,
  ) {}

  private async post<T = unknown>(
    method: string,
    body?: Record<string, unknown>,
  ): Promise<ZapryApiResponse<T>> {
    const url = `${this.baseUrl}/${this.botToken}/${method}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
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

  async sendPhoto(chatId: string, photo: string, opts?: { replyMarkup?: unknown }) {
    return this.post("sendPhoto", { chat_id: chatId, photo, reply_markup: opts?.replyMarkup });
  }

  async sendVideo(chatId: string, video: string, opts?: { replyMarkup?: unknown }) {
    return this.post("sendVideo", { chat_id: chatId, video, reply_markup: opts?.replyMarkup });
  }

  async sendDocument(chatId: string, document: string) {
    return this.post("sendDocument", { chat_id: chatId, document });
  }

  async sendAudio(chatId: string, audio: string) {
    return this.post("sendAudio", { chat_id: chatId, audio });
  }

  async deleteMessage(chatId: string, messageId: string) {
    return this.post("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert?: boolean) {
    return this.post("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }

  // ── Updates ──

  async getUpdates(offset?: number, limit?: number, timeout?: number) {
    return this.post("getUpdates", { offset, limit, timeout });
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

  // ── Commands ──

  async setMyCommands(commands: Array<{ command: string; description: string }>) {
    return this.post("setMyCommands", { commands: JSON.stringify(commands) });
  }

  async getMyCommands() {
    return this.post("getMyCommands");
  }

  async deleteMyCommands() {
    return this.post("deleteMyCommands");
  }

  // ── Files ──

  async getFile(fileId: string) {
    return this.post("getFile", { file_id: fileId });
  }

  // ── Group Query ──

  async getChatMember(chatId: string, userId: string) {
    return this.post("getChatMember", { chat_id: chatId, user_id: userId });
  }

  async getChatMemberCount(chatId: string) {
    return this.post("getChatMemberCount", { chat_id: chatId });
  }

  async getChatAdministrators(chatId: string) {
    return this.post("getChatAdministrators", { chat_id: chatId });
  }

  // ── Group Management ──

  async banChatMember(chatId: string, userId: string) {
    return this.post("banChatMember", { chat_id: chatId, user_id: userId });
  }

  async unbanChatMember(chatId: string, userId: string) {
    return this.post("unbanChatMember", { chat_id: chatId, user_id: userId });
  }

  async restrictChatMember(chatId: string, userId: string, mute: boolean) {
    return this.post("restrictChatMember", {
      chat_id: chatId,
      user_id: userId,
      permissions: { can_send_messages: !mute },
    });
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

  // ── Public Data ──

  async getTrendingPosts(page?: number, pageSize?: number) {
    return this.post("getTrendingPosts", { page, page_size: pageSize });
  }

  async searchPosts(keyword: string, page?: number, pageSize?: number) {
    return this.post("searchPosts", { keyword, page, page_size: pageSize });
  }

  async getPublicCommunities(page?: number, pageSize?: number) {
    return this.post("getPublicCommunities", { page, page_size: pageSize });
  }

  async getWalletAddress(userId: string) {
    return this.post("getWalletAddress", { user_id: userId });
  }

  // ── Feed ──

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

  // ── Clubs ──

  async createClub(name: string, desc?: string, avatar?: string) {
    return this.post("createClub", { name, desc, avatar });
  }

  async postToClub(clubId: number, content: string, images?: string[]) {
    return this.post("postToClub", { club_id: clubId, content, images });
  }

  async updateClub(clubId: number, name?: string, desc?: string, avatar?: string) {
    return this.post("updateClub", { club_id: clubId, name, desc, avatar });
  }

  // ── Bot Self-Management ──

  async getMe() {
    return this.post("getMe");
  }

  async setMyName(name: string) {
    return this.post("setMyName", { name });
  }

  async setMyDescription(description: string) {
    return this.post("setMyDescription", { description });
  }

  async setMyWalletAddress(walletAddress: string) {
    return this.post("setMyWalletAddress", { wallet_address: walletAddress });
  }

  async setMyProfile(profileSource: unknown) {
    return this.post("setMyProfile", { profileSource: profileSource as Record<string, unknown> });
  }

  async getMyProfile() {
    return this.post("getMyProfile");
  }
}
