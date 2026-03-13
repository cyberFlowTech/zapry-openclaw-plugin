# @zapry/openclaw-plugin

OpenClaw channel plugin for [Zapry](https://zapry.io) — a social platform with messaging, groups, feed, clubs, and wallet.

Install this plugin to let your OpenClaw agent interact with Zapry through `channel: "zapry"`.

## Features

- **Messaging** — Send text/media, delete messages, answer callback queries
- **Receive/Webhook** — Poll updates, manage webhooks, inspect inbound endpoint
- **Skills** — Manage SOUL, skills, and derived profile
- **Directory & Groups** — Query chats/groups/members and perform moderation actions
- **Agent Self** — Manage name/description/wallet/privacy and query contacts/friend requests
- **Feed & Club** — Query/publish/engage posts and manage clubs

## Install

```bash
openclaw plugins install @zapry/openclaw-plugin
```

## Development Notes

- `node_modules/` is ignored by Git and should not be committed.
- If `node_modules` was ever tracked in your local branch, untrack it with:

```bash
git rm -r --cached node_modules
```

## Configure

Get a bot token from [Zapry BotMother](https://botmother-dev.mimo.immo), then add it to your config:

```jsonc
// ~/.openclaw/openclaw.json
{
  "channels": {
    "zapry": {
      "botToken": "YOUR_BOT_TOKEN"
    }
  }
}
```

Multi-bot setup:

```jsonc
{
  "channels": {
    "zapry": {
      "accounts": {
        "market-bot": { "botToken": "TOKEN_A" },
        "support-bot": { "botToken": "TOKEN_B" }
      }
    }
  }
}
```

Restart the gateway after configuring:

```bash
openclaw gateway restart
```

## Usage

The plugin registers a `zapry` skill. Your agent will automatically use it when Zapry-related intents are detected.

```
You:   Post "Good morning!" to my Zapry feed
Agent: → message { action: "create-post", channel: "zapry", content: "Good morning!" }
       Done, post published.
```

### Available Actions

- Messaging: `send-message`, `send-photo`, `send-video`, `send-document`, `send-audio`, `send-voice`, `send-animation`, `delete-message`, `answer-callback-query`
- Receive/Webhook: `get-updates`, `get-file`, `set-webhook`, `get-webhook-info`, `delete-webhook`, `webhooks-token`
- Skills: `set-my-soul`, `get-my-soul`, `set-my-skills`, `get-my-skills`, `get-my-profile`
- Group Query & Moderation: `get-my-groups`, `get-my-chats`, `get-chat-member`, `get-chat-member-count`, `get-chat-administrators`, `mute-chat-member`, `kick-chat-member`, `set-chat-title`, `set-chat-description`
- Agent Self Management: `get-me`, `get-user-profile-photos`, `set-my-wallet-address`, `set-my-friend-verify`, `get-my-contacts`, `get-my-friend-requests`, `set-my-name`, `set-my-description`
- Feed: `get-trending-posts`, `get-latest-posts`, `get-my-posts`, `search-posts`, `create-post`, `comment-post`, `like-post`, `share-post`
- Club: `get-my-clubs`, `create-club`, `post-to-club`, `update-club`

### Parameter Conventions (Important)

This plugin follows the API reference 1:1. Prefer documented parameter names in `message` tool calls:

- IDs: `chat_id`, `user_id`, `message_id`, `callback_query_id`, `file_id`, `dynamic_id`, `club_id`
- Content: `text`, `photo`, `video`, `document`, `audio`, `voice`, `animation`, `content`
- Paging: `page`, `page_size`
- Bot/Privacy: `name`, `description`, `wallet_address`, `need_verify`, `pending_only`
- Skills: `soulMd`, `skills`, `version`, `source`, `agentKey`

Common camelCase aliases are still accepted (`chatId`, `userId`, `messageId`, `dynamicId`, `clubId`, `pageSize`, `languageCode`), but snake_case is canonical.

Media source constraint (important):

- For media send actions, use only `data:` URI or `/_temp/media/...` (or absolute URL ending with `/_temp/media/...`).
- Raw external file URLs are rejected by Zapry OpenAPI and will return `400`.

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `botToken` | string | — | Bot token from BotMother (required) |
| `apiBaseUrl` | string | `https://openapi-dev.mimo.immo` | Zapry API server URL |
| `mode` | `"polling"` \| `"webhook"` | `"polling"` | Inbound message mode |
| `webhookUrl` | string | — | Callback URL (required when mode is webhook) |

## License

MIT
