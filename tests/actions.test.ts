import { afterEach, describe, expect, it, vi } from "vitest";
import { handleZapryAction } from "../src/actions.js";
import type { ResolvedZapryAccount } from "../src/types.js";

const account: ResolvedZapryAccount = {
  accountId: "default",
  enabled: true,
  botToken: "TOKEN",
  tokenSource: "config",
  config: {
    apiBaseUrl: "https://openapi.example.test",
    mode: "polling",
  },
};

describe("messaging actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes mention metadata for send-message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: "msg_at_1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await handleZapryAction({
      action: "send-message",
      channel: "zapry",
      account,
      params: {
        chat_id: "g_117780746111170006",
        text: "@安卓-三星 hello",
        mention_user_ids: ["849695"],
        mention_names: ["安卓-三星"],
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openapi.example.test/TOKEN/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "g_117780746111170006",
          text: "@安卓-三星 hello",
          mention_user_ids: ["849695"],
          mention_names: ["安卓-三星"],
          reply_to_message_id: undefined,
          message_thread_id: undefined,
          reply_markup: undefined,
        }),
      }),
    );
  });

  it("dispatches send-link-card to the new OpenAPI endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: "msg_link_1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await handleZapryAction({
      action: "send-link-card",
      channel: "zapry",
      account,
      params: {
        chat_id: "g_1",
        url: "https://zapry.ai/developers",
        title: "Zapry Developers",
        content: "Build agents on Zapry",
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openapi.example.test/TOKEN/sendLinkCard",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"url":"https://zapry.ai/developers"'),
      }),
    );
  });

  it("keeps send-message-card as a compatibility alias", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: "msg_link_2" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await handleZapryAction({
      action: "send-message-card",
      channel: "zapry",
      account,
      params: {
        chat_id: "g_1",
        url: "https://zapry.ai/developers",
        title: "Zapry Developers",
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openapi.example.test/TOKEN/sendLinkCard",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("dispatches set-message-privacy to OpenAPI", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { group_privacy: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await handleZapryAction({
      action: "set-message-privacy",
      channel: "zapry",
      account,
      params: {
        group_privacy: false,
        can_read_all_group_messages: true,
        can_read_all_club_messages: true,
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openapi.example.test/TOKEN/setMessagePrivacy",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          group_privacy: false,
          can_read_all_group_messages: true,
          can_read_all_club_messages: true,
        }),
      }),
    );
  });
});

describe("club moderation actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches mute-club-member to the OpenAPI endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { muted_until: 123 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await handleZapryAction({
      action: "mute-club-member",
      channel: "zapry",
      account,
      params: {
        club_id: 42,
        user_id: "2002",
        mute: true,
        duration_seconds: 600,
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openapi.example.test/TOKEN/muteClubMember",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          club_id: 42,
          user_id: "2002",
          mute: true,
          duration_seconds: 600,
        }),
      }),
    );
  });

  it("requires duration_seconds for timed club mute", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await handleZapryAction({
      action: "mute-club-member",
      channel: "zapry",
      account,
      params: {
        club_id: 42,
        user_id: "2002",
        mute: true,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("duration_seconds");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dispatches kick-club-member to the OpenAPI endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await handleZapryAction({
      action: "kick-club-member",
      channel: "zapry",
      account,
      params: {
        clubId: "42",
        userId: 2002,
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openapi.example.test/TOKEN/kickClubMember",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          club_id: 42,
          user_id: "2002",
        }),
      }),
    );
  });
});
