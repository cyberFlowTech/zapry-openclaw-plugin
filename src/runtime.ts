type PluginRuntime = any;

let _runtime: PluginRuntime | null = null;

export function setZapryRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getZapryRuntime(): PluginRuntime {
  if (!_runtime) {
    throw new Error("Zapry plugin runtime not initialized");
  }
  return _runtime;
}
