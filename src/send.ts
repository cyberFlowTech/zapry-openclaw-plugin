import { ZapryApiClient } from "./api-client.js";
import type { ResolvedZapryAccount, ZaprySendResult } from "./types.js";

export async function sendMessageZapry(
  account: ResolvedZapryAccount,
  to: string,
  text: string,
  opts?: {
    mediaUrl?: string;
    replyTo?: string;
    accountId?: string;
  },
): Promise<ZaprySendResult> {
  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
  const chatId = normalizeTarget(to);

  if (opts?.mediaUrl) {
    const mediaUrl = opts.mediaUrl;
    const ext = mediaUrl.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp"];
    const videoExts = ["mp4", "mov", "avi", "webm"];

    let resp;
    if (imageExts.includes(ext)) {
      resp = await client.sendPhoto(chatId, mediaUrl);
    } else if (videoExts.includes(ext)) {
      resp = await client.sendVideo(chatId, mediaUrl);
    } else {
      resp = await client.sendDocument(chatId, mediaUrl);
    }

    if (!resp.ok) {
      return { ok: false, error: resp.description ?? "send media failed" };
    }
    const result = resp.result as any;
    return { ok: true, messageId: result?.message_id };
  }

  const resp = await client.sendMessage(chatId, text, {
    replyToMessageId: opts?.replyTo,
  });

  if (!resp.ok) {
    return { ok: false, error: resp.description ?? "send message failed" };
  }
  const result = resp.result as any;
  return { ok: true, messageId: result?.message_id };
}

function normalizeTarget(to: string): string {
  return to.replace(/^chat:/i, "").trim();
}
