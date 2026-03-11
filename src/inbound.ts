import { ZapryApiClient } from "./api-client.js";
import { getZapryRuntime } from "./runtime.js";
import { sendMessageZapry } from "./send.js";
import type { ResolvedZapryAccount } from "./types.js";

type RuntimeLog = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
};

type StatusSink = (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;

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
};

type ParsedInboundMessage = {
  sourceText?: string;
  mediaItems: ParsedInboundMediaItem[];
  senderId: string;
  senderName?: string;
  chatId: string;
  chatType?: string;
  isGroup: boolean;
  messageSid: string;
  timestampMs?: number;
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
const INBOUND_MEDIA_MAX_BYTES_BY_KIND: Record<ParsedInboundMediaKind, number> = {
  photo: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  voice: 25 * 1024 * 1024,
  animation: 25 * 1024 * 1024,
};

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

function resolveCommandBody(sourceText: string | undefined, mediaItems: ParsedInboundMediaItem[]): string {
  const hasMedia = mediaItems.length > 0;
  const hasStagedMedia = mediaItems.some((item) => Boolean(item.stagedPath));
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
  if (normalizedText) {
    return normalizedText;
  }
  if (!mediaItems.length) {
    return "";
  }
  const mediaKindText = describeMediaKinds(mediaItems) || "媒体";
  return `请直接查看并分析这条${mediaKindText}消息，优先使用已提供的 file_id 或 download_url，不要先询问是否需要解析。`;
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

function parseMediaObject(kind: ParsedInboundMediaKind, raw: unknown): ParsedInboundMediaItem | null {
  const media = asRecord(raw);
  if (!media) {
    return null;
  }
  const thumb = asRecord(media.thumb) ?? asRecord(media.thumbnail);

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
    thumbFileId: asNonEmptyString(thumb?.file_id ?? thumb?.fileId),
    thumbUrl: asNonEmptyString(thumb?.url ?? thumb?.remotePath),
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

function summarizeMediaItem(item: ParsedInboundMediaItem): string {
  const parts: string[] = [item.kind];
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

function buildInboundBody(sourceText: string | undefined, mediaItems: ParsedInboundMediaItem[]): string {
  const normalizedText = sourceText?.trim();
  if (!mediaItems.length) {
    return normalizedText ?? "";
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
  lines.push("- 如果结构化数据里已经有 resolvedFile.downloadUrl，请把它当作可直接访问的授权媒体地址。");
  lines.push("- 只有在 download_url 缺失、失效或权限失败时，才向用户说明并请求重试。");
  lines.push("- 如果只有 file_id 且没有 resolvedFile.downloadUrl，请立即调用 get-file(file_id)，参数只能传 file_id。", "");
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

  lines.push("[媒体信息]");
  for (const item of mediaItems) {
    lines.push(`- ${summarizeMediaItem(item)}`);
  }

  lines.push("", "[媒体结构化数据]", "```json", JSON.stringify({ media: mediaItems }, null, 2), "```");
  return lines.join("\n");
}

function parseInboundMessage(update: any): ParsedInboundMessage | null {
  const message = asRecord(update?.message);
  if (!message) {
    return null;
  }

  const sourceText = asNonEmptyString(message.text) ?? asNonEmptyString(message.caption);
  const mediaItems = extractInboundMediaItems(message);
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

  const runtime = resolveRuntime(params.runtime);
  if (!runtime) {
    return false;
  }

  const dispatchReply = runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (typeof dispatchReply !== "function") {
    return false;
  }

  const resolvedMediaItems = await enrichInboundMediaItems(account, parsed.mediaItems, log);
  const mediaItems = await stageInboundMediaItems(runtime, resolvedMediaItems, log);
  const rawBody = buildInboundBody(parsed.sourceText, mediaItems);
  if (!rawBody) {
    return false;
  }
  const commandBody = resolveCommandBody(parsed.sourceText, mediaItems);
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
  const mediaUrls = stagedMedia.map((item) => item.url);
  const mediaTypes = stagedMedia.map((item) => item.mimeType);

  const cfg = resolveConfig(params.cfg, runtime);
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
    Provider: "zapry",
    Surface: "zapry",
    MessageSid: parsed.messageSid,
    HasMedia: mediaItems.length > 0,
    MediaItems: mediaItems,
    MediaKinds: mediaItems.map((item) => item.kind),
    MediaPath: mediaPaths[0],
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrl: mediaUrls[0],
    MediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
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
