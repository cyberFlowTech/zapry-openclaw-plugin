if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a: number; b: number; c: number; d: number; e: number; f: number;
    m11: number; m12: number; m21: number; m22: number; m41: number; m42: number;
    is2D = true; isIdentity = false;
    constructor(init?: number[] | string) {
      const v = Array.isArray(init) ? init : [];
      this.a = this.m11 = v[0] ?? 1; this.b = this.m12 = v[1] ?? 0;
      this.c = this.m21 = v[2] ?? 0; this.d = this.m22 = v[3] ?? 1;
      this.e = this.m41 = v[4] ?? 0; this.f = this.m42 = v[5] ?? 0;
    }
    inverse() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    transformPoint(p?: any) { return { x: p?.x ?? 0, y: p?.y ?? 0, z: 0, w: 1 }; }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat32Array(a: Float32Array) { return new DOMMatrix(Array.from(a)); }
    static fromFloat64Array(a: Float64Array) { return new DOMMatrix(Array.from(a)); }
  };
}

try {
  const { createRequire } = require("node:module");
  const { pathToFileURL } = require("node:url");
  const _r = createRequire(require("node:path").join(process.cwd(), "package.json"));
  const _pdfjsAbs = _r.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const _workerAbs = _r.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  import(pathToFileURL(_pdfjsAbs).href).then((pdfjs: any) => {
    if (pdfjs?.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = _workerAbs;
    }
  }).catch(() => {});
} catch {}

import { zapryPlugin } from "./src/channel.js";
import {
  buildZaprySkillRequestHeaders,
  getZaprySkillInvocationContext,
  resolveZaprySkillRequestHeaders,
  setZapryRuntime,
} from "./src/runtime.js";
import {
  listZapryAccountIds,
  resolveDefaultZapryAccountId,
  resolveZapryAccount,
} from "./src/config.js";
import { handleZapryAction } from "./src/actions.js";
import {
  isOwnerInvocation,
  parseAgentIdFromSessionKey,
  resolveSessionAccountIdFromStore,
  type SessionStore,
} from "./src/internal.js";
import { readFile } from "node:fs/promises";
import { join as joinPath } from "node:path";

const ZAPRY_ACTION_TOOL_ACTIONS = [
  "send", "send-message",
  "send-photo", "send-video", "send-document", "send-audio", "send-voice", "send-animation",
  "generate-audio",
  "delete-message", "answer-callback-query",
  "get-file", "get-my-profile", "get-me",
  "get-my-groups", "get-my-chats",
  "get-chat-member", "get-chat-members", "get-chat-member-count", "get-chat-administrators",
  "mute-chat-member", "kick-chat-member", "set-chat-title", "set-chat-description",
  "get-user-profile-photos", "set-my-wallet-address", "set-my-friend-verify",
  "get-my-contacts", "get-my-friend-requests",
  "accept-friend-request", "reject-friend-request", "add-friend", "delete-friend",
  "set-my-soul", "get-my-soul", "set-my-skills", "get-my-skills",
  "set-my-name", "set-my-description",
  "get-trending-posts", "get-latest-posts", "get-my-posts", "search-posts",
  "delete-post", "comment-post", "like-post", "share-post",
  "get-updates", "set-webhook", "get-webhook-info", "delete-webhook", "webhooks-token",
  "get-chat-history",
] as const;

async function resolveRuntimeConfig(api: any): Promise<any> {
  const runtimeConfig = api?.runtime?.config;
  const loadConfig = runtimeConfig?.loadConfig;
  if (typeof loadConfig === "function") {
    try {
      return await Promise.resolve(loadConfig());
    } catch {
      // fall through
    }
  }
  return runtimeConfig ?? {};
}

async function loadSessionStore(storePath: string): Promise<SessionStore | null> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return (parsed ?? null) as SessionStore | null;
  } catch {
    // file missing, unreadable or malformed JSON → treat as "no store"
    return null;
  }
}

async function resolveSessionAccountId(
  api: any,
  cfg: any,
  sessionKey: string | undefined,
): Promise<string | undefined> {
  const key = `${sessionKey || ""}`.trim();
  if (!key) return undefined;

  const agentId = parseAgentIdFromSessionKey(key);
  if (!agentId) return undefined;

  const stateDir = api?.runtime?.state?.resolveStateDir?.(process.env);
  if (!stateDir) return undefined;

  const storePath = joinPath(
    stateDir,
    "agents",
    agentId,
    "sessions",
    "sessions.json",
  );
  const store = await loadSessionStore(storePath);

  return resolveSessionAccountIdFromStore({
    store,
    sessionKey: key,
    configuredAccountIds: listZapryAccountIds(cfg),
  });
}

function resolveToolAccount(toolCtx: any, cfg: any, requestedAccountId?: string) {
  return resolveZapryAccount(
    cfg,
    requestedAccountId ?? toolCtx?.agentAccountId ?? resolveDefaultZapryAccountId(cfg),
  );
}

function resolveToolSenderId(toolCtx: any): string {
  const senderIdFromToolCtx = String(toolCtx?.requesterSenderId ?? "").trim();
  if (senderIdFromToolCtx) {
    return senderIdFromToolCtx;
  }
  const invocationCtx = getZaprySkillInvocationContext();
  return String(invocationCtx?.senderId ?? "").trim();
}

function resolveToolSenderIsOwner(toolCtx: any, account: { botToken: string }): boolean {
  return isOwnerInvocation({
    senderIsOwner: toolCtx?.senderIsOwner,
    senderId: resolveToolSenderId(toolCtx),
    botToken: account.botToken,
  });
}

function shouldRegisterZapryOwnerTools(toolCtx: any, account: { botToken: string }): boolean {
  // Session/tool snapshots can be built before trusted sender context is attached,
  // so register-time owner filtering can hide tools from the real owner. Always
  // register Zapry tools here and rely on execute-time permission checks instead.
  return true;
}

function shouldExecuteZapryOwnerTools(toolCtx: any, account: { botToken: string }): boolean {
  // Fail closed: owner-only Zapry tools require trusted sender context even when
  // the invocation did not originate from a Zapry-tagged message channel.
  return resolveToolSenderIsOwner(toolCtx, account);
}

function resolveToolRequestHeaders(toolCtx: any): Record<string, string> {
  const senderId = resolveToolSenderId(toolCtx);
  if (senderId) {
    const invocationCtx = getZaprySkillInvocationContext();
    return buildZaprySkillRequestHeaders({
      senderId,
      messageSid: invocationCtx?.messageSid,
    });
  }
  return resolveZaprySkillRequestHeaders();
}

function ownerDeniedToolResult(): string {
  return JSON.stringify({
    ok: false,
    error: "只能是主人才可以调用",
  });
}

const plugin = {
  id: "zapry",
  name: "Zapry",
  description: "Zapry social platform channel plugin — messaging, groups, feed, clubs, and bot self-management",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  },
  register(api: any) {
    setZapryRuntime(api.runtime);
    api.registerChannel({ plugin: zapryPlugin });
    api.on("before_tool_call", async (event: any, ctx: any) => {
      if (event?.toolName !== "zapry_post" && event?.toolName !== "zapry_action") {
        return;
      }
      if (typeof event?.params?.accountId === "string" && event.params.accountId.trim()) {
        return;
      }
      const cfg = await resolveRuntimeConfig(api);
      const sessionAccountId = await resolveSessionAccountId(api, cfg, ctx?.sessionKey);
      if (!sessionAccountId) {
        return;
      }
      return {
        params: {
          ...(event?.params || {}),
          accountId: sessionAccountId,
        },
      };
    });

    api.registerTool((toolCtx: any) => {
      const toolCfg = toolCtx?.config ?? api?.runtime?.config ?? {};
      const account = resolveToolAccount(toolCtx, toolCfg);
      if (!shouldRegisterZapryOwnerTools(toolCtx, account)) {
        return null;
      }
      return {
        name: "zapry_post",
        label: "Zapry Post to Feed",
        description:
          "Post to Zapry public feed (广场). This is the ONLY way to create a feed post. " +
          "Pass content and optionally images. No target or routing needed.",
        parameters: {
          type: "object" as const,
          properties: {
            accountId: {
              type: "string" as const,
              description: "Optional Zapry account id. If omitted and only one account is configured, that account is used.",
            },
            content: {
              type: "string" as const,
              description: "Post text content (required)",
            },
            images: {
              type: "array" as const,
              items: { type: "string" as const },
              description:
                "Array of image sources: local file paths, data: URIs, HTTP(S) URLs, or Zapry file IDs (mf_*)",
            },
          },
          required: ["content"],
        },
        execute: async (_toolCallId: string, args: Record<string, any>) => {
          try {
            const cfg = await resolveRuntimeConfig(api);
            const reqAccountId =
              typeof args?.accountId === "string" && args.accountId.trim()
                ? args.accountId.trim()
                : undefined;
            const account = resolveToolAccount(toolCtx, cfg, reqAccountId);
            if (!shouldExecuteZapryOwnerTools(toolCtx, account)) {
              return ownerDeniedToolResult();
            }
            const result = await handleZapryAction({
              action: "create-post",
              channel: "zapry",
              account,
              params: { content: args.content, images: args.images },
              requestHeaders: resolveToolRequestHeaders(toolCtx),
            });
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    });

    api.registerTool((toolCtx: any) => {
      const toolCfg = toolCtx?.config ?? api?.runtime?.config ?? {};
      const account = resolveToolAccount(toolCtx, toolCfg);
      if (!shouldRegisterZapryOwnerTools(toolCtx, account)) {
        return null;
      }
      return {
        name: "zapry_action",
        label: "Zapry Platform Action",
        description:
          "Execute a Zapry platform action. Use this for: " +
          "sending media (send-photo, send-video, send-audio, send-document, send-voice, send-animation) to any chat including groups. " +
          "IMPORTANT: For send-photo, if user asks for an image without providing one, use 'prompt' parameter (e.g. action='send-photo', prompt='bitcoin logo') — image is auto-generated, NO photo/URL needed. " +
          "profile queries (get-my-profile, get-me), friend operations " +
          "(get-my-friend-requests, accept-friend-request, add-friend, etc.), " +
          "group management (get-chat-members, mute-chat-member, kick-chat-member, etc.), " +
          "feed reading (get-trending-posts, get-latest-posts, search-posts, etc.), " +
          "feed interactions (delete-post, comment-post, like-post, share-post), " +
          "bot settings (set-my-soul, set-my-skills, set-my-name, etc.), " +
          "chat history (get-chat-history), " +
          "and webhook/file operations (get-file, set-webhook, get-updates, etc.). " +
          "Pass the action name and action-specific parameters as top-level fields.",
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string" as const,
              description: "The Zapry action to execute",
              enum: [...ZAPRY_ACTION_TOOL_ACTIONS],
            },
            accountId: {
              type: "string" as const,
              description: "Optional Zapry account id. If omitted and only one account is configured, that account is used.",
            },
            chat_id: {
              type: "string" as const,
              description: "Chat/group ID (for group management actions like get-chat-members, mute-chat-member, etc.)",
            },
            user_id: {
              type: "string" as const,
              description: "User ID (for friend actions, chat member actions, etc.)",
            },
            file_id: {
              type: "string" as const,
              description: "File ID (for get-file)",
            },
            keyword: {
              type: "string" as const,
              description: "Search keyword (for search-posts)",
            },
            dynamic_id: {
              type: "string" as const,
              description: "Post/dynamic ID (for delete-post, comment-post, like-post, share-post)",
            },
            photo: {
              type: "string" as const,
              description: "Photo source: external URL (auto-downloaded), data URI, local path, or /_temp/media URL (for send-photo). If omitted but 'prompt' is provided, image will be auto-generated.",
            },
            prompt: {
              type: "string" as const,
              description: "PREFERRED for send-photo when user asks for an image: describe what to generate (e.g. 'bitcoin logo', 'cute cat'). Image is auto-generated and sent — no photo/URL needed.",
            },
            video: {
              type: "string" as const,
              description: "Video source (for send-video)",
            },
            document: {
              type: "string" as const,
              description: "Document source (for send-document)",
            },
            audio: {
              type: "string" as const,
              description: "Audio source (for send-audio)",
            },
            voice: {
              type: "string" as const,
              description: "Voice source (for send-voice)",
            },
            animation: {
              type: "string" as const,
              description: "Animation/GIF source (for send-animation)",
            },
            content: {
              type: "string" as const,
              description: "Text content (for comment-post)",
            },
            limit: {
              type: "number" as const,
              description: "Limit for results (for get-chat-history, default 50, max 50)",
            },
            page: {
              type: "number" as const,
              description: "Page number for paginated results",
            },
            page_size: {
              type: "number" as const,
              description: "Page size for paginated results",
            },
          },
          required: ["action"],
          additionalProperties: true,
        },
        execute: async (_toolCallId: string, args: Record<string, any>) => {
          try {
            const { action, channel: _ch, accountId: reqAccountId, ...params } = args ?? {};
            const cfg = await resolveRuntimeConfig(api);
            const account = resolveToolAccount(toolCtx, cfg, reqAccountId);
            if (!shouldExecuteZapryOwnerTools(toolCtx, account)) {
              return ownerDeniedToolResult();
            }
            const result = await handleZapryAction({
              action,
              channel: "zapry",
              account,
              params,
              requestHeaders: resolveToolRequestHeaders(toolCtx),
            });
            return JSON.stringify(result, null, 2);
          } catch (err) {
            return JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    });
  },
};

export default plugin;
