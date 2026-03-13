import { ZapryApiClient } from "./api-client.js";
import { getZapryRuntime } from "./runtime.js";
import { sendMessageZapry } from "./send.js";
import type { ResolvedZapryAccount } from "./types.js";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type RuntimeLog = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
};

type StatusSink = (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;

type MuteCommandIntent = "mute" | "unmute";

type ProcessInboundParams = {
  account: ResolvedZapryAccount;
  cfg?: any;
  runtime?: any;
  update: any;
  statusSink?: StatusSink;
  log?: RuntimeLog;
};

type ParsedInboundMediaKind =
  | "photo"
  | "video"
  | "document"
  | "audio"
  | "voice"
  | "animation";

type ParsedInboundMediaItem = {
  kind: ParsedInboundMediaKind;
  fileId?: string;
  fileUniqueId?: string;
  url?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
  thumbFileId?: string;
  thumbUrl?: string;
  resolvedFile?: ResolvedInboundFile;
  resolvedThumbFile?: ResolvedInboundFile;
  stagedPath?: string;
  stagedMimeType?: string;
  stageError?: string;
  transcript?: string;
  transcriptError?: string;
  sourceTag?: "video-thumb" | "video-keyframe";
};

type ParsedInboundMessage = {
  sourceText?: string;
  mediaItems: ParsedInboundMediaItem[];
  senderId: string;
  senderName?: string;
  targetUserHints: InboundTargetUserHint[];
  chatId: string;
  chatType?: string;
  isGroup: boolean;
  messageSid: string;
  timestampMs?: number;
};

type InboundTargetUserHint = {
  userId: string;
  username?: string;
  displayName?: string;
  source: "reply_to_message" | "text_mention" | "mention_entity" | "mentioned_users";
  raw?: string;
};

type GroupMemberCandidate = {
  userId: string;
  displayName: string;
  username?: string;
  nick?: string;
  groupNick?: string;
};

type PendingMuteConfirmation = {
  chatId: string;
  senderId: string;
  intent: MuteCommandIntent;
  target: InboundTargetUserHint;
  createdAtMs: number;
};

type ResolvedInboundFile = {
  fileId: string;
  downloadUrl?: string;
  downloadMethod?: string;
  downloadHeaders?: Record<string, string>;
  expiresAt?: string;
  contentType?: string;
  fileSize?: number;
  fileName?: string;
  error?: string;
};

const INBOUND_FILE_RESOLVE_TIMEOUT_MS = 8000;
const INBOUND_MEDIA_STAGE_TIMEOUT_MS = 15000;
const INBOUND_AUDIO_TRANSCRIBE_TIMEOUT_MS = 20000;
const INBOUND_VIDEO_POSTER_TIMEOUT_MS = 12000;
const INBOUND_VIDEO_KEYFRAME_TIMEOUT_MS = 30000;
const INBOUND_VIDEO_MAX_KEYFRAMES = 8;
const PENDING_MUTE_CONFIRMATION_TTL_MS = 3 * 60 * 1000;
const INBOUND_MEDIA_MAX_BYTES_BY_KIND: Record<ParsedInboundMediaKind, number> = {
  photo: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  voice: 25 * 1024 * 1024,
  animation: 25 * 1024 * 1024,
};
const pendingMuteConfirmations = new Map<string, PendingMuteConfirmation>();

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Zapry/Telegram-like payloads usually use second-level timestamps.
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num < 1_000_000_000_000 ? num * 1000 : num;
    }
  }
  return undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return undefined;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  const num = parseFiniteNumber(value);
  if (num === undefined) {
    return undefined;
  }
  const int = Math.floor(num);
  return int >= 0 ? int : undefined;
}

function extractTextByEntityRange(
  text: string | undefined,
  offset: unknown,
  length: unknown,
): string | undefined {
  if (!text) {
    return undefined;
  }
  const start = asNonNegativeInteger(offset);
  const size = asNonNegativeInteger(length);
  if (start === undefined || size === undefined || size <= 0 || start >= text.length) {
    return undefined;
  }
  const end = Math.min(text.length, start + size);
  return asNonEmptyString(text.slice(start, end));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const normalized = Object.entries(record).reduce<Record<string, string>>((acc, [key, rawValue]) => {
    if (typeof rawValue === "string" && rawValue.trim()) {
      acc[key] = rawValue;
    }
    return acc;
  }, {});

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function describeMediaKinds(mediaItems: ParsedInboundMediaItem[]): string {
  const labelsByKind: Record<ParsedInboundMediaKind, string> = {
    photo: "图片",
    video: "视频",
    document: "文件",
    audio: "音频",
    voice: "语音",
    animation: "动图",
  };

  const labels = Array.from(new Set(mediaItems.map((item) => labelsByKind[item.kind])));
  return labels.join("、");
}

function isAudioLikeMedia(item: ParsedInboundMediaItem): boolean {
  return item.kind === "audio" || item.kind === "voice";
}

function isExplicitTranscriptRequest(text: string | undefined): boolean {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    "转写",
    "转文字",
    "转成文字",
    "听写",
    "逐字",
    "逐字稿",
    "原话",
    "原文",
    "我说了什么",
    "我发送了什么语音",
    "给我转文字",
    "帮我转文字",
    "transcribe",
    "transcript",
    "verbatim",
  ].some((token) => normalized.includes(token));
}

function resolveCommandBody(
  sourceText: string | undefined,
  mediaItems: ParsedInboundMediaItem[],
  transcript?: string,
  targetUserHints: InboundTargetUserHint[] = [],
): string {
  const hasMedia = mediaItems.length > 0;
  const hasStagedMedia = mediaItems.some((item) => Boolean(item.stagedPath));
  const hasAudioLikeMedia = mediaItems.some((item) => isAudioLikeMedia(item));
  const hasOnlyAudioLikeMedia = mediaItems.length > 0 && mediaItems.every((item) => isAudioLikeMedia(item));
  const stageErrors = mediaItems
    .map((item) => item.stageError)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (hasMedia && !hasStagedMedia && stageErrors.length > 0) {
    const normalizedText = sourceText?.trim();
    const mediaKindText = describeMediaKinds(mediaItems) || "媒体";
    if (normalizedText) {
      return `用户请求：${normalizedText}\n但当前${mediaKindText}下载失败。禁止根据历史上下文猜测媒体内容，只能说明当前无法读取该媒体，并建议用户稍后重试或改用文件/原图方式发送。`;
    }
    return `当前${mediaKindText}下载失败。禁止根据历史上下文猜测媒体内容，只能说明当前无法读取该媒体，并建议用户稍后重试或改用文件/原图方式发送。`;
  }

  const normalizedText = sourceText?.trim();
  const transcriptRequested = isExplicitTranscriptRequest(normalizedText);
  const moderationIntent = isLikelyModerationIntent(normalizedText);
  const moderationGuidance = (() => {
    if (!moderationIntent) {
      return "";
    }
    const lines: string[] = [
      "群管理执行规则：",
      "- `mute-chat-member` 仅支持 `mute=true/false`，不支持 `until_date` 或时长参数。",
      "- 禁止向用户提供“10分钟/1小时/24小时/永久”等时长选项。",
    ];
    if (targetUserHints.length === 1) {
      lines.push(`- 已解析目标用户 user_id=${targetUserHints[0].userId}，可直接执行。`);
    } else if (targetUserHints.length > 1) {
      lines.push("- 已解析到多个候选 user_id，请按用户提及对象选择最匹配的目标：");
      for (const hint of targetUserHints.slice(0, 5)) {
        lines.push(`  - ${summarizeTargetUserHint(hint)}`);
      }
    } else {
      lines.push("- 当前未解析到目标 user_id，优先让用户 @目标用户 或回复目标用户消息。");
    }
    return lines.join("\n");
  })();
  const audioGenerationIntent = isLikelyAudioGenerationIntent(normalizedText);
  const audioGenerationGuidance = (() => {
    if (!audioGenerationIntent) {
      return "";
    }
    return [
      "音频生成执行规则：",
      "- 用户要求生成音频/MP3/铃声时，优先调用 `generate-audio`，不要只发口头承诺。",
      "- 在 `generate-audio` 成功前，禁止说“我现在开始制作并几分钟后发你 MP3”。",
      "- 失败时只允许给简短失败说明并建议重试，禁止承诺稍后补发。",
    ].join("\n");
  })();
  const extraGuidance = [moderationGuidance, audioGenerationGuidance].filter(Boolean).join("\n");
  if (normalizedText) {
    if (hasAudioLikeMedia) {
      if (transcript?.trim()) {
        if (transcriptRequested) {
          return `用户要求：${normalizedText}\n当前轮真实转写文本：${transcript}\n用户明确要求转写/转文字时，优先直接输出上述真实转写文本；禁止根据历史上下文或主观猜测改写内容。${extraGuidance ? `\n${extraGuidance}` : ""}`;
        }
        return `用户要求：${normalizedText}\n当前轮真实转写文本（仅供理解，不要默认回显给用户）：${transcript}\n请把该转写视为用户本轮真实语音输入，直接回答用户意图；除非用户明确要求转写/逐字稿，否则不要回显转写文本。${extraGuidance ? `\n${extraGuidance}` : ""}`;
      }
      return `${normalizedText}\n当前轮语音/音频尚未拿到真实转写文本。禁止根据用户追问文本、历史上下文或主观猜测编造语音内容；只能明确说明当前无法完成真实转写。${extraGuidance ? `\n${extraGuidance}` : ""}`;
    }
    return extraGuidance ? `${normalizedText}\n${extraGuidance}` : normalizedText;
  }
  if (!mediaItems.length) {
    return "";
  }
  const mediaKindText = describeMediaKinds(mediaItems) || "媒体";
  if (hasOnlyAudioLikeMedia) {
    if (transcript?.trim()) {
      return `请直接处理这条${mediaKindText}消息。当前轮真实转写文本（仅供理解，不要默认回显给用户）：${transcript}\n把这段转写视为用户本轮真实输入，直接像普通聊天一样回复其意图；除非用户明确要求转写/逐字稿，否则不要输出转写文本本身。`;
    }
    return `请直接处理这条${mediaKindText}消息。当前轮还没有真实转写文本，禁止根据历史上下文或主观猜测编造音频内容；只能明确说明当前无法完成真实转写，并请求用户重发。`;
  }
  return `请直接查看并分析这条${mediaKindText}消息，优先使用已提供的 file_id 与已附加媒体内容，不要先询问是否需要解析。`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resolveInboundMediaMaxBytes(item: ParsedInboundMediaItem): number {
  const baseline = INBOUND_MEDIA_MAX_BYTES_BY_KIND[item.kind];
  if (item.fileSize !== undefined && item.fileSize > 0) {
    return Math.max(baseline, item.fileSize + 1024 * 1024);
  }
  return baseline;
}

function resolveInboundMediaRuntime(runtime: any): {
  fetchRemoteMedia: (opts: {
    url: string;
    maxBytes?: number;
    requestInit?: RequestInit;
    filePathHint?: string;
  }) => Promise<{ buffer: any; contentType?: string; fileName?: string }>;
  saveMediaBuffer: (
    buffer: any,
    contentType?: string,
    subdir?: string,
    maxBytes?: number,
    originalFilename?: string,
  ) => Promise<{ path: string; contentType?: string }>;
} | null {
  const fetchRemoteMedia = runtime?.channel?.media?.fetchRemoteMedia;
  const saveMediaBuffer = runtime?.channel?.media?.saveMediaBuffer;
  if (typeof fetchRemoteMedia !== "function" || typeof saveMediaBuffer !== "function") {
    return null;
  }
  return { fetchRemoteMedia, saveMediaBuffer };
}

function sanitizeResolvedInboundFileForAgent(file: ResolvedInboundFile | undefined): ResolvedInboundFile | undefined {
  if (!file) {
    return undefined;
  }
  return {
    fileId: file.fileId,
    contentType: file.contentType,
    fileSize: file.fileSize,
    fileName: file.fileName,
    error: file.error,
  };
}

function sanitizeMediaItemsForAgent(mediaItems: ParsedInboundMediaItem[]): ParsedInboundMediaItem[] {
  return mediaItems.map((item) => ({
    ...item,
    url: item.fileId ? undefined : item.url,
    thumbUrl: item.thumbFileId ? undefined : item.thumbUrl,
    resolvedFile: sanitizeResolvedInboundFileForAgent(item.resolvedFile),
    resolvedThumbFile: sanitizeResolvedInboundFileForAgent(item.resolvedThumbFile),
    stagedPath: undefined,
    stagedMimeType: undefined,
  }));
}

function appendVideoThumbnailMediaItems(mediaItems: ParsedInboundMediaItem[]): ParsedInboundMediaItem[] {
  if (!mediaItems.length) {
    return mediaItems;
  }

  const expanded: ParsedInboundMediaItem[] = [];
  const seen = new Set<string>();
  const dedupeKey = (item: ParsedInboundMediaItem): string =>
    `${item.kind}|${item.fileId ?? ""}|${item.url ?? ""}|${item.sourceTag ?? ""}`;

  const appendOnce = (item: ParsedInboundMediaItem): void => {
    const key = dedupeKey(item);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    expanded.push(item);
  };

  for (const item of mediaItems) {
    appendOnce(item);
    if (item.kind !== "video") {
      continue;
    }

    const thumbUrl = item.resolvedThumbFile?.downloadUrl ?? item.thumbUrl;
    const thumbFileId = item.thumbFileId;
    if (!thumbUrl && !thumbFileId) {
      continue;
    }

    const thumbMime = item.resolvedThumbFile?.contentType;
    const fallbackName =
      item.resolvedThumbFile?.fileName ??
      (thumbFileId ? `video-thumb-${thumbFileId}.jpg` : undefined);
    appendOnce({
      kind: "photo",
      fileId: thumbFileId,
      url: thumbUrl,
      mimeType: thumbMime,
      fileName: fallbackName,
      fileSize: item.resolvedThumbFile?.fileSize,
      resolvedFile: item.resolvedThumbFile,
      sourceTag: "video-thumb",
    });
  }

  return expanded;
}

async function runProcessWithTimeout(command: string, args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once("exit", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} failed (${code}): ${stderr.trim() || "no stderr"}`));
    });
  });
}

async function extractVideoPosterPngBuffer(videoPath: string, log?: RuntimeLog): Promise<Buffer | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  const outputDir = path.join(os.tmpdir(), `openclaw-zapry-video-thumb-${randomUUID()}`);
  try {
    await fs.mkdir(outputDir, { recursive: true });
    await runProcessWithTimeout(
      "/usr/bin/qlmanage",
      ["-t", "-s", "1024", "-o", outputDir, videoPath],
      INBOUND_VIDEO_POSTER_TIMEOUT_MS,
    );

    const files = await fs.readdir(outputDir);
    const posterFile = files.find((f: string) => f.toLowerCase().endsWith(".png"));
    if (!posterFile) {
      return null;
    }

    return await fs.readFile(path.join(outputDir, posterFile));
  } catch (error) {
    log?.debug?.(`[zapry] generate video poster failed for ${videoPath}: ${String(error)}`);
    return null;
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getVideoDurationSeconds(videoPath: string): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 8000);

    child.once("error", () => { clearTimeout(timer); resolve(null); });
    child.once("exit", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) { resolve(null); return; }
      const dur = parseFloat(stdout.trim());
      resolve(Number.isFinite(dur) && dur > 0 ? dur : null);
    });
  });
}

function computeKeyframeTimestamps(durationSec: number): number[] {
  let count: number;
  if (durationSec < 3) count = 2;
  else if (durationSec < 10) count = 3;
  else if (durationSec < 30) count = 5;
  else if (durationSec < 90) count = 6;
  else count = INBOUND_VIDEO_MAX_KEYFRAMES;

  count = Math.min(count, INBOUND_VIDEO_MAX_KEYFRAMES);
  const step = durationSec / (count + 1);
  const timestamps: number[] = [];
  for (let i = 1; i <= count; i++) {
    timestamps.push(Math.round(step * i * 100) / 100);
  }
  return timestamps;
}

async function extractSingleFrameJpeg(
  videoPath: string,
  timestampSec: number,
  outputPath: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await runProcessWithTimeout(
      "ffmpeg",
      ["-ss", String(timestampSec), "-i", videoPath, "-frames:v", "1", "-q:v", "3", "-f", "image2", "-y", outputPath],
      timeoutMs,
    );
    const stat = await fs.stat(outputPath);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function extractVideoKeyframeBuffers(
  videoPath: string,
  log?: RuntimeLog,
): Promise<{ buffer: Buffer; timestampSec: number }[]> {
  const duration = await getVideoDurationSeconds(videoPath);
  if (!duration) {
    const poster = await extractVideoPosterPngBuffer(videoPath, log);
    return poster ? [{ buffer: poster, timestampSec: 0 }] : [];
  }

  const timestamps = computeKeyframeTimestamps(duration);
  const outputDir = path.join(os.tmpdir(), `openclaw-zapry-keyframes-${randomUUID()}`);
  try {
    await fs.mkdir(outputDir, { recursive: true });
    const perFrameTimeout = Math.max(5000, Math.floor(INBOUND_VIDEO_KEYFRAME_TIMEOUT_MS / timestamps.length));

    const framePromises = timestamps.map(async (ts, index) => {
      const outPath = path.join(outputDir, `frame-${String(index).padStart(3, "0")}.jpg`);
      const ok = await extractSingleFrameJpeg(videoPath, ts, outPath, perFrameTimeout);
      if (!ok) return null;
      try {
        const buf = await fs.readFile(outPath);
        return buf.length > 0 ? { buffer: buf, timestampSec: ts } : null;
      } catch { return null; }
    });

    const results = (await Promise.all(framePromises)).filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );

    if (results.length > 0) return results;
    const poster = await extractVideoPosterPngBuffer(videoPath, log);
    return poster ? [{ buffer: poster, timestampSec: 0 }] : [];
  } catch (error) {
    log?.debug?.(`[zapry] extract video keyframes failed for ${videoPath}: ${String(error)}`);
    const poster = await extractVideoPosterPngBuffer(videoPath, log);
    return poster ? [{ buffer: poster, timestampSec: 0 }] : [];
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function appendVideoKeyframeItems(
  runtime: any,
  mediaItems: ParsedInboundMediaItem[],
  log?: RuntimeLog,
): Promise<ParsedInboundMediaItem[]> {
  if (!mediaItems.length) return mediaItems;

  const mediaRuntime = resolveInboundMediaRuntime(runtime);
  if (!mediaRuntime) return mediaItems;

  const output = [...mediaItems];
  for (const item of mediaItems) {
    if (item.kind !== "video" || !item.stagedPath || item.stageError) continue;

    const frames = await extractVideoKeyframeBuffers(item.stagedPath, log);
    if (!frames.length) continue;

    const baseName = path.parse(item.fileName ?? "video").name;
    const isSinglePoster = frames.length === 1 && frames[0].timestampSec === 0;

    for (const [idx, frame] of frames.entries()) {
      const tag: "video-thumb" | "video-keyframe" = isSinglePoster ? "video-thumb" : "video-keyframe";
      const mime = isSinglePoster ? "image/png" : "image/jpeg";
      const ext = isSinglePoster ? "png" : "jpg";
      const tsLabel = isSinglePoster ? "poster" : `at-${frame.timestampSec}s`;
      const fileName = `${baseName}-keyframe-${idx + 1}-${tsLabel}.${ext}`;
      try {
        const saved = await withTimeout(
          mediaRuntime.saveMediaBuffer(frame.buffer, mime, "inbound", INBOUND_MEDIA_MAX_BYTES_BY_KIND.photo, fileName),
          INBOUND_MEDIA_STAGE_TIMEOUT_MS,
          `save video keyframe ${idx + 1} of ${item.fileId ?? "video"}`,
        );
        output.push({
          kind: "photo",
          mimeType: saved.contentType ?? mime,
          fileName,
          stagedPath: saved.path,
          stagedMimeType: saved.contentType ?? mime,
          sourceTag: tag,
        });
      } catch (error) {
        log?.debug?.(`[zapry] save keyframe ${idx + 1} failed for ${item.fileId ?? "video"}: ${String(error)}`);
      }
    }
  }

  return output;
}

async function appendVideoPosterFallbackItems(
  runtime: any,
  mediaItems: ParsedInboundMediaItem[],
  log?: RuntimeLog,
): Promise<ParsedInboundMediaItem[]> {
  if (!mediaItems.length) {
    return mediaItems;
  }

  const mediaRuntime = resolveInboundMediaRuntime(runtime);
  if (!mediaRuntime) {
    return mediaItems;
  }

  const output = [...mediaItems];
  for (const item of mediaItems) {
    if (item.kind !== "video" || !item.stagedPath || item.stageError) {
      continue;
    }

    const hasRenderableThumb = output.some(
      (candidate) =>
        candidate.kind === "photo" &&
        candidate.sourceTag === "video-thumb" &&
        Boolean(candidate.stagedPath),
    );
    if (hasRenderableThumb) {
      continue;
    }

    const posterBuffer = await extractVideoPosterPngBuffer(item.stagedPath, log);
    if (!posterBuffer) {
      continue;
    }

    try {
      const saved = await withTimeout(
        mediaRuntime.saveMediaBuffer(
          posterBuffer,
          "image/png",
          "inbound",
          INBOUND_MEDIA_MAX_BYTES_BY_KIND.photo,
          `${path.parse(item.fileName ?? "video").name}-poster.png`,
        ),
        INBOUND_MEDIA_STAGE_TIMEOUT_MS,
        `save inbound video poster ${item.fileId ?? "video"}`,
      );
      output.push({
        kind: "photo",
        mimeType: saved.contentType ?? "image/png",
        fileName: `${path.parse(item.fileName ?? "video").name}-poster.png`,
        stagedPath: saved.path,
        stagedMimeType: saved.contentType ?? "image/png",
        sourceTag: "video-thumb",
      });
    } catch (error) {
      log?.debug?.(`[zapry] save generated video poster failed for ${item.fileId ?? "video"}: ${String(error)}`);
    }
  }

  return output;
}

function resolveInboundSttRuntime(runtime: any):
  | {
      transcribeAudioFile: (params: {
        filePath: string;
        cfg: any;
        agentDir?: string;
        mime?: string;
      }) => Promise<{ text?: string }>;
    }
  | null {
  const transcribeAudioFile = runtime?.stt?.transcribeAudioFile;
  if (typeof transcribeAudioFile !== "function") {
    return null;
  }
  return { transcribeAudioFile };
}

async function stageInboundMediaItems(
  runtime: any,
  mediaItems: ParsedInboundMediaItem[],
  log?: RuntimeLog,
): Promise<ParsedInboundMediaItem[]> {
  if (!mediaItems.length) {
    return mediaItems;
  }

  const mediaRuntime = resolveInboundMediaRuntime(runtime);
  if (!mediaRuntime) {
    return mediaItems;
  }

  return Promise.all(
    mediaItems.map(async (item) => {
      const sourceUrl = item.resolvedFile?.downloadUrl ?? item.url;
      if (!sourceUrl) {
        return item;
      }

      const maxBytes = resolveInboundMediaMaxBytes(item);
      const requestInit = item.resolvedFile?.downloadHeaders
        ? {
            headers: item.resolvedFile.downloadHeaders,
          }
        : undefined;

      try {
        const fetched = await withTimeout(
          mediaRuntime.fetchRemoteMedia({
            url: sourceUrl,
            maxBytes,
            requestInit,
            filePathHint: item.fileName ?? item.resolvedFile?.fileName ?? sourceUrl,
          }),
          INBOUND_MEDIA_STAGE_TIMEOUT_MS,
          `stage inbound media ${item.fileId ?? item.kind}`,
        );

        const saved = await withTimeout(
          mediaRuntime.saveMediaBuffer(
            fetched.buffer,
            fetched.contentType ?? item.mimeType ?? item.resolvedFile?.contentType,
            "inbound",
            maxBytes,
            item.fileName ?? item.resolvedFile?.fileName ?? fetched.fileName,
          ),
          INBOUND_MEDIA_STAGE_TIMEOUT_MS,
          `save inbound media ${item.fileId ?? item.kind}`,
        );

        return {
          ...item,
          mimeType: item.mimeType ?? fetched.contentType ?? saved.contentType,
          url: item.url ?? sourceUrl,
          // These fields are consumed by OpenClaw media-understanding.
          stagedPath: saved.path,
          stagedMimeType: saved.contentType ?? fetched.contentType ?? item.mimeType,
          stageError: undefined,
        };
      } catch (error) {
        const stageError = String(error);
        log?.warn?.(`[zapry] stage inbound media failed for ${item.fileId ?? item.kind}: ${stageError}`);
        return {
          ...item,
          stageError,
        };
      }
    }),
  );
}

async function transcribeInboundAudioItems(
  runtime: any,
  cfg: any,
  mediaItems: ParsedInboundMediaItem[],
  log?: RuntimeLog,
): Promise<{ mediaItems: ParsedInboundMediaItem[]; transcript?: string }> {
  if (!mediaItems.length) {
    return { mediaItems };
  }
  const sttRuntime = resolveInboundSttRuntime(runtime);
  if (!sttRuntime) {
    return { mediaItems };
  }

  const updated = await Promise.all(
    mediaItems.map(async (item) => {
      if (!isAudioLikeMedia(item) || !item.stagedPath || item.stageError) {
        return item;
      }
      try {
        const result = await withTimeout(
          sttRuntime.transcribeAudioFile({
            filePath: item.stagedPath,
            cfg,
            mime: item.stagedMimeType ?? item.mimeType ?? item.resolvedFile?.contentType,
          }),
          INBOUND_AUDIO_TRANSCRIBE_TIMEOUT_MS,
          `transcribe inbound audio ${item.fileId ?? item.kind}`,
        );
        const transcript = result?.text?.trim();
        if (!transcript) {
          return {
            ...item,
            transcriptError: "empty transcript",
          };
        }
        return {
          ...item,
          transcript,
          transcriptError: undefined,
        };
      } catch (error) {
        const transcriptError = String(error);
        log?.warn?.(`[zapry] transcribe inbound audio failed for ${item.fileId ?? item.kind}: ${transcriptError}`);
        return {
          ...item,
          transcriptError,
        };
      }
    }),
  );

  const transcriptItems = updated.filter(
    (item): item is ParsedInboundMediaItem & { transcript: string } =>
      isAudioLikeMedia(item) && typeof item.transcript === "string" && item.transcript.trim().length > 0,
  );
  if (!transcriptItems.length) {
    return { mediaItems: updated };
  }

  const transcript =
    transcriptItems.length === 1
      ? transcriptItems[0].transcript
      : transcriptItems.map((item, index) => `音频${index + 1}：\n${item.transcript}`).join("\n\n");
  return { mediaItems: updated, transcript };
}

function parseMediaObject(kind: ParsedInboundMediaKind, raw: unknown): ParsedInboundMediaItem | null {
  const media = asRecord(raw);
  if (!media) {
    return null;
  }
  const thumb = asRecord(media.thumb) ?? asRecord(media.thumbnail);
  const thumbFileId =
    asNonEmptyString(thumb?.file_id ?? thumb?.fileId) ??
    asNonEmptyString(
      media.thumb_file_id ??
      media.thumbFileId ??
      media.thumbnail_file_id ??
      media.thumbnailFileId,
    );
  const thumbUrl =
    asNonEmptyString(thumb?.url ?? thumb?.remotePath) ??
    asNonEmptyString(
      media.thumb_url ??
      media.thumbUrl ??
      media.thumbnail_url ??
      media.thumbnailUrl,
    );

  const item: ParsedInboundMediaItem = {
    kind,
    fileId: asNonEmptyString(media.file_id ?? media.fileId),
    fileUniqueId: asNonEmptyString(media.file_unique_id ?? media.fileUniqueId),
    url: asNonEmptyString(media.url ?? media.remotePath ?? media.path),
    mimeType: asNonEmptyString(media.mime_type ?? media.mimeType),
    fileName: asNonEmptyString(media.file_name ?? media.fileName ?? media.name),
    fileSize: parseFiniteNumber(media.file_size ?? media.fileSize),
    width: parseFiniteNumber(media.width),
    height: parseFiniteNumber(media.height),
    duration: parseFiniteNumber(media.duration),
    thumbFileId,
    thumbUrl,
  };

  const hasUsefulField =
    Boolean(item.fileId) ||
    Boolean(item.url) ||
    Boolean(item.fileName) ||
    Boolean(item.mimeType) ||
    item.fileSize !== undefined ||
    item.width !== undefined ||
    item.height !== undefined ||
    item.duration !== undefined ||
    Boolean(item.thumbFileId) ||
    Boolean(item.thumbUrl);
  return hasUsefulField ? item : null;
}

function mediaScore(item: ParsedInboundMediaItem): number {
  const area = (item.width ?? 0) * (item.height ?? 0);
  return area + (item.fileSize ?? 0);
}

function extractInboundMediaItems(message: Record<string, unknown>): ParsedInboundMediaItem[] {
  const items: ParsedInboundMediaItem[] = [];

  if (Array.isArray(message.photo)) {
    const photoVariants = message.photo
      .map((entry) => parseMediaObject("photo", entry))
      .filter((entry): entry is ParsedInboundMediaItem => Boolean(entry));
    if (photoVariants.length > 0) {
      photoVariants.sort((a, b) => mediaScore(b) - mediaScore(a));
      items.push(photoVariants[0]);
    }
  }

  const directMediaKeys: Array<{ key: string; kind: ParsedInboundMediaKind }> = [
    { key: "video", kind: "video" },
    { key: "document", kind: "document" },
    { key: "audio", kind: "audio" },
    { key: "voice", kind: "voice" },
    { key: "animation", kind: "animation" },
  ];
  for (const { key, kind } of directMediaKeys) {
    const parsed = parseMediaObject(kind, message[key]);
    if (parsed) {
      items.push(parsed);
    }
  }

  return items;
}

function resolveUserIdFromRecord(record: Record<string, unknown> | null): string | undefined {
  if (!record) {
    return undefined;
  }
  const value =
    record.id ??
    record.user_id ??
    record.userId ??
    record.uid ??
    record.member_id ??
    record.memberId;
  if (value === undefined || value === null) {
    return undefined;
  }
  return asNonEmptyString(String(value));
}

function normalizeUsername(value: unknown): string | undefined {
  const username = asNonEmptyString(typeof value === "string" ? value : value != null ? String(value) : undefined);
  if (!username) {
    return undefined;
  }
  return username.replace(/^@+/, "");
}

function resolveDisplayNameFromRecord(record: Record<string, unknown> | null): string | undefined {
  if (!record) {
    return undefined;
  }
  const fullName =
    asNonEmptyString(typeof record.name === "string" ? record.name : undefined) ??
    asNonEmptyString(typeof record.display_name === "string" ? record.display_name : undefined) ??
    asNonEmptyString(typeof record.displayName === "string" ? record.displayName : undefined) ??
    asNonEmptyString(typeof record.nick === "string" ? record.nick : undefined) ??
    asNonEmptyString(typeof record.nickname === "string" ? record.nickname : undefined);
  if (fullName) {
    return fullName;
  }

  const firstName = asNonEmptyString(
    typeof record.first_name === "string" ? record.first_name : typeof record.firstName === "string" ? record.firstName : undefined,
  );
  const lastName = asNonEmptyString(
    typeof record.last_name === "string" ? record.last_name : typeof record.lastName === "string" ? record.lastName : undefined,
  );
  const joined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return joined || undefined;
}

function extractTargetUserHints(
  message: Record<string, unknown>,
  sourceText?: string,
): InboundTargetUserHint[] {
  const hints = new Map<string, InboundTargetUserHint>();
  const sourcePriority: Record<InboundTargetUserHint["source"], number> = {
    reply_to_message: 4,
    text_mention: 3,
    mention_entity: 2,
    mentioned_users: 1,
  };

  const pushHint = (hint: InboundTargetUserHint): void => {
    const userId = asNonEmptyString(hint.userId);
    if (!userId) {
      return;
    }
    const normalizedHint: InboundTargetUserHint = {
      ...hint,
      userId,
      username: normalizeUsername(hint.username),
      displayName: asNonEmptyString(hint.displayName),
      raw: asNonEmptyString(hint.raw),
    };
    const existing = hints.get(userId);
    if (!existing) {
      hints.set(userId, normalizedHint);
      return;
    }
    const shouldUpgradeSource = sourcePriority[normalizedHint.source] > sourcePriority[existing.source];
    hints.set(userId, {
      userId,
      source: shouldUpgradeSource ? normalizedHint.source : existing.source,
      username: existing.username ?? normalizedHint.username,
      displayName: existing.displayName ?? normalizedHint.displayName,
      raw: existing.raw ?? normalizedHint.raw,
    });
  };

  const replyMessage = asRecord(message.reply_to_message ?? message.replyToMessage);
  if (replyMessage) {
    const replyFrom = asRecord(replyMessage.from ?? replyMessage.sender ?? replyMessage.user);
    const replyUserId =
      resolveUserIdFromRecord(replyFrom) ??
      asNonEmptyString(
        replyMessage.sender_id != null
          ? String(replyMessage.sender_id)
          : replyMessage.from_id != null
            ? String(replyMessage.from_id)
            : replyMessage.user_id != null
              ? String(replyMessage.user_id)
              : undefined,
      );
    if (replyUserId) {
      pushHint({
        userId: replyUserId,
        username: normalizeUsername(replyFrom?.username ?? replyMessage.sender_username),
        displayName:
          resolveDisplayNameFromRecord(replyFrom) ??
          asNonEmptyString(
            typeof replyMessage.sender_name === "string"
              ? replyMessage.sender_name
              : typeof replyMessage.senderName === "string"
                ? replyMessage.senderName
                : undefined,
          ),
        source: "reply_to_message",
        raw: "reply_to_message",
      });
    }
  }

  const entities: unknown[] = [];
  if (Array.isArray(message.entities)) {
    entities.push(...message.entities);
  }
  if (Array.isArray(message.caption_entities)) {
    entities.push(...message.caption_entities);
  }

  for (const entityRaw of entities) {
    const entity = asRecord(entityRaw);
    if (!entity) {
      continue;
    }
    const type = asNonEmptyString(entity.type)?.toLowerCase();
    if (type !== "text_mention" && type !== "mention") {
      continue;
    }
    const entityUser = asRecord(entity.user ?? entity.from_user ?? entity.sender ?? entity.member);
    const entityUserId =
      resolveUserIdFromRecord(entityUser) ??
      asNonEmptyString(
        entity.user_id != null
          ? String(entity.user_id)
          : entity.userId != null
            ? String(entity.userId)
            : entity.uid != null
              ? String(entity.uid)
              : undefined,
      );
    if (!entityUserId) {
      continue;
    }
    pushHint({
      userId: entityUserId,
      username: normalizeUsername(entityUser?.username),
      displayName: resolveDisplayNameFromRecord(entityUser),
      source: type === "text_mention" ? "text_mention" : "mention_entity",
      raw: extractTextByEntityRange(sourceText, entity.offset, entity.length),
    });
  }

  const mentionArrayFields = [
    "mentioned_users",
    "mentionedUsers",
    "mentions",
    "at_users",
    "atUsers",
    "at_list",
    "atList",
  ];
  for (const field of mentionArrayFields) {
    const rawValue = message[field];
    if (!Array.isArray(rawValue)) {
      continue;
    }
    for (const entry of rawValue) {
      const record = asRecord(entry);
      if (!record) {
        continue;
      }
      const userId =
        resolveUserIdFromRecord(record) ??
        asNonEmptyString(record.member != null ? String(record.member) : undefined);
      if (!userId) {
        continue;
      }
      pushHint({
        userId,
        username: normalizeUsername(record.username ?? record.user_name),
        displayName: resolveDisplayNameFromRecord(record),
        source: "mentioned_users",
        raw:
          asNonEmptyString(typeof record.text === "string" ? record.text : undefined) ??
          asNonEmptyString(typeof record.name === "string" ? record.name : undefined),
      });
    }
  }

  const mentionSingleFields = [
    "target_user_id",
    "targetUserId",
    "mentioned_user_id",
    "mentionedUserId",
    "reply_user_id",
    "replyUserId",
  ];
  for (const field of mentionSingleFields) {
    const value = message[field];
    if (value === undefined || value === null) {
      continue;
    }
    const userId = asNonEmptyString(String(value));
    if (!userId) {
      continue;
    }
    pushHint({
      userId,
      source: "mentioned_users",
      raw: field,
    });
  }

  return Array.from(hints.values());
}

function summarizeTargetUserHint(hint: InboundTargetUserHint): string {
  const parts = [`user_id=${hint.userId}`];
  if (hint.displayName) {
    parts.push(`name=${hint.displayName}`);
  }
  if (hint.username) {
    parts.push(`username=@${hint.username}`);
  }
  parts.push(`source=${hint.source}`);
  if (hint.raw) {
    parts.push(`raw=${hint.raw}`);
  }
  return parts.join(" | ");
}

function isLikelyModerationIntent(text: string | undefined): boolean {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    "禁言",
    "解禁",
    "踢",
    "移出群",
    "封禁",
    "mute",
    "unmute",
    "kick",
    "ban",
    "restrict",
  ].some((token) => normalized.includes(token));
}

function resolveMuteCommandIntent(text: string | undefined): MuteCommandIntent | null {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const unmuteTokens = ["解除禁言", "取消禁言", "解禁", "unmute", "解除封禁", "取消封禁"];
  if (unmuteTokens.some((token) => normalized.includes(token))) {
    return "unmute";
  }
  const muteTokens = ["禁言", "mute", "封禁", "闭麦"];
  if (muteTokens.some((token) => normalized.includes(token))) {
    return "mute";
  }
  return null;
}

function isLikelyMuteCommandMessage(
  text: string | undefined,
  targetUserHints: InboundTargetUserHint[],
): boolean {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (!resolveMuteCommandIntent(normalized)) {
    return false;
  }
  if (targetUserHints.length > 0) {
    return true;
  }
  const discussionTokens = [
    "体验",
    "方案",
    "文档",
    "规则",
    "策略",
    "为什么",
    "怎么",
    "支持",
    "接口",
    "参数",
    "提示词",
  ];
  if (discussionTokens.some((token) => normalized.includes(token))) {
    return false;
  }
  return [
    "把",
    "将",
    "请",
    "帮",
    "麻烦",
    "执行",
    "试试",
    "处理",
    "@",
    "/mute",
    "/unmute",
  ].some((token) => normalized.includes(token));
}

function buildPendingMuteConfirmationKey(chatId: string, senderId: string): string {
  return `${chatId}::${senderId}`;
}

function clearPendingMuteConfirmation(chatId: string, senderId: string): void {
  pendingMuteConfirmations.delete(buildPendingMuteConfirmationKey(chatId, senderId));
}

function getPendingMuteConfirmation(chatId: string, senderId: string): PendingMuteConfirmation | null {
  const key = buildPendingMuteConfirmationKey(chatId, senderId);
  const pending = pendingMuteConfirmations.get(key);
  if (!pending) {
    return null;
  }
  if (Date.now() - pending.createdAtMs > PENDING_MUTE_CONFIRMATION_TTL_MS) {
    pendingMuteConfirmations.delete(key);
    return null;
  }
  return pending;
}

function setPendingMuteConfirmation(pending: PendingMuteConfirmation): void {
  pendingMuteConfirmations.set(
    buildPendingMuteConfirmationKey(pending.chatId, pending.senderId),
    pending,
  );
}

function resolveMuteConfirmationDecision(text: string | undefined): "confirm" | "cancel" | null {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    [
      "取消",
      "取消操作",
      "取消执行",
      "算了",
      "不是他",
      "不对",
      "cancel",
      "no",
    ].some((token) => normalized === token || normalized.includes(token))
  ) {
    return "cancel";
  }
  if (
    [
      "确认",
      "确认执行",
      "确认禁言",
      "确认解禁",
      "确认解除禁言",
      "执行",
      "执行吧",
      "就他",
      "是他",
      "yes",
      "ok",
      "okay",
    ].some((token) => normalized === token || normalized.includes(token))
  ) {
    return "confirm";
  }
  return null;
}

function normalizeLookupToken(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[\s"'`“”‘’]/g, "");
}

function extractTargetKeywordFromMuteText(text: string | undefined): string | null {
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();
  const actionTokens = ["解除禁言", "取消禁言", "解禁", "unmute", "禁言", "mute", "封禁", "闭麦"];
  let actionIndex = -1;
  for (const token of actionTokens) {
    const idx = lower.indexOf(token);
    if (idx >= 0 && (actionIndex < 0 || idx < actionIndex)) {
      actionIndex = idx;
    }
  }
  if (actionIndex < 0) {
    return null;
  }

  let left = normalized.slice(0, actionIndex).trim();
  left = left.replace(/^@[^ \t\r\n]+\s+/u, "").trim();
  const markerIndex = Math.max(left.lastIndexOf("把"), left.lastIndexOf("将"), left.lastIndexOf("给"));
  if (markerIndex >= 0) {
    left = left.slice(markerIndex + 1).trim();
  }
  left = left
    .replace(/^(本群里|这个群里|这群里|群里|群中)/, "")
    .replace(/[：:，,。.!！?？]+$/g, "")
    .replace(/^["'`“‘]+|["'`”’]+$/g, "")
    .replace(/(给|一下|先|直接|立刻|马上)$/g, "")
    .trim();
  if (left.startsWith("@")) {
    left = left.slice(1).trim();
  }
  if (!left) {
    const atMatch = normalized.match(/@([^\s，,。.!！？?]+)/u);
    if (atMatch?.[1]) {
      left = atMatch[1].trim();
    }
  }
  if (!left || normalizeLookupToken(left).length < 2) {
    return null;
  }
  return left;
}

function toUserIdString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized === "0") {
    return undefined;
  }
  return normalized;
}

function parseGroupMemberCandidate(
  rawKey: string | undefined,
  rawValue: unknown,
): GroupMemberCandidate | null {
  const record = asRecord(rawValue);
  if (!record) {
    return null;
  }

  const explicitUserId = toUserIdString(record.user_id ?? record.userId ?? record.uid);

  const groupNick = asNonEmptyString(
    typeof record.Gnick === "string"
      ? record.Gnick
      : typeof record.gnick === "string"
        ? record.gnick
        : typeof record.group_nick === "string"
          ? record.group_nick
          : typeof record.groupNick === "string"
            ? record.groupNick
            : undefined,
  );
  const nick = asNonEmptyString(
    typeof record.Nick === "string"
      ? record.Nick
      : typeof record.nick === "string"
        ? record.nick
        : typeof record.name === "string"
          ? record.name
          : typeof record.display_name === "string"
            ? record.display_name
            : typeof record.displayName === "string"
              ? record.displayName
              : undefined,
  );
  const username = normalizeUsername(
    record.Username ??
      record.username ??
      record.user_name ??
      record.userName,
  );
  const userId = toUserIdString(record.Id ?? record.id ?? explicitUserId ?? rawKey);
  if (!userId) {
    return null;
  }
  if (!explicitUserId && !groupNick && !nick && !username) {
    return null;
  }
  const displayName = groupNick ?? nick ?? (username ? `@${username}` : `用户(${userId})`);
  return {
    userId,
    displayName,
    username,
    nick: nick ?? undefined,
    groupNick: groupNick ?? undefined,
  };
}

function extractGroupMemberCandidates(payload: unknown): GroupMemberCandidate[] {
  const byUserId = new Map<string, GroupMemberCandidate>();
  const visited = new Set<object>();

  const upsertCandidate = (candidate: GroupMemberCandidate | null): void => {
    if (!candidate) {
      return;
    }
    const existing = byUserId.get(candidate.userId);
    if (!existing) {
      byUserId.set(candidate.userId, candidate);
      return;
    }
    byUserId.set(candidate.userId, {
      ...existing,
      displayName:
        existing.displayName.startsWith("用户(") && !candidate.displayName.startsWith("用户(")
          ? candidate.displayName
          : existing.displayName,
      username: existing.username ?? candidate.username,
      nick: existing.nick ?? candidate.nick,
      groupNick: existing.groupNick ?? candidate.groupNick,
    });
  };

  const parseMemberContainer = (container: unknown): void => {
    if (Array.isArray(container)) {
      for (const entry of container) {
        upsertCandidate(parseGroupMemberCandidate(undefined, entry));
      }
      return;
    }
    const record = asRecord(container);
    if (!record) {
      return;
    }
    for (const [rawKey, rawValue] of Object.entries(record)) {
      upsertCandidate(parseGroupMemberCandidate(rawKey, rawValue));
    }
  };

  const walk = (node: unknown, depth: number): void => {
    if (depth > 5) {
      return;
    }
    const record = asRecord(node);
    if (!record) {
      return;
    }
    if (visited.has(record)) {
      return;
    }
    visited.add(record);

    upsertCandidate(parseGroupMemberCandidate(undefined, record));

    const membersNodeCandidates = [
      record.Member,
      record.member,
      record.Items,
      record.items,
      asRecord(record.Members)?.Member,
      asRecord(record.Members)?.member,
      asRecord(record.members)?.Member,
      asRecord(record.members)?.member,
    ];
    for (const candidate of membersNodeCandidates) {
      parseMemberContainer(candidate);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        walk(value, depth + 1);
      }
    }
  };

  walk(payload, 0);
  return Array.from(byUserId.values());
}

function scoreGroupMemberCandidate(
  candidate: GroupMemberCandidate,
  keyword: string,
  senderId: string,
): number {
  const token = normalizeLookupToken(keyword);
  if (!token) {
    return 0;
  }
  const names = [
    candidate.displayName,
    candidate.groupNick,
    candidate.nick,
    candidate.username,
    candidate.userId,
  ];
  let score = 0;
  for (const rawName of names) {
    const name = normalizeLookupToken(rawName);
    if (!name) {
      continue;
    }
    if (name === token) {
      score = Math.max(score, 120);
      continue;
    }
    if (name.startsWith(token)) {
      score = Math.max(score, 105);
      continue;
    }
    if (token.startsWith(name) && name.length >= 2) {
      score = Math.max(score, 95);
      continue;
    }
    if (name.includes(token)) {
      score = Math.max(score, 85);
      continue;
    }
    if (token.includes(name) && name.length >= 2) {
      score = Math.max(score, 75);
    }
  }
  if (candidate.userId === senderId) {
    score -= 20;
  }
  return score;
}

async function lookupMuteTargetCandidateFromGroupMembers(params: {
  client: ZapryApiClient;
  parsed: ParsedInboundMessage;
  intent: MuteCommandIntent;
  log?: RuntimeLog;
}): Promise<InboundTargetUserHint | null> {
  const keyword = extractTargetKeywordFromMuteText(params.parsed.sourceText);
  if (!keyword) {
    return null;
  }

  try {
    let candidates: GroupMemberCandidate[] = [];
    const memberResp = await params.client.getChatMembers(params.parsed.chatId, {
      page: 1,
      pageSize: 50,
      keyword,
    });
    if (memberResp?.ok) {
      candidates = extractGroupMemberCandidates(memberResp.result);
    } else {
      params.log?.warn?.(
        `[zapry] getChatMembers lookup failed for chat ${params.parsed.chatId}: ` +
          `${memberResp?.description ?? "unknown"}, fallback to getChatAdministrators`,
      );
      const adminResp = await params.client.getChatAdministrators(params.parsed.chatId);
      if (!adminResp?.ok) {
        params.log?.warn?.(
          `[zapry] fallback getChatAdministrators lookup failed for chat ${params.parsed.chatId}: ` +
            `${adminResp?.description ?? "unknown"}`,
        );
        return null;
      }
      candidates = extractGroupMemberCandidates(adminResp.result);
    }
    if (!candidates.length) {
      return null;
    }
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scoreGroupMemberCandidate(candidate, keyword, params.parsed.senderId),
      }))
      .sort((a, b) => b.score - a.score);
    if (!scored[0] || scored[0].score < 80) {
      return null;
    }

    const top = scored[0].candidate;
    return {
      userId: top.userId,
      username: top.username,
      displayName: top.displayName,
      source: "mentioned_users",
      raw: `member_lookup:${keyword}`,
    };
  } catch (error) {
    params.log?.warn?.(
      `[zapry] member lookup threw for chat ${params.parsed.chatId}: ${String(error)}`,
    );
    return null;
  }
}

function isLikelyAudioGenerationIntent(text: string | undefined): boolean {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    "生成音频",
    "做个音频",
    "做一个音频",
    "做铃声",
    "生成铃声",
    "生成mp3",
    "输出mp3",
    "配音",
    "朗读",
    "tts",
    "generate audio",
    "make audio",
    "ringtone",
    "render audio",
  ].some((token) => normalized.includes(token));
}

function formatMuteTargetLabel(hint: InboundTargetUserHint): string {
  if (hint.displayName?.trim()) {
    return `“${hint.displayName.trim()}”`;
  }
  if (hint.username?.trim()) {
    return `@${hint.username.trim()}`;
  }
  return `用户(${hint.userId})`;
}

function getMuteActionLabel(intent: MuteCommandIntent): string {
  return intent === "mute" ? "禁言" : "解除禁言";
}

function buildMuteTargetMissingText(intent: MuteCommandIntent): string {
  const action = getMuteActionLabel(intent);
  return `我还没定位到目标成员。请直接 @ 目标成员，或回复目标成员那条消息后再发“${action}”。`;
}

function buildMuteCandidateConfirmText(
  intent: MuteCommandIntent,
  targetHint: InboundTargetUserHint,
): string {
  const confirmPhrase = intent === "mute" ? "确认禁言" : "确认解除禁言";
  const label = formatMuteTargetLabel(targetHint);
  return `我在本群匹配到候选成员：${label}（user_id: ${targetHint.userId}）。回复“${confirmPhrase}”执行，回复“取消”结束。`;
}

function buildMuteCancelText(intent: MuteCommandIntent): string {
  return `已取消本次${getMuteActionLabel(intent)}操作。`;
}

function buildMuteDisambiguationText(
  intent: MuteCommandIntent,
  targetUserHints: InboundTargetUserHint[],
): string {
  const action = getMuteActionLabel(intent);
  const candidateText = targetUserHints
    .slice(0, 3)
    .map((hint) => formatMuteTargetLabel(hint))
    .join("、");
  if (!candidateText) {
    return `识别到多个候选成员，暂不执行以避免误操作。请直接 @ 目标成员，或回复其消息后再发“${action}”。`;
  }
  return `识别到多个候选成员（${candidateText}），暂不执行以避免误操作。请直接 @ 目标成员，或回复其消息后再发“${action}”。`;
}

function buildMuteSuccessText(intent: MuteCommandIntent, targetHint: InboundTargetUserHint): string {
  const label = formatMuteTargetLabel(targetHint);
  return intent === "mute" ? `已将${label}禁言。` : `已解除${label}禁言。`;
}

function buildMuteFailureText(intent: MuteCommandIntent, errorCode?: number, description?: string): string {
  if (errorCode === 403) {
    return "操作失败：我还没有群管理权限，请先把我设为管理员后重试。";
  }
  if (errorCode === 429) {
    return "操作过于频繁，请稍后再试。";
  }
  const normalizedDesc = description?.toLowerCase() ?? "";
  if (errorCode === 404 || normalizedDesc.includes("not found")) {
    return "操作失败：未找到目标成员，请重新 @ 该成员后再试。";
  }
  return `操作失败：${getMuteActionLabel(intent)}未成功，请稍后重试。`;
}

async function sendModerationQuickReply(params: {
  account: ResolvedZapryAccount;
  chatId: string;
  text: string;
  statusSink?: StatusSink;
  log?: RuntimeLog;
}): Promise<boolean> {
  const { account, chatId, text, statusSink, log } = params;
  const result = await sendMessageZapry(account, `chat:${chatId}`, text);
  if (!result.ok) {
    log?.warn?.(
      `[${account.accountId}] moderation quick reply failed: ${result.error ?? "unknown"}`,
    );
    return false;
  }
  statusSink?.({ lastOutboundAt: Date.now() });
  return true;
}

async function executeMuteCommandWithTarget(params: {
  client: ZapryApiClient;
  account: ResolvedZapryAccount;
  parsed: ParsedInboundMessage;
  intent: MuteCommandIntent;
  targetHint: InboundTargetUserHint;
  statusSink?: StatusSink;
  log?: RuntimeLog;
}): Promise<boolean> {
  const { client, account, parsed, intent, targetHint, statusSink, log } = params;
  try {
    const resp = await client.muteChatMember(parsed.chatId, targetHint.userId, intent === "mute");
    if (resp.ok) {
      await sendModerationQuickReply({
        account,
        chatId: parsed.chatId,
        text: buildMuteSuccessText(intent, targetHint),
        statusSink,
        log,
      });
      return true;
    }
    await sendModerationQuickReply({
      account,
      chatId: parsed.chatId,
      text: buildMuteFailureText(intent, resp.error_code, resp.description),
      statusSink,
      log,
    });
    return true;
  } catch (error) {
    log?.warn?.(`[${account.accountId}] mute quick path failed: ${String(error)}`);
    await sendModerationQuickReply({
      account,
      chatId: parsed.chatId,
      text: buildMuteFailureText(intent),
      statusSink,
      log,
    });
    return true;
  }
}

async function tryHandleMuteCommandQuickPath(params: {
  account: ResolvedZapryAccount;
  parsed: ParsedInboundMessage;
  statusSink?: StatusSink;
  log?: RuntimeLog;
}): Promise<boolean> {
  const { account, parsed, statusSink, log } = params;
  if (!parsed.isGroup) {
    return false;
  }
  const pending = getPendingMuteConfirmation(parsed.chatId, parsed.senderId);
  const confirmDecision = resolveMuteConfirmationDecision(parsed.sourceText);
  if (pending && confirmDecision) {
    clearPendingMuteConfirmation(parsed.chatId, parsed.senderId);
    if (confirmDecision === "cancel") {
      return sendModerationQuickReply({
        account,
        chatId: parsed.chatId,
        text: buildMuteCancelText(pending.intent),
        statusSink,
        log,
      });
    }
    const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
    return executeMuteCommandWithTarget({
      client,
      account,
      parsed,
      intent: pending.intent,
      targetHint: pending.target,
      statusSink,
      log,
    });
  }

  if (!isLikelyMuteCommandMessage(parsed.sourceText, parsed.targetUserHints)) {
    return false;
  }
  const intent = resolveMuteCommandIntent(parsed.sourceText);
  if (!intent) {
    return false;
  }

  if (pending) {
    clearPendingMuteConfirmation(parsed.chatId, parsed.senderId);
  }

  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
  if (parsed.targetUserHints.length === 0) {
    const lookedUpTarget = await lookupMuteTargetCandidateFromGroupMembers({
      client,
      parsed,
      intent,
      log,
    });
    if (lookedUpTarget) {
      setPendingMuteConfirmation({
        chatId: parsed.chatId,
        senderId: parsed.senderId,
        intent,
        target: lookedUpTarget,
        createdAtMs: Date.now(),
      });
      return sendModerationQuickReply({
        account,
        chatId: parsed.chatId,
        text: buildMuteCandidateConfirmText(intent, lookedUpTarget),
        statusSink,
        log,
      });
    }
    return sendModerationQuickReply({
      account,
      chatId: parsed.chatId,
      text: buildMuteTargetMissingText(intent),
      statusSink,
      log,
    });
  }

  if (parsed.targetUserHints.length > 1) {
    return sendModerationQuickReply({
      account,
      chatId: parsed.chatId,
      text: buildMuteDisambiguationText(intent, parsed.targetUserHints),
      statusSink,
      log,
    });
  }

  return executeMuteCommandWithTarget({
    client,
    account,
    parsed,
    intent,
    targetHint: parsed.targetUserHints[0],
    statusSink,
    log,
  });
}

export async function tryHandleZapryInboundQuickPaths(params: {
  account: ResolvedZapryAccount;
  update: any;
  statusSink?: StatusSink;
  log?: RuntimeLog;
}): Promise<boolean> {
  const parsed = parseInboundMessage(params.update);
  if (!parsed) {
    return false;
  }
  const handledByMuteQuickPath = await tryHandleMuteCommandQuickPath({
    account: params.account,
    parsed,
    statusSink: params.statusSink,
    log: params.log,
  });
  if (handledByMuteQuickPath) {
    params.statusSink?.({ lastInboundAt: Date.now() });
    return true;
  }
  return false;
}

function summarizeMediaItem(item: ParsedInboundMediaItem): string {
  const parts: string[] = [item.kind];
  if (item.sourceTag === "video-thumb") {
    parts.push("source=video_thumb");
  } else if (item.sourceTag === "video-keyframe") {
    parts.push("source=video_keyframe");
  }
  if (item.fileId) {
    parts.push(`file_id=${item.fileId}`);
  }
  if (item.url) {
    parts.push(`url=${item.url}`);
  }
  if (item.mimeType) {
    parts.push(`mime=${item.mimeType}`);
  }
  if (item.fileName) {
    parts.push(`name=${item.fileName}`);
  }
  if (item.duration !== undefined) {
    parts.push(`duration=${item.duration}`);
  }
  if (item.width !== undefined && item.height !== undefined) {
    parts.push(`size=${item.width}x${item.height}`);
  }
  if (item.fileSize !== undefined) {
    parts.push(`bytes=${item.fileSize}`);
  }
  if (item.resolvedFile?.downloadUrl) {
    parts.push("resolved=authorized_url");
  } else if (item.resolvedFile?.error) {
    parts.push(`resolve_error=${item.resolvedFile.error}`);
  }
  if (item.resolvedThumbFile?.downloadUrl) {
    parts.push("thumb_resolved=authorized_url");
  }
  return parts.join(" | ");
}

function buildInboundBody(
  sourceText: string | undefined,
  mediaItems: ParsedInboundMediaItem[],
  transcript?: string,
  targetUserHints: InboundTargetUserHint[] = [],
): string {
  const normalizedText = sourceText?.trim();
  const transcriptRequested = isExplicitTranscriptRequest(normalizedText);
  if (!mediaItems.length) {
    if (!normalizedText && targetUserHints.length === 0) {
      return "";
    }
    if (targetUserHints.length === 0) {
      return normalizedText ?? "";
    }
    const lines: string[] = [];
    if (normalizedText) {
      lines.push(normalizedText, "");
    } else {
      lines.push("收到一条文本消息。", "");
    }
    lines.push("[群管理目标候选]");
    for (const hint of targetUserHints) {
      lines.push(`- ${summarizeTargetUserHint(hint)}`);
    }
    lines.push(
      "- 若本轮涉及禁言/移出群，优先使用上述 user_id，避免再次向用户索要 ID。",
      "- `mute-chat-member` 仅支持 `mute=true/false`，不支持时长参数。",
      "",
      "[群管理目标结构化数据]",
      "```json",
      JSON.stringify({ targetUsers: targetUserHints }, null, 2),
      "```",
    );
    return lines.join("\n");
  }
  const stageErrors = mediaItems
    .map((item) => item.stageError)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const hasStagedMedia = mediaItems.some((item) => Boolean(item.stagedPath));

  const lines: string[] = [];
  if (normalizedText) {
    lines.push(normalizedText, "");
  } else {
    lines.push("收到一条媒体消息。", "");
  }

  lines.push("[媒体处理约定]");
  if (normalizedText) {
    lines.push("- 用户已经给出文字要求，请优先按该要求处理媒体内容。");
  } else {
    lines.push("- 用户未附加文字时，默认直接理解并分析媒体内容，不要先追问是否需要解析。");
  }
  lines.push("- 如果结构化数据里已经有 file_id，优先把它视为主读取链路，不要依赖兼容 URL。");
  lines.push("- 插件会在内部完成 get-file 与媒体下载；模型不应再把 URL 当成主链路。");
  if (mediaItems.length > 0 && mediaItems.every((item) => isAudioLikeMedia(item))) {
    lines.push("- 若这是纯语音/音频消息，默认本轮直接输出转写；若还能总结，再补 1-3 条要点。");
    lines.push("- 禁止只回复“我已收到”“我现在开始转写”“稍后给你结果”之类进度说明。");
  }
  lines.push("- 只有在媒体本体下载失败或权限失败时，才向用户说明并请求重试。", "");

  if (targetUserHints.length > 0) {
    lines.push("[群管理目标候选]");
    for (const hint of targetUserHints) {
      lines.push(`- ${summarizeTargetUserHint(hint)}`);
    }
    lines.push("- 若本轮涉及禁言/移出群，优先使用上述 user_id，避免再次向用户索要 ID。", "");
  }

  const keyframeItems = mediaItems.filter((item) => item.sourceTag === "video-keyframe");
  if (keyframeItems.length > 0) {
    lines.push("[视频关键帧说明]");
    lines.push(`- 以下 ${keyframeItems.length} 张图片是从视频中按时间均匀抽取的关键帧，已按时间顺序排列。`);
    lines.push("- 请结合所有关键帧来理解视频的完整内容、场景变化和动作序列。");
    lines.push("- 关键帧文件名中的 at-Xs 表示该帧在视频中的时间位置（秒）。");
    lines.push("- 回复时请综合所有帧信息进行整体分析，不要逐帧罗列。", "");
  }

  if (!hasStagedMedia && stageErrors.length > 0) {
    lines.push("[媒体下载状态]");
    lines.push("- 当前媒体本体下载失败，禁止根据历史上下文猜测图片/视频/文件内容。");
    lines.push("- 只允许向用户说明当前无法读取该媒体，并建议稍后重试或改用文件/原图方式发送。");
    lines.push("- 最近错误：");
    for (const err of stageErrors.slice(0, 3)) {
      lines.push(`  - ${err}`);
    }
    lines.push("");
  }
  const transcriptItems = mediaItems.filter(
    (item): item is ParsedInboundMediaItem & { transcript: string } =>
      isAudioLikeMedia(item) && typeof item.transcript === "string" && item.transcript.trim().length > 0,
  );
  const transcriptErrors = mediaItems
    .filter((item) => isAudioLikeMedia(item) && typeof item.transcriptError === "string" && item.transcriptError.trim().length > 0)
    .map((item) => item.transcriptError as string);
  if (transcriptItems.length > 0) {
    if (transcriptRequested) {
      lines.push("[语音转写结果]");
      if (transcript?.trim()) {
        lines.push(transcript.trim());
      } else {
        for (const [index, item] of transcriptItems.entries()) {
          lines.push(`- 音频${index + 1}: ${item.transcript}`);
        }
      }
      lines.push("- 用户明确要求转写/转文字时，可以直接输出上述真实转写文本。", "");
    } else {
      lines.push("[内部语音理解]");
      lines.push("- 以下是真实转写，仅供理解用户意图，默认不要回显给用户：");
      if (transcript?.trim()) {
        lines.push(transcript.trim());
      } else {
        for (const [index, item] of transcriptItems.entries()) {
          lines.push(`- 音频${index + 1}: ${item.transcript}`);
        }
      }
      lines.push("- 请把它当成用户本轮真实输入，直接回复其意图。只有用户明确要求“转文字/逐字稿”时，才输出转写文本本身。", "");
    }
  } else if (mediaItems.some((item) => isAudioLikeMedia(item) && item.stagedPath) && transcriptErrors.length > 0) {
    lines.push("[语音转写状态]");
    lines.push("- 当前未拿到真实转写文本，禁止根据历史上下文或用户追问文本猜测音频内容。");
    lines.push("- 最近错误：");
    for (const err of transcriptErrors.slice(0, 3)) {
      lines.push(`  - ${err}`);
    }
    lines.push("");
  }

  lines.push("[媒体信息]");
  for (const item of mediaItems) {
    lines.push(`- ${summarizeMediaItem(item)}`);
  }

  const structuredPayload: Record<string, unknown> = { media: mediaItems };
  if (targetUserHints.length > 0) {
    structuredPayload.targetUsers = targetUserHints;
  }
  lines.push("", "[媒体结构化数据]", "```json", JSON.stringify(structuredPayload, null, 2), "```");
  return lines.join("\n");
}

function parseInboundMessage(update: any): ParsedInboundMessage | null {
  const message = asRecord(update?.message);
  if (!message) {
    return null;
  }

  const sourceText = asNonEmptyString(message.text) ?? asNonEmptyString(message.caption);
  const mediaItems = extractInboundMediaItems(message);
  const targetUserHints = extractTargetUserHints(message, sourceText);
  if (!sourceText && mediaItems.length === 0) {
    return null;
  }

  const chat = (message.chat ?? {}) as Record<string, unknown>;
  const from = (message.from ?? message.sender ?? {}) as Record<string, unknown>;

  const chatId =
    asNonEmptyString(chat.id != null ? String(chat.id) : undefined) ??
    asNonEmptyString(message.chat_id != null ? String(message.chat_id) : undefined) ??
    asNonEmptyString(message.chatId != null ? String(message.chatId) : undefined);
  if (!chatId) {
    return null;
  }

  const senderId =
    asNonEmptyString(from.id != null ? String(from.id) : undefined) ??
    asNonEmptyString(message.sender_id != null ? String(message.sender_id) : undefined) ??
    asNonEmptyString(message.from_id != null ? String(message.from_id) : undefined) ??
    chatId;

  const senderName =
    asNonEmptyString(from.name) ??
    asNonEmptyString(from.username) ??
    asNonEmptyString(from.first_name) ??
    asNonEmptyString(message.sender_name);

  const chatType = asNonEmptyString(chat.type);
  const isGroup =
    chatType === "group" ||
    chatType === "supergroup" ||
    chatType === "channel" ||
    chatId !== senderId;

  const messageSid = String(message.message_id ?? update?.update_id ?? Date.now());

  return {
    sourceText,
    mediaItems,
    senderId,
    senderName,
    targetUserHints,
    chatId,
    chatType,
    isGroup,
    messageSid,
    timestampMs:
      parseTimestampMs(message.date) ??
      parseTimestampMs(message.timestamp) ??
      parseTimestampMs(update?.date),
  };
}

async function resolveInboundFile(
  client: ZapryApiClient,
  fileId: string,
  log?: RuntimeLog,
): Promise<ResolvedInboundFile> {
  try {
    const response = await withTimeout(
      client.getFile(fileId),
      INBOUND_FILE_RESOLVE_TIMEOUT_MS,
      `resolve inbound file ${fileId}`,
    );
    if (!response?.ok) {
      const error = response?.description?.trim() || "get-file failed";
      log?.warn?.(`[zapry] resolve inbound file failed for ${fileId}: ${error}`);
      return { fileId, error };
    }

    const result = asRecord(response.result);
    const downloadUrl = asNonEmptyString(result?.download_url ?? result?.file_path);
    if (!downloadUrl) {
      const error = "get-file returned no download_url";
      log?.warn?.(`[zapry] resolve inbound file missing download_url for ${fileId}`);
      return { fileId, error };
    }

    return {
      fileId,
      downloadUrl,
      downloadMethod: asNonEmptyString(result?.download_method),
      downloadHeaders: normalizeStringRecord(result?.download_headers),
      expiresAt: asNonEmptyString(result?.expires_at),
      contentType: asNonEmptyString(result?.content_type),
      fileSize: parseFiniteNumber(result?.file_size),
      fileName: asNonEmptyString(result?.file_name),
    };
  } catch (error) {
    const message = String(error);
    log?.warn?.(`[zapry] resolve inbound file threw for ${fileId}: ${message}`);
    return { fileId, error: message };
  }
}

async function enrichInboundMediaItems(
  account: ResolvedZapryAccount,
  mediaItems: ParsedInboundMediaItem[],
  log?: RuntimeLog,
): Promise<ParsedInboundMediaItem[]> {
  if (!mediaItems.length) {
    return mediaItems;
  }

  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);
  const resolveCache = new Map<string, Promise<ResolvedInboundFile>>();
  const getResolvedFile = (fileId: string): Promise<ResolvedInboundFile> => {
    const existing = resolveCache.get(fileId);
    if (existing) {
      return existing;
    }
    const pending = resolveInboundFile(client, fileId, log);
    resolveCache.set(fileId, pending);
    return pending;
  };

  return Promise.all(
    mediaItems.map(async (item) => {
      const resolvedFile = item.fileId ? await getResolvedFile(item.fileId) : undefined;
      const resolvedThumbFile = item.thumbFileId ? await getResolvedFile(item.thumbFileId) : undefined;

      const enriched: ParsedInboundMediaItem = {
        ...item,
        resolvedFile,
        resolvedThumbFile,
      };

      if (!enriched.mimeType && resolvedFile?.contentType) {
        enriched.mimeType = resolvedFile.contentType;
      }
      if (enriched.fileSize === undefined && resolvedFile?.fileSize !== undefined) {
        enriched.fileSize = resolvedFile.fileSize;
      }
      if (!enriched.fileName && resolvedFile?.fileName) {
        enriched.fileName = resolvedFile.fileName;
      }
      if (!enriched.url && resolvedFile?.downloadUrl) {
        enriched.url = resolvedFile.downloadUrl;
      }
      if (!enriched.thumbUrl && resolvedThumbFile?.downloadUrl) {
        enriched.thumbUrl = resolvedThumbFile.downloadUrl;
      }

      return enriched;
    }),
  );
}

function resolveRuntime(explicitRuntime?: any): any | null {
  const isPluginRuntime = (candidate: any): boolean =>
    typeof candidate?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher === "function";

  if (isPluginRuntime(explicitRuntime)) {
    return explicitRuntime;
  }
  try {
    const fallback = getZapryRuntime();
    return isPluginRuntime(fallback) ? fallback : null;
  } catch {
    return null;
  }
}

function resolveConfig(explicitCfg: any, runtime: any): any {
  if (explicitCfg) {
    return explicitCfg;
  }
  const loadConfig = runtime?.config?.loadConfig;
  if (typeof loadConfig === "function") {
    try {
      return loadConfig();
    } catch {
      return {};
    }
  }
  return {};
}

function resolveStorePath(runtime: any, cfg: any, agentId?: string): string | undefined {
  const resolver = runtime?.channel?.session?.resolveStorePath;
  if (typeof resolver !== "function") {
    return undefined;
  }
  try {
    return resolver(cfg?.session?.store, { agentId });
  } catch {
    return undefined;
  }
}

function resolveRoute(params: {
  runtime: any;
  cfg: any;
  accountId: string;
  peer: { kind: "group" | "direct"; id: string };
}): { agentId: string; accountId: string; sessionKey: string } {
  const resolver = params.runtime?.channel?.routing?.resolveAgentRoute;
  if (typeof resolver === "function") {
    try {
      const route = resolver({
        cfg: params.cfg,
        channel: "zapry",
        accountId: params.accountId,
        peer: params.peer,
      });
      if (
        route &&
        typeof route.agentId === "string" &&
        typeof route.accountId === "string" &&
        typeof route.sessionKey === "string"
      ) {
        return route;
      }
    } catch {
      // fall through to local fallback
    }
  }
  return {
    agentId: "main",
    accountId: params.accountId,
    sessionKey: `agent:main:zapry:${params.peer.kind}:${params.peer.id}`,
  };
}

function extractMediaUrls(payload: any): string[] {
  const urls: string[] = [];

  if (Array.isArray(payload?.mediaUrls)) {
    for (const item of payload.mediaUrls) {
      if (typeof item === "string" && item.trim()) {
        urls.push(item.trim());
      }
    }
  }

  if (typeof payload?.mediaUrl === "string" && payload.mediaUrl.trim()) {
    urls.push(payload.mediaUrl.trim());
  }

  return urls;
}

async function deliverZapryReply(params: {
  runtime: any;
  cfg: any;
  account: ResolvedZapryAccount;
  chatId: string;
  payload: any;
  statusSink?: StatusSink;
  log?: RuntimeLog;
}): Promise<void> {
  const { runtime, cfg, account, chatId, payload, statusSink, log } = params;

  const textRuntime = runtime?.channel?.text;
  const tableMode =
    typeof textRuntime?.resolveMarkdownTableMode === "function"
      ? textRuntime.resolveMarkdownTableMode({
          cfg,
          channel: "zapry",
          accountId: account.accountId,
        })
      : "code";

  let text = typeof payload?.text === "string" ? payload.text : "";
  if (typeof textRuntime?.convertMarkdownTables === "function") {
    try {
      text = textRuntime.convertMarkdownTables(text, tableMode);
    } catch {
      // Keep original text when table conversion fails.
    }
  }

  const mediaUrls = extractMediaUrls(payload);
  for (const mediaUrl of mediaUrls) {
    const mediaResult = await sendMessageZapry(account, `chat:${chatId}`, "", { mediaUrl });
    if (!mediaResult.ok) {
      log?.warn?.(`[${account.accountId}] Zapry media reply failed: ${mediaResult.error ?? "unknown"}`);
      continue;
    }
    statusSink?.({ lastOutboundAt: Date.now() });
  }

  if (!text.trim()) {
    return;
  }

  const chunkMode =
    typeof textRuntime?.resolveChunkMode === "function"
      ? textRuntime.resolveChunkMode(cfg, "zapry", account.accountId)
      : undefined;
  const chunks =
    typeof textRuntime?.chunkMarkdownTextWithMode === "function"
      ? textRuntime.chunkMarkdownTextWithMode(text, 4096, chunkMode)
      : [text];

  const normalizedChunks = Array.isArray(chunks) && chunks.length > 0 ? chunks : [text];
  for (const chunk of normalizedChunks) {
    if (typeof chunk !== "string" || !chunk.trim()) {
      continue;
    }
    const textResult = await sendMessageZapry(account, `chat:${chatId}`, chunk);
    if (!textResult.ok) {
      log?.warn?.(`[${account.accountId}] Zapry text reply failed: ${textResult.error ?? "unknown"}`);
      continue;
    }
    statusSink?.({ lastOutboundAt: Date.now() });
  }
}

export async function processZapryInboundUpdate(params: ProcessInboundParams): Promise<boolean> {
  const { account, update, statusSink, log } = params;
  const parsed = parseInboundMessage(update);
  if (!parsed) {
    return false;
  }

  const handledByMuteQuickPath = await tryHandleMuteCommandQuickPath({
    account,
    parsed,
    statusSink,
    log,
  });
  if (handledByMuteQuickPath) {
    statusSink?.({ lastInboundAt: Date.now() });
    return true;
  }

  const runtime = resolveRuntime(params.runtime);
  if (!runtime) {
    return false;
  }

  const dispatchReply = runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (typeof dispatchReply !== "function") {
    return false;
  }

  const cfg = resolveConfig(params.cfg, runtime);
  const resolvedMediaItems = await enrichInboundMediaItems(account, parsed.mediaItems, log);
  const expandedMediaItems = appendVideoThumbnailMediaItems(resolvedMediaItems);
  const stagedMediaItems = await stageInboundMediaItems(runtime, expandedMediaItems, log);
  const finalizedMediaItems = await appendVideoKeyframeItems(runtime, stagedMediaItems, log);
  const { mediaItems, transcript } = await transcribeInboundAudioItems(runtime, cfg, finalizedMediaItems, log);
  const agentMediaItems = sanitizeMediaItemsForAgent(mediaItems);
  const rawBody = buildInboundBody(
    parsed.sourceText,
    agentMediaItems,
    transcript,
    parsed.targetUserHints,
  );
  if (!rawBody) {
    return false;
  }
  const commandBody = resolveCommandBody(
    parsed.sourceText,
    mediaItems,
    transcript,
    parsed.targetUserHints,
  );
  const stagedMedia = mediaItems.flatMap((item) =>
    item.stagedPath
      ? [
          {
            path: item.stagedPath,
            url: item.resolvedFile?.downloadUrl ?? item.url ?? item.stagedPath,
            mimeType: item.stagedMimeType ?? item.mimeType,
          },
        ]
      : [],
  );
  const mediaPaths = stagedMedia.map((item) => item.path);
  const mediaTypes = stagedMedia.map((item) => item.mimeType);

  const route = resolveRoute({
    runtime,
    cfg,
    accountId: account.accountId,
    peer: {
      kind: parsed.isGroup ? "group" : "direct",
      id: parsed.chatId,
    },
  });

  const storePath = resolveStorePath(runtime, cfg, route.agentId);
  const previousTimestamp =
    typeof runtime?.channel?.session?.readSessionUpdatedAt === "function" && storePath
      ? runtime.channel.session.readSessionUpdatedAt({
          storePath,
          sessionKey: route.sessionKey,
        })
      : undefined;

  const envelopeOptions =
    typeof runtime?.channel?.reply?.resolveEnvelopeFormatOptions === "function"
      ? runtime.channel.reply.resolveEnvelopeFormatOptions(cfg)
      : undefined;

  const fromLabel = parsed.isGroup
    ? parsed.chatType === "channel"
      ? `channel:${parsed.chatId}`
      : `group:${parsed.chatId}`
    : parsed.senderName || `user:${parsed.senderId}`;

  const body =
    typeof runtime?.channel?.reply?.formatAgentEnvelope === "function"
      ? runtime.channel.reply.formatAgentEnvelope({
          channel: "Zapry",
          from: fromLabel,
          timestamp: parsed.timestampMs,
          previousTimestamp,
          envelope: envelopeOptions,
          body: rawBody,
        })
      : rawBody;

  const inboundCtxBase = {
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: commandBody,
    From: parsed.isGroup ? `zapry:group:${parsed.chatId}` : `zapry:${parsed.senderId}`,
    To: `zapry:${parsed.chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: parsed.isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: parsed.senderName || undefined,
    SenderId: parsed.senderId,
    TargetUserHints: parsed.targetUserHints.length > 0 ? parsed.targetUserHints : undefined,
    MentionedUserIds:
      parsed.targetUserHints.length > 0 ? parsed.targetUserHints.map((item) => item.userId) : undefined,
    TargetUserId:
      parsed.targetUserHints.length === 1 ? parsed.targetUserHints[0].userId : undefined,
    Provider: "zapry",
    Surface: "zapry",
    MessageSid: parsed.messageSid,
    Transcript: transcript || undefined,
    HasMedia: mediaItems.length > 0,
    MediaItems: agentMediaItems,
    MediaKinds: agentMediaItems.map((item) => item.kind),
    MediaPath: mediaPaths[0],
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaType: mediaTypes[0],
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
    OriginatingChannel: "zapry",
    OriginatingTo: `zapry:${parsed.chatId}`,
  };

  const ctxPayload =
    typeof runtime?.channel?.reply?.finalizeInboundContext === "function"
      ? runtime.channel.reply.finalizeInboundContext(inboundCtxBase)
      : inboundCtxBase;

  if (typeof runtime?.channel?.session?.recordInboundSession === "function" && storePath) {
    await runtime.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err: unknown) => {
        log?.warn?.(`[${account.accountId}] zapry session meta update failed: ${String(err)}`);
      },
    });
  }

  statusSink?.({ lastInboundAt: Date.now() });

  await dispatchReply({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      deliver: async (payload: any) => {
        await deliverZapryReply({
          runtime,
          cfg,
          account,
          chatId: parsed.chatId,
          payload,
          statusSink,
          log,
        });
      },
      onError: (err: unknown, info: { kind?: string }) => {
        log?.warn?.(
          `[${account.accountId}] Zapry ${info?.kind ?? "reply"} dispatch failed: ${String(err)}`,
        );
      },
    },
  });

  return true;
}
