import { zapryPlugin } from "./src/channel.js";
import { setZapryRuntime } from "./src/runtime.js";

const plugin = {
  id: "zapry",
  name: "Zapry",
  description: "Zapry social platform channel plugin — messaging, groups, feed, clubs, and bot self-management",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  },
  register(api: any) {
    setZapryRuntime(api.runtime);
    api.registerChannel({ plugin: zapryPlugin });
  },
};

export default plugin;
