export const API_SCHEME = "mdcz-api";
export const APP_URL = `${API_SCHEME}://app`;

/** The window only ever shows the web app from the API scheme; nothing else may call the bridge or the API. */
export const isTrustedRendererUrl = (url: string): boolean => {
  try {
    const candidate = new URL(url);
    return candidate.protocol === `${API_SCHEME}:` && candidate.host === "app";
  } catch {
    return false;
  }
};
