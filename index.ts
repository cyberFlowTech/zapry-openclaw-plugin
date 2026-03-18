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
import { setZapryRuntime } from "./src/runtime.js";
import { resolveZapryAccount } from "./src/config.js";
import { handleZapryAction } from "./src/actions.js";

const ZAPRY_ACTION_TOOL_ACTIONS = [
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

    api.registerTool({
      name: "zapry_post",
      label: "Zapry Post to Feed",
      description:
        "Post to Zapry public feed (广场). This is the ONLY way to create a feed post. " +
        "Pass content and optionally images. No target or routing needed.",
      parameters: {
        type: "object" as const,
        properties: {
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
          const account = resolveZapryAccount(cfg);
          const result = await handleZapryAction({
            action: "create-post",
            channel: "zapry",
            account,
            params: { content: args.content, images: args.images },
          });
          return JSON.stringify(result, null, 2);
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    });

    api.registerTool({
      name: "zapry_action",
      label: "Zapry Platform Action",
      description:
        "Execute a Zapry platform action. Use this for: " +
        "sending media (send-photo, send-video, send-audio, send-document, send-voice, send-animation) to any chat including groups — " +
        "external image URLs are auto-downloaded, just pass the URL; " +
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
            description: "Photo source: external URL (auto-downloaded), data URI, local path, or /_temp/media URL (for send-photo)",
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
          const { action, target: _t, channel: _ch, accountId: reqAccountId, ...params } = args ?? {};
          const cfg = await resolveRuntimeConfig(api);
          const account = resolveZapryAccount(cfg, reqAccountId);
          const result = await handleZapryAction({
            action,
            channel: "zapry",
            account,
            params,
          });
          return JSON.stringify(result, null, 2);
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    });
  },
};

export default plugin;
