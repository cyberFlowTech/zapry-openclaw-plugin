# @zapry/openclaw-plugin

OpenClaw channel plugin for [Zapry](https://zapry.io) — a social platform with messaging, groups, feed, clubs, and wallet.

Install this plugin to let your OpenClaw agent interact with Zapry through `channel: "zapry"`.

## Features

- **Messaging** — Send text/photo/video/document/audio (+ voice/animation route passthrough), delete messages, handle callback queries
- **Group Management** — Ban, unban, mute, kick members; set group title and description
- **Feed** — Create posts, comment, like, share; fetch trending/latest/my posts
- **Clubs** — Create and manage communities, post to clubs
- **Discovery** — Search/list communities, query wallet addresses, fetch profile photos
- **Bot Profile** — Update bot name/description/profile/wallet
- **Channel Ops** — Manage webhook/polling and command/file endpoints through actions

## Install

```bash
openclaw plugins install @zapry/openclaw-plugin
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

| Action | Description |
|--------|-------------|
| `send` | Send message (text/photo/video/document) |
| `send-audio` / `send-voice` / `send-animation` | Send audio/voice/animation (`sendVoice` and `sendAnimation` depend on upstream route availability) |
| `delete` | Delete a message |
| `answer-callback-query` | Answer callback query |
| `get-file` | Fetch file metadata by `fileId` |
| `set-my-commands` / `get-my-commands` / `delete-my-commands` | Manage bot command list |
| `get-updates` / `set-webhook` / `get-webhook-info` / `delete-webhook` / `webhooks-token` | Polling & webhook actions |
| `ban` / `unban` | Ban or unban a group member |
| `mute` / `unmute` | Mute or unmute a group member |
| `kick` | Remove a member from group |
| `set-chat-title` | Update group name |
| `set-chat-description` | Update group description |
| `get-chat-admins` / `get-chat-member` / `get-chat-member-count` | Group query actions |
| `create-post` | Publish a feed post |
| `comment-post` | Comment on a post |
| `like-post` / `share-post` | Like or share a post |
| `get-trending` / `get-latest-posts` / `get-my-posts` | Feed query actions |
| `create-club` | Create a community |
| `post-to-club` | Post content to a club |
| `update-club` | Update club info |
| `search-posts` | Search posts by keyword |
| `get-communities` | List public communities |
| `get-wallet-address` / `get-user-profile-photos` | Discovery actions |
| `get-me` | Get current bot info |
| `set-name` / `set-description` | Update bot profile |
| `set-wallet-address` / `set-profile` / `get-profile` | Bot profile actions |

### Parameter Conventions (Important)

To avoid `400 Bad Request` parameter errors, prefer these canonical keys in `message` tool calls:

- IDs: `chatId`, `userId`, `messageId`, `dynamicId`, `clubId`
- Content: `message`/`text`, `mediaUrl`, `audio`, `voice`, `animation`, `content`
- Paging: `page`, `pageSize`
- Webhook/commands: `url`, `commands`, `languageCode`, `offset`, `limit`, `timeout`, `fileId`

Accepted aliases are also supported (`chat_id`, `user_id`, `message_id`, `dynamic_id`, `club_id`, `page_size`, `media`, `media_url`, `audio_url`, `voice_url`, `animation_url`, `file_id`, `language_code`, `callback_query_id`, `webhook_url`), but canonical camelCase is recommended for consistency.

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `botToken` | string | — | Bot token from BotMother (required) |
| `apiBaseUrl` | string | `https://openapi-dev.mimo.immo` | Zapry API server URL |
| `mode` | `"polling"` \| `"webhook"` | `"polling"` | Inbound message mode |
| `webhookUrl` | string | — | Callback URL (required when mode is webhook) |

## License

MIT
