import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Re-implementing the private resolveSessionAccountId is not ideal, but
// importing index.ts pulls in the OpenClaw runtime registration side effects
// (pdfjs shim, registerChannel, etc.). We therefore cherry-pick the same
// building blocks (fs read + the pure resolver) and run them in concert.
// This is effectively a copy of the index.ts implementation, which is the
// safest integration boundary we can test without booting the runtime.
import { readFile } from "node:fs/promises";
import {
  parseAgentIdFromSessionKey,
  resolveSessionAccountIdFromStore,
  type SessionStore,
} from "../../src/internal.js";
import { listZapryAccountIds } from "../../src/config.js";

async function loadSessionStore(storePath: string): Promise<SessionStore | null> {
  try {
    const raw = await readFile(storePath, "utf8");
    return JSON.parse(raw) as SessionStore | null;
  } catch {
    return null;
  }
}

async function resolveSessionAccountId(params: {
  stateDir: string | undefined;
  cfg: unknown;
  sessionKey: string | undefined;
}): Promise<string | undefined> {
  const key = `${params.sessionKey || ""}`.trim();
  if (!key) return undefined;
  const agentId = parseAgentIdFromSessionKey(key);
  if (!agentId) return undefined;
  if (!params.stateDir) return undefined;

  const storePath = join(
    params.stateDir,
    "agents",
    agentId,
    "sessions",
    "sessions.json",
  );
  const store = await loadSessionStore(storePath);
  return resolveSessionAccountIdFromStore({
    store,
    sessionKey: key,
    configuredAccountIds: listZapryAccountIds(params.cfg),
  });
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let stateDir: string;

async function writeSessionStore(agentId: string, data: unknown) {
  const dir = join(stateDir, "agents", agentId, "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sessions.json"), JSON.stringify(data), "utf8");
}

async function writeRawSessionFile(agentId: string, raw: string) {
  const dir = join(stateDir, "agents", agentId, "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sessions.json"), raw, "utf8");
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "zapry-plugin-int-"));
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

// ─── End-to-end tests ───────────────────────────────────────────────────────

describe("resolveSessionAccountId (integration with real fs)", () => {
  const sessionKey = "agent:main:zapry:group:g_1";

  it("[I-03] reads accountId recorded in deliveryContext from disk", async () => {
    await writeSessionStore("main", {
      [sessionKey]: {
        deliveryContext: { accountId: "botA", channel: "zapry" },
        lastAccountId: "botA",
      },
    });
    const result = await resolveSessionAccountId({
      stateDir,
      cfg: {
        channels: {
          zapry: {
            accounts: { botA: { botToken: "1:a" }, botB: { botToken: "2:b" } },
          },
        },
      },
      sessionKey,
    });
    expect(result).toBe("botA");
  });

  it("[I-04] single-account: falls back to the only account when entry is missing", async () => {
    // no sessions.json on disk at all
    const result = await resolveSessionAccountId({
      stateDir,
      cfg: {
        channels: { zapry: { accounts: { only: { botToken: "1:x" } } } },
      },
      sessionKey,
    });
    expect(result).toBe("only");
  });

  it("[I-05] multi-account: returns undefined when entry is missing (R2 hardening, end-to-end)", async () => {
    await writeSessionStore("main", {}); // empty store present on disk

    const result = await resolveSessionAccountId({
      stateDir,
      cfg: {
        channels: {
          zapry: {
            accounts: { botA: { botToken: "1:a" }, botB: { botToken: "2:b" } },
          },
        },
      },
      sessionKey,
    });
    expect(result).toBeUndefined();
  });

  it("[I-06] malformed sessions.json: silently falls through", async () => {
    await writeRawSessionFile("main", "{not valid json"); // malformed

    const multi = await resolveSessionAccountId({
      stateDir,
      cfg: {
        channels: {
          zapry: {
            accounts: { botA: { botToken: "1:a" }, botB: { botToken: "2:b" } },
          },
        },
      },
      sessionKey,
    });
    expect(multi).toBeUndefined();

    const single = await resolveSessionAccountId({
      stateDir,
      cfg: { channels: { zapry: { accounts: { only: { botToken: "1:x" } } } } },
      sessionKey,
    });
    expect(single).toBe("only");
  });

  it("reads the agent-specific sessions.json (agentId is parsed from the sessionKey)", async () => {
    // The same peer id lives under two different agents, each with its own
    // preferred account. We must route via the agent derived from sessionKey.
    await writeSessionStore("agentAlpha", {
      "agent:agentAlpha:zapry:group:g_1": {
        deliveryContext: { accountId: "alphaBot" },
      },
    });
    await writeSessionStore("agentBeta", {
      "agent:agentBeta:zapry:group:g_1": {
        deliveryContext: { accountId: "betaBot" },
      },
    });

    const cfg = {
      channels: {
        zapry: {
          accounts: {
            alphaBot: { botToken: "1:a" },
            betaBot: { botToken: "2:b" },
          },
        },
      },
    };

    expect(
      await resolveSessionAccountId({
        stateDir,
        cfg,
        sessionKey: "agent:agentAlpha:zapry:group:g_1",
      }),
    ).toBe("alphaBot");

    expect(
      await resolveSessionAccountId({
        stateDir,
        cfg,
        sessionKey: "agent:agentBeta:zapry:group:g_1",
      }),
    ).toBe("betaBot");
  });

  it("[I-09] legacy 'main' entry does NOT leak into new peer-scoped sessions", async () => {
    // Pre-fix deployments may have this legacy entry. A peer-scoped key must
    // resolve independently — never inherit this entry's accountId.
    await writeSessionStore("main", {
      "agent:main:main": {
        deliveryContext: { accountId: "botA" },
        lastAccountId: "botA",
      },
    });

    const result = await resolveSessionAccountId({
      stateDir,
      cfg: {
        channels: {
          zapry: {
            accounts: { botA: { botToken: "1:a" }, botB: { botToken: "2:b" } },
          },
        },
      },
      sessionKey, // peer-scoped key, not 'agent:main:main'
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined for legacy flat sessionKey ('main') because no agentId can be parsed", async () => {
    const result = await resolveSessionAccountId({
      stateDir,
      cfg: {
        channels: { zapry: { accounts: { only: { botToken: "1:x" } } } },
      },
      sessionKey: "main",
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when stateDir is not resolvable (no-op runtime)", async () => {
    const result = await resolveSessionAccountId({
      stateDir: undefined,
      cfg: {
        channels: { zapry: { accounts: { only: { botToken: "1:x" } } } },
      },
      sessionKey,
    });
    expect(result).toBeUndefined();
  });

  it("treats empty/whitespace sessionKey as 'do nothing'", async () => {
    const result = await resolveSessionAccountId({
      stateDir,
      cfg: {},
      sessionKey: "   ",
    });
    expect(result).toBeUndefined();
  });
});
