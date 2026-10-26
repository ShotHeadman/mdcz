import type { ServerAuth } from "@mdcz/server/services/authService";

const unavailable = async (): Promise<never> => {
  throw new Error("Desktop has no sign-in or API keys");
};

/** Desktop has one local user, and its window is the only client of the API, as it was of IPC. */
export const localAuth: ServerAuth = {
  status: async () => ({ authenticated: true, setupRequired: false, environmentPasswordConfigured: false }),
  assertAuthenticated: async () => undefined,
  assertAutomation: async () => undefined,
  login: unavailable,
  logout: unavailable,
  completeSetup: unavailable,
  listApiKeys: unavailable,
  createApiKey: unavailable,
  deleteApiKey: unavailable,
};
