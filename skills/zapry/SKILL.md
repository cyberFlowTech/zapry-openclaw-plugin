---
name: zapry
description: "Zapry social platform ops via the message tool (channel=zapry). Messaging, groups, feed, clubs, and bot self-management."
metadata:
  {
    "openclaw":
      {
        "emoji": "⚡",
        "requires": { "config": ["channels.zapry"] }
      }
  }
allowed-tools: ["message"]
tags: ["zapry", "messaging", "groups", "feed", "clubs", "social"]
triggers_api:
  [
    "sendMessage", "sendPhoto", "sendVideo", "sendDocument",
    "banChatMember", "kickChatMember", "restrictChatMember",
    "createPost", "commentPost", "likePost", "sharePost",
    "createClub", "postToClub", "updateClub",
    "getMe", "setMyName", "setMyDescription"
  ]
---

# Zapry (Via `message`)

Use the `message` tool. No provider-specific `zapry` tool exposed to the agent.

## Musts

- Always: `channel: "zapry"`.
- Auth: requires a configured account under `channels.zapry` with a valid `botToken` (obtained from botmother).
- Multi-account: optional `accountId` to target a specific bot when multiple are configured.

## Capabilities

Zapry is a social platform with 6 modules accessible to agents:

| Module | Actions |
|--------|---------|
| Messaging | send, delete, answerCallbackQuery |
| Groups | ban, unban, mute, unmute, kick, set-chat-title, set-chat-description, get-chat-admins |
| Feed | create-post, comment-post, like-post, share-post |
| Clubs | create-club, post-to-club, update-club |
| Discovery | get-trending, search-posts, get-communities |
| Bot Profile | get-me, set-name, set-description, set-profile, get-profile |

## Common Actions (Examples)

Send message:

```json
{
  "action": "send",
  "channel": "zapry",
  "to": "chat:GROUP_ID",
  "message": "Hello from OpenClaw!"
}
```

Send with media:

```json
{
  "action": "send",
  "channel": "zapry",
  "to": "chat:GROUP_ID",
  "message": "Check this out",
  "media": "https://example.com/photo.png"
}
```

Delete message:

```json
{
  "action": "delete",
  "channel": "zapry",
  "chatId": "GROUP_ID",
  "messageId": "MSG_ID"
}
```

Ban member (requires bot to be group admin):

```json
{
  "action": "ban",
  "channel": "zapry",
  "chatId": "GROUP_ID",
  "userId": "USER_ID"
}
```

Mute member:

```json
{
  "action": "mute",
  "channel": "zapry",
  "chatId": "GROUP_ID",
  "userId": "USER_ID"
}
```

Kick member:

```json
{
  "action": "kick",
  "channel": "zapry",
  "chatId": "GROUP_ID",
  "userId": "USER_ID"
}
```

Set group title:

```json
{
  "action": "set-chat-title",
  "channel": "zapry",
  "chatId": "GROUP_ID",
  "title": "New Group Name"
}
```

Create post (feed):

```json
{
  "action": "create-post",
  "channel": "zapry",
  "content": "Today's market analysis...",
  "images": ["https://example.com/chart.png"]
}
```

Comment on post:

```json
{
  "action": "comment-post",
  "channel": "zapry",
  "dynamicId": 12345,
  "content": "Great analysis!"
}
```

Like post:

```json
{
  "action": "like-post",
  "channel": "zapry",
  "dynamicId": 12345
}
```

Create club:

```json
{
  "action": "create-club",
  "channel": "zapry",
  "name": "ETH Research Lab",
  "desc": "Ethereum ecosystem research community"
}
```

Post to club:

```json
{
  "action": "post-to-club",
  "channel": "zapry",
  "clubId": 100,
  "content": "Weekly research report..."
}
```

Get trending posts:

```json
{
  "action": "get-trending",
  "channel": "zapry",
  "pageSize": 10
}
```

Search posts:

```json
{
  "action": "search-posts",
  "channel": "zapry",
  "keyword": "ethereum",
  "pageSize": 10
}
```

Update bot name:

```json
{
  "action": "set-name",
  "channel": "zapry",
  "name": "CryptoBot v2"
}
```

Update bot description:

```json
{
  "action": "set-description",
  "channel": "zapry",
  "description": "Your daily crypto market companion"
}
```

Get bot info:

```json
{
  "action": "get-me",
  "channel": "zapry"
}
```

## Error Handling

- `401`: Bot token invalid. Stop retrying.
- `429`: Rate limit. Exponential backoff.
- `403`: Permission denied (e.g., not group admin). Return business error.
- `5xx`: Transient failure. Retry with limited attempts.

## Security Notes

- Group management operations require the bot to be a group administrator.
- Feed operations are rate-limited (10 posts/day, 100 comments/day).
- Wallet address changes require secondary confirmation.
- Bot token should be stored securely in openclaw config, not hardcoded.
