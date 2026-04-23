# zapry-openclaw-plugin

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
openclaw plugins install zapry-openclaw-plugin
```

The npm package name is `zapry-openclaw-plugin`, while the OpenClaw plugin/channel id remains `zapry`.

## Development Notes

- `node_modules/` is ignored by Git and should not be committed.
- If `node_modules` was ever tracked in your local branch, untrack it with:

```bash
git rm -r --cached node_modules
```

## Release

发版**只能手动触发**（`workflow_dispatch`），不会因为 push / tag 自动发版。

1. 在 `main` 上 bump 版本并更新 CHANGELOG，然后推上去：

   ```bash
   # 编辑 package.json 的 "version" 字段，编辑 CHANGELOG.md
   git add package.json CHANGELOG.md
   git commit -m "chore(plugin): 准备 X.Y.Z 生产发版"
   git push origin main
   ```

2. 打开 GitHub → Actions → **Release** workflow → **Run workflow**：

   - **version**：填写 `X.Y.Z`（不要带 `v` 前缀，必须与 `package.json` 中的 `version` 完全一致）
   - **dry_run**：勾选可干跑（只跑 build + `npm publish --dry-run`，不上 npm、不打 tag、不建 Release）

3. workflow 会自动：
   - 校验输入版本号与 `package.json` 一致
   - 校验远程不存在同名 tag
   - `npm ci && npm run build`
   - `npm publish --provenance --access public`（OIDC Trusted Publishing）
   - 由 workflow 内部创建并推送 `vX.Y.Z` tag
   - 基于 commit 自动生成 GitHub Release

npm 发布走 npmjs.com 的 Trusted Publisher（OIDC），不需要配置 `NPM_TOKEN`。首次启用请在 npmjs.com 的包设置里把当前仓库配成 Trusted Publisher。

## Configure

Get a bot token from Zapry BotMother, then add it to your config:

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
Agent: → zapry_post { content: "Good morning!" }
       Done, post published.
```

### Available Actions

- Messaging: `send-message`, `send-photo`, `send-video`, `send-document`, `send-audio`, `send-voice`, `send-animation`, `generate-audio`, `delete-message`, `answer-callback-query`
- Receive/Webhook: `get-updates`, `get-file`, `set-webhook`, `get-webhook-info`, `delete-webhook`, `webhooks-token`
- Skills: `set-my-soul`, `get-my-soul`, `set-my-skills`, `get-my-skills`, `get-my-profile`
- Group Query & Moderation: `get-my-groups`, `get-my-chats`, `get-chat-member`, `get-chat-members`, `get-chat-member-count`, `get-chat-administrators`, `mute-chat-member`, `kick-chat-member`, `set-chat-title`, `set-chat-description`
- Agent Self Management: `get-me`, `get-user-profile-photos`, `set-my-wallet-address`, `set-my-friend-verify`, `get-my-contacts`, `get-my-friend-requests`, `set-my-name`, `set-my-description`
- Feed: `get-trending-posts`, `get-latest-posts`, `get-my-posts`, `search-posts`, `create-post`, `delete-post`, `comment-post`, `like-post`, `share-post`
- Club: `get-my-clubs`, `create-club`, `update-club`

### Parameter Conventions (Important)

This plugin follows the API reference 1:1. Prefer documented parameter names in `zapry_action` / `zapry_post` tool calls:

- IDs: `chat_id`, `user_id`, `message_id`, `callback_query_id`, `file_id`, `dynamic_id`, `club_id`
- Content: `text`, `photo`, `video`, `document`, `audio`, `voice`, `animation`, `content`
- Paging: `page`, `page_size`
- Bot/Privacy: `name`, `description`, `wallet_address`, `need_verify`, `pending_only`
- Skills: `soulMd`, `skills`, `version`, `source`, `agentKey`

Common camelCase aliases are still accepted (`chatId`, `userId`, `messageId`, `dynamicId`, `clubId`, `pageSize`, `languageCode`), but snake_case is canonical.

Group moderation note:

- `mute-chat-member` only supports `mute` boolean (`true` mute / `false` unmute).
- Duration fields like `until_date` / `duration` are not supported by current API contract.

Media source constraint (important):

- For media send actions, use only `data:` URI or `/_temp/media/...` (or absolute URL ending with `/_temp/media/...`).
- `create-post` images follow the same rule; local file paths are auto-converted to `data:` URI by this plugin.
- Raw external file/image URLs are rejected by Zapry OpenAPI and will return `400`.

Audio generation helper:

- `generate-audio` is a plugin-local helper action (not OpenAPI 1:1) that does **TTS or procedural rendering** and then sends via `sendAudio`.
- Typical params: `chat_id` (required), optional `prompt`, `audio_mode` (`auto`/`tts`/`render`), `audio_format` (`mp3`/`wav`), `duration_seconds`, `tts_voice`, `fallback_text`.
- On generation/send failure, the plugin will best-effort send fallback text to the chat.

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `botToken` | string | — | Bot token from BotMother (required) |
| `apiBaseUrl` | string | `https://openapi.mimo.immo` | Zapry API server URL |
| `mode` | `"polling"` \| `"webhook"` | `"polling"` | Inbound runtime now uses polling as the single processing path; `webhook` is accepted but falls back to polling |
| `webhookUrl` | string | — | Legacy webhook callback URL, retained only for backward-compatible config parsing |
| `profileSync.enabled` | boolean | `true` | Whether to auto-sync SOUL+skills to Zapry on startup (`setMyProfile`) |

## License

MIT
