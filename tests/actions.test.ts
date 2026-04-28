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
