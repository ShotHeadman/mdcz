import { SiteError } from "@mdcz/runtime/network";

const LOGIN_PATTERNS = [/fanza\s*ログイン/iu, /会員ログイン/iu, /\bログイン\b/iu, /\blogin\b/iu];

const hasDmmMetadataSignals = (html: string): boolean =>
  html.includes('id="title"') ||
  html.includes("application/ld+json") ||
  html.includes("出演者") ||
  html.includes("品番") ||
  html.includes("<h1");

const isDmmLoginWallHtml = (html: string, title?: string): boolean => {
  const merged = `${title ?? ""}\n${html}`;
  const hasLoginKeyword = LOGIN_PATTERNS.some((pattern) => pattern.test(merged));
  const hasPasswordField = /type=["']password["']/iu.test(html);
  const hasAuthField = /name=["'](?:mail|email|password|login_id|id_password)["']/iu.test(html);
  return (
    hasLoginKeyword && (hasPasswordField || hasAuthField || LOGIN_PATTERNS.some((pattern) => pattern.test(title ?? "")))
  );
};

const isDmmUnrenderedShellHtml = (html: string): boolean => {
  const lowered = html.toLowerCase();
  const hasNextShellMarker = lowered.includes("self.__next_f.push") || lowered.includes("/_next/static/chunks/");
  return hasNextShellMarker && !hasDmmMetadataSignals(html);
};

/** Region blocks are recognized by the network layer; these are the DMM pages that only look like a detail page. */
export const classifyDmmDetailFailure = (
  html: string,
  title: string | undefined,
  siteLabel: "DMM" | "DMM_TV",
): SiteError | null => {
  if (isDmmLoginWallHtml(html, title)) return new SiteError("login_wall", `${siteLabel}: login wall`);
  if (isDmmUnrenderedShellHtml(html)) return new SiteError("empty_shell", `${siteLabel}: unrendered shell`);
  return null;
};
