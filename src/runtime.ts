import { AsyncLocalStorage } from "node:async_hooks";

type PluginRuntime = any;

export type ZaprySkillInvocationContext = {
  senderId: string;
  messageSid?: string;
  sessionKey?: string;
  accountId?: string;
  chatId?: string;
  chatType?: string;
  chatTitle?: string;
  clubId?: string;
};

let _runtime: PluginRuntime | null = null;
const _skillInvocationContext = new AsyncLocalStorage<ZaprySkillInvocationContext>();

export function setZapryRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getZapryRuntime(): PluginRuntime {
  if (!_runtime) {
    throw new Error("Zapry plugin runtime not initialized");
  }
  return _runtime;
}

export function runWithZaprySkillInvocationContext<T>(
  ctx: ZaprySkillInvocationContext,
  fn: () => T,
): T {
  return _skillInvocationContext.run(ctx, fn);
}

export function getZaprySkillInvocationContext(): ZaprySkillInvocationContext | null {
  return _skillInvocationContext.getStore() ?? null;
}

export function buildZaprySkillRequestHeaders(input: {
  senderId?: string;
  messageSid?: string;
}): Record<string, string> {
  const senderId = String(input.senderId ?? "").trim();
  if (!senderId) {
    throw new Error("Zapry skill invocation requires trusted inbound sender context");
  }

  const headers: Record<string, string> = {
    "X-Zapry-Invocation-Source": "skill",
    "X-Zapry-Request-Sender-Id": senderId,
  };

  const messageSid = String(input.messageSid ?? "").trim();
  if (messageSid) {
    headers["X-Zapry-Message-Sid"] = messageSid;
  }

  return headers;
}

export function resolveZaprySkillRequestHeaders(): Record<string, string> {
  const invocationCtx = getZaprySkillInvocationContext();
  return buildZaprySkillRequestHeaders({
    senderId: invocationCtx?.senderId,
    messageSid: invocationCtx?.messageSid,
  });
}
