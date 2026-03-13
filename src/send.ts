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
    const cleanUrl = mediaUrl.split("?")[0].split("#")[0] ?? mediaUrl;
    const ext = cleanUrl.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = ["jpg", "jpeg", "png", "webp", "bmp", "heic", "heif"];
    const animationExts = ["gif"];
    const videoExts = ["mp4", "mov", "avi", "webm"];
    const voiceExts = ["opus", "ogg", "oga", "amr", "m4a"];
    const audioExts = ["mp3", "wav", "aac", "flac", "m4b"];

    let resp;
    if (animationExts.includes(ext)) {
      resp = await client.sendAnimation(chatId, mediaUrl);
    } else if (imageExts.includes(ext)) {
      resp = await client.sendPhoto(chatId, mediaUrl);
    } else if (videoExts.includes(ext)) {
      resp = await client.sendVideo(chatId, mediaUrl);
    } else if (voiceExts.includes(ext)) {
      resp = await client.sendVoice(chatId, mediaUrl);
    } else if (audioExts.includes(ext)) {
      resp = await client.sendAudio(chatId, mediaUrl);
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
