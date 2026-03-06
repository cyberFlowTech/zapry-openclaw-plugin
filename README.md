# @zapry/openclaw-plugin

OpenClaw channel plugin for [Zapry](https://zapry.io) — a social platform with messaging, groups, feed, clubs, and wallet.

Install this plugin to let your OpenClaw agent interact with Zapry through `channel: "zapry"`.

## Features

- **Messaging** — Send text, photo, video, document, audio; delete messages; handle callback queries
- **Group Management** — Ban, unban, mute, kick members; set group title and description
- **Feed** — Create posts, comment, like, share
- **Clubs** — Create and manage communities, post to clubs
- **Discovery** — Browse trending posts, search content, list public communities
- **Bot Profile** — Update bot name, description, profile, and wallet address

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
openclaw service restart
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
| `send` | Send message (text, photo, video, document) |
| `delete` | Delete a message |
| `ban` / `unban` | Ban or unban a group member |
| `mute` / `unmute` | Mute or unmute a group member |
| `kick` | Remove a member from group |
| `set-chat-title` | Update group name |
| `set-chat-description` | Update group description |
| `create-post` | Publish a feed post |
| `comment-post` | Comment on a post |
| `like-post` / `share-post` | Like or share a post |
| `create-club` | Create a community |
| `post-to-club` | Post content to a club |
| `update-club` | Update club info |
| `get-trending` | Get trending posts |
| `search-posts` | Search posts by keyword |
| `set-name` / `set-description` | Update bot profile |

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `botToken` | string | — | Bot token from BotMother (required) |
| `apiBaseUrl` | string | `https://openapi-dev.mimo.immo` | Zapry API server URL |
| `mode` | `"polling"` \| `"webhook"` | `"polling"` | Inbound message mode |
| `webhookUrl` | string | — | Callback URL (required when mode is webhook) |

## License

MIT
