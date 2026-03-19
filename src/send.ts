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

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "bmp", "heic", "heif"]);
const ANIMATION_EXTS = new Set(["gif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "webm"]);
const VOICE_EXTS = new Set(["opus", "ogg", "oga", "amr", "m4a"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "aac", "flac", "m4b"]);
const EXTERNAL_IMAGE_FETCH_TIMEOUT_MS = 15_000;
const MAX_EXTERNAL_IMAGE_BYTES = 10 * 1024 * 1024;

async function toDataUri(localPath: string): Promise<string> {
  const buf = await readFile(localPath);
  const ext = extname(localPath).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function isLocalPath(url: string): boolean {
  return /^(\/|~\/|\.\/|\.\.\/)/.test(url) || /^[a-zA-Z]:\\/.test(url);
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function extractDataUriMime(source: string): string | null {
  const match = /^data:([^;,]+)[;,]/i.exec(source.trim());
  if (!match) {
    return null;
  }
  return String(match[1]).trim().toLowerCase();
}

function mediaKindFromMime(mime: string): "animation" | "photo" | "video" | "voice" | "audio" | "document" {
  const normalized = mime.toLowerCase();
  if (normalized === "image/gif") {
    return "animation";
  }
  if (normalized.startsWith("image/")) {
    return "photo";
  }
  if (normalized.startsWith("video/")) {
    return "video";
  }
  if (normalized.startsWith("audio/")) {
    if (/(ogg|opus|amr|x-m4a|mp4)/i.test(normalized)) {
      return "voice";
    }
    return "audio";
  }
  return "document";
}

function inferMimeFromPath(pathLike: string): string {
  const clean = pathLike.split("?")[0]?.split("#")[0] ?? pathLike;
  const ext = extname(clean).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function detectMediaKind(mediaRef: string, originalSource: string): "animation" | "photo" | "video" | "voice" | "audio" | "document" {
  const dataUriMime = extractDataUriMime(mediaRef);
  if (dataUriMime) {
    return mediaKindFromMime(dataUriMime);
  }

  const clean = (originalSource || mediaRef).split("?")[0]?.split("#")[0] ?? (originalSource || mediaRef);
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  if (ANIMATION_EXTS.has(ext)) {
    return "animation";
  }
  if (IMAGE_EXTS.has(ext)) {
    return "photo";
  }
  if (VIDEO_EXTS.has(ext)) {
    return "video";
  }
  if (VOICE_EXTS.has(ext)) {
    return "voice";
  }
  if (AUDIO_EXTS.has(ext)) {
    return "audio";
  }
  return "document";
}

function normalizeContentType(contentType: string | null): string {
  return String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isGifBinary(binary: Buffer): boolean {
  if (binary.length < 6) {
    return false;
  }
  const header = binary.subarray(0, 6).toString("ascii");
  return header === "GIF87a" || header === "GIF89a";
}

async function readResponseBodyWithSizeLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`file is too large (${contentLength} bytes), max ${maxBytes} bytes`);
  }
  if (!response.body) {
    throw new Error("empty response body");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value || value.byteLength === 0) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`file is too large (${total} bytes), max ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const maybeError = err as { name?: string; code?: string };
  return maybeError.name === "AbortError" || maybeError.code === "ABORT_ERR";
}

async function downloadGifAsDataUri(source: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(source, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const declaredMime = normalizeContentType(response.headers.get("content-type"));
    const binary = await readResponseBodyWithSizeLimit(response, MAX_EXTERNAL_IMAGE_BYTES);
    const inferredMime = inferMimeFromPath(source);
    const mime = declaredMime || inferredMime;
    if (mime !== "image/gif" && !isGifBinary(binary)) {
      throw new Error(
        `sendAnimation requires GIF source, but got ${JSON.stringify(mime || "unknown")} (tip: use the direct .gif URL)`,
      );
    }
    return `data:image/gif;base64,${binary.toString("base64")}`;
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(`animation download timed out after ${EXTERNAL_IMAGE_FETCH_TIMEOUT_MS}ms`);
    }
    if (err instanceof Error) {
      throw new Error(`animation download failed: ${err.message}`);
    }
    throw new Error("animation download failed");
  } finally {
    clearTimeout(timeout);
  }
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
    const originalMediaUrl = opts.mediaUrl.trim();
    let mediaRef = originalMediaUrl;
    if (isLocalPath(mediaRef)) {
      const resolved = mediaRef.replace(/^~/, process.env.HOME || "");
      mediaRef = await toDataUri(resolved);
    }

    const initialKind = detectMediaKind(mediaRef, originalMediaUrl);
    if (initialKind === "animation" && isHttpUrl(mediaRef)) {
      mediaRef = await downloadGifAsDataUri(mediaRef);
    }

    const mediaKind = detectMediaKind(mediaRef, originalMediaUrl);

    let resp;
    switch (mediaKind) {
      case "animation":
        resp = await client.sendAnimation(chatId, mediaRef);
        break;
      case "photo":
        resp = await client.sendPhoto(chatId, mediaRef);
        break;
      case "video":
        resp = await client.sendVideo(chatId, mediaRef);
        break;
      case "voice":
        resp = await client.sendVoice(chatId, mediaRef);
        break;
      case "audio":
        resp = await client.sendAudio(chatId, mediaRef);
        break;
      default:
        resp = await client.sendDocument(chatId, mediaRef);
        break;
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
