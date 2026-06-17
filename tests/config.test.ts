import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listZapryAccountIds,
  resolveDefaultZapryAccountId,
  resolveZapryAccount,
} from "../src/config.js";
import { DEFAULT_ACCOUNT_ID, DEFAULT_API_BASE_URL } from "../src/types.js";

// Snapshot/restore ZAPRY_BOT_TOKEN around env-sensitive tests so they can't
// leak between cases or depend on developer machines.
let originalEnvToken: string | undefined;

beforeEach(() => {
  originalEnvToken = process.env.ZAPRY_BOT_TOKEN;
  delete process.env.ZAPRY_BOT_TOKEN;
});

afterEach(() => {
  if (originalEnvToken === undefined) {
    delete process.env.ZAPRY_BOT_TOKEN;
  } else {
    process.env.ZAPRY_BOT_TOKEN = originalEnvToken;
  }
});

describe("resolveZapryAccount", () => {
  it("[U-13] single-account config auto-selects the only account when no id is passed", () => {
    const cfg = {
      channels: {
        zapry: {
          accounts: {
            only: { botToken: "1:only-token" },
          },
        },
      },
    };
    const account = resolveZapryAccount(cfg);
    expect(account.accountId).toBe("only");
    expect(account.botToken).toBe("1:only-token");
    expect(account.tokenSource).toBe("config");
  });

  it("[U-14] multi-account config falls back to DEFAULT_ACCOUNT_ID when no id is passed", () => {
    const cfg = {
      channels: {
        zapry: {
          accounts: {
            botA: { botToken: "1:a" },
            botB: { botToken: "2:b" },
          },
        },
      },
    };
    const account = resolveZapryAccount(cfg);
    expect(account.accountId).toBe(DEFAULT_ACCOUNT_ID);
    // DEFAULT_ACCOUNT_ID does not exist in accounts → the "no acct match"
    // branch is taken, token falls through to zapry.botToken which is also
    // missing → token is empty, not a cross-account leak.
    expect(account.botToken).toBe("");
  });

  it("[U-15] when account.botToken is missing, falls back to channel-level zapry.botToken", () => {
    const cfg = {
      channels: {
        zapry: {
          botToken: "9:channel-level",
          accounts: {
            main: { name: "Main" },
          },
        },
      },
    };
    const account = resolveZapryAccount(cfg, "main");
    expect(account.accountId).toBe("main");
    expect(account.botToken).toBe("9:channel-level");
    expect(account.tokenSource).toBe("config");
  });

  it("[U-16] when both account and channel tokens are missing, falls back to ZAPRY_BOT_TOKEN env", () => {
    process.env.ZAPRY_BOT_TOKEN = "7:env-token";
    const cfg = {
      channels: {
        zapry: {
          accounts: {
            main: { name: "Main" },
          },
        },
      },
    };
    const account = resolveZapryAccount(cfg, "main");
    expect(account.botToken).toBe("7:env-token");
    expect(account.tokenSource).toBe("env");
  });

  it("returns empty token when nothing is configured (no crash)", () => {
    const account = resolveZapryAccount({});
    expect(account.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(account.botToken).toBe("");
  });

  it("uses the requested accountId when provided, even if a different one would auto-select", () => {
    const cfg = {
      channels: {
        zapry: {
          accounts: {
            botA: { botToken: "1:a" },
            botB: { botToken: "2:b" },
          },
        },
      },
    };
    const account = resolveZapryAccount(cfg, "botB");
    expect(account.accountId).toBe("botB");
    expect(account.botToken).toBe("2:b");
  });

  it("normalizes trailing '/bot' and trailing slashes in apiBaseUrl", () => {
    const account = resolveZapryAccount({
      channels: {
        zapry: {
          botToken: "t",
          apiBaseUrl: "https://example.com/bot/",
        },
      },
    });
    expect(account.config.apiBaseUrl).toBe("https://example.com");
  });

  it("falls back to DEFAULT_API_BASE_URL when apiBaseUrl is empty", () => {
    const account = resolveZapryAccount({
      channels: { zapry: { botToken: "t", apiBaseUrl: "" } },
    });
    expect(account.config.apiBaseUrl).toBe(DEFAULT_API_BASE_URL);
  });
});

describe("listZapryAccountIds / resolveDefaultZapryAccountId", () => {
  it("returns configured account ids in declaration order", () => {
    const cfg = {
      channels: {
        zapry: {
          accounts: {
            alpha: { botToken: "1:a" },
            beta: { botToken: "2:b" },
          },
        },
      },
    };
    expect(listZapryAccountIds(cfg)).toEqual(["alpha", "beta"]);
    expect(resolveDefaultZapryAccountId(cfg)).toBe("alpha");
  });

  it("returns DEFAULT_ACCOUNT_ID when only a top-level botToken is set", () => {
    expect(listZapryAccountIds({ channels: { zapry: { botToken: "t" } } })).toEqual([
      DEFAULT_ACCOUNT_ID,
    ]);
  });

  it("returns [DEFAULT_ACCOUNT_ID] when only ZAPRY_BOT_TOKEN env is set (no channels.zapry block)", () => {
    // Regression guard for the env-only deployment path: consumers rely on
    // this function to decide whether the plugin is configured, and must see
    // the env-token backed account.
    process.env.ZAPRY_BOT_TOKEN = "env-only";
    expect(listZapryAccountIds({})).toEqual([DEFAULT_ACCOUNT_ID]);
  });

  it("returns [DEFAULT_ACCOUNT_ID] when env is set and a (possibly empty) zapry block exists", () => {
    process.env.ZAPRY_BOT_TOKEN = "env-only";
    expect(listZapryAccountIds({ channels: { zapry: {} } })).toEqual([
      DEFAULT_ACCOUNT_ID,
    ]);
  });

  it("returns [] and falls back to DEFAULT_ACCOUNT_ID when nothing is configured", () => {
    expect(listZapryAccountIds({})).toEqual([]);
    expect(resolveDefaultZapryAccountId({})).toBe(DEFAULT_ACCOUNT_ID);
  });
});
