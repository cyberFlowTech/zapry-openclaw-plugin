import { AsyncLocalStorage } from "node:async_hooks";

type PluginRuntime = any;

export type ZaprySkillInvocationContext = {
  senderId: string;
  messageSid?: string;
  sessionKey?: string;
  accountId?: string;
  chatId?: string;
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
