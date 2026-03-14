import { zapryPlugin } from "./src/channel.js";
import { setZapryRuntime } from "./src/runtime.js";
import { resolveZapryAccount } from "./src/config.js";
import { handleZapryAction } from "./src/actions.js";

const ZAPRY_NON_MESSAGE_ACTIONS = [
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
  "generate-audio",
  "get-updates", "set-webhook", "get-webhook-info", "delete-webhook", "webhooks-token",
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
        "Execute a Zapry platform action that does NOT involve sending a chat message. " +
        "Use this for: profile queries (get-my-profile, get-me), friend operations " +
        "(get-my-friend-requests, accept-friend-request, add-friend, etc.), " +
        "group management (get-chat-members, mute-chat-member, kick-chat-member, etc.), " +
        "feed reading (get-trending-posts, get-latest-posts, search-posts, etc.), " +
        "feed interactions (delete-post, comment-post, like-post, share-post), " +
        "bot settings (set-my-soul, set-my-skills, set-my-name, etc.), " +
        "and webhook/file operations (get-file, set-webhook, get-updates, etc.). " +
        "Pass the action name and action-specific parameters as top-level fields.",
      parameters: {
        type: "object" as const,
        properties: {
          action: {
            type: "string" as const,
            description: "The Zapry action to execute",
            enum: [...ZAPRY_NON_MESSAGE_ACTIONS],
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
          content: {
            type: "string" as const,
            description: "Text content (for comment-post)",
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
          const { action, target: _t, channel: _ch, ...params } = args;
          const cfg = await resolveRuntimeConfig(api);
          const account = resolveZapryAccount(cfg);
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
