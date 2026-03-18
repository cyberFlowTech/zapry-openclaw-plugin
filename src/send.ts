import { ZapryApiClient } from "./api-client.js";
import type { ResolvedZapryAccount, ZaprySendResult } from "./types.js";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
  ".heic": "image/heic", ".heif": "image/heif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac",
  ".ogg": "audio/ogg", ".opus": "audio/opus", ".m4a": "audio/mp4", ".amr": "audio/amr",
  ".flac": "audio/flac",
};

async function toDataUri(localPath: string): Promise<string> {
  const buf = await readFile(localPath);
  const ext = extname(localPath).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function isLocalPath(url: string): boolean {
  return /^(\/|~\/|\.\/|\.\.\/)/.test(url) || /^[a-zA-Z]:\\/.test(url);
}

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
    let mediaRef = opts.mediaUrl;
    if (isLocalPath(mediaRef)) {
      const resolved = mediaRef.replace(/^~/, process.env.HOME || "");
      mediaRef = await toDataUri(resolved);
    }

    const cleanUrl = opts.mediaUrl.split("?")[0].split("#")[0] ?? opts.mediaUrl;
    const ext = cleanUrl.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = ["jpg", "jpeg", "png", "webp", "bmp", "heic", "heif"];
    const animationExts = ["gif"];
    const videoExts = ["mp4", "mov", "avi", "webm"];
    const voiceExts = ["opus", "ogg", "oga", "amr", "m4a"];
    const audioExts = ["mp3", "wav", "aac", "flac", "m4b"];

    let resp;
    if (animationExts.includes(ext)) {
      resp = await client.sendAnimation(chatId, mediaRef);
    } else if (imageExts.includes(ext)) {
      resp = await client.sendPhoto(chatId, mediaRef);
    } else if (videoExts.includes(ext)) {
      resp = await client.sendVideo(chatId, mediaRef);
    } else if (voiceExts.includes(ext)) {
      resp = await client.sendVoice(chatId, mediaRef);
    } else if (audioExts.includes(ext)) {
      resp = await client.sendAudio(chatId, mediaRef);
    } else {
      resp = await client.sendDocument(chatId, mediaRef);
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
  return to.replace(/^(chat|zapry):/i, "").trim();
}
