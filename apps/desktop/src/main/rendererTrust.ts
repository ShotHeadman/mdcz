import path from "node:path";
import { fileURLToPath } from "node:url";

export const resolvePackagedRendererPath = (): string => path.resolve(__dirname, "../renderer/index.html");

const comparablePath = (value: string): string => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export const isTrustedRendererUrl = (
  url: string,
  rendererUrl = process.env.ELECTRON_RENDERER_URL,
  packagedRendererPath = resolvePackagedRendererPath(),
): boolean => {
  let candidate: URL;
  try {
    candidate = new URL(url);
  } catch {
    return false;
  }

  const configured = rendererUrl?.trim();
  if (configured) {
    try {
      return candidate.origin === new URL(configured).origin;
    } catch {
      return false;
    }
  }

  if (candidate.protocol !== "file:" || candidate.search) return false;
  try {
    return comparablePath(fileURLToPath(candidate)) === comparablePath(packagedRendererPath);
  } catch {
    return false;
  }
};
