export interface DmmFailureClassificationInput {
  html: string;
  siteLabel: "DMM" | "DMM_TV";
  title?: string;
  detailUrl?: string;
}

const REGION_PATTERNS = [
  /not-available-in-your-region/iu,
  /このページはお住まいの地域からご利用になれません/iu,
  /このサービスはお住まいの地域からはご利用になれません/iu,
  /海外プロバイダ/iu,
  /access from your region is not available/iu,
];

const LOGIN_PATTERNS = [/fanza\s*ログイン/iu, /会員ログイン/iu, /\bログイン\b/iu, /\blogin\b/iu];

export const hasDmmMetadataSignals = (html: string): boolean => {
  return (
    html.includes('id="title"') ||
    html.includes("application/ld+json") ||
    html.includes("出演者") ||
    html.includes("品番") ||
    html.includes("<h1")
  );
};

export const isDmmNotFoundHtml = (html: string): boolean => {
  return /404\s*not\s*found/iu.test(html) || html.includes("お探しの商品は見つかりません");
};

export const isDmmUsableDetailHtml = (html: string): boolean => {
  return !isDmmNotFoundHtml(html) && hasDmmMetadataSignals(html);
};

export const isDmmRegionBlockedHtml = (html: string, title?: string, detailUrl?: string): boolean => {
  const merged = `${title ?? ""}\n${html}`;
  if (REGION_PATTERNS.some((pattern) => pattern.test(merged))) {
    return true;
  }

  return (detailUrl ?? "").toLowerCase().includes("special.dmm.co.jp/not-available-in-your-region");
};

export const isDmmLoginWallHtml = (html: string, title?: string): boolean => {
  const merged = `${title ?? ""}\n${html}`;
  const hasLoginKeyword = LOGIN_PATTERNS.some((pattern) => pattern.test(merged));
  const hasPasswordField = /type=["']password["']/iu.test(html);
  const hasAuthField = /name=["'](?:mail|email|password|login_id|id_password)["']/iu.test(html);

  return (
    hasLoginKeyword && (hasPasswordField || hasAuthField || LOGIN_PATTERNS.some((pattern) => pattern.test(title ?? "")))
  );
};

export const isDmmUnrenderedShellHtml = (html: string): boolean => {
  const lowered = html.toLowerCase();
  const hasNextShellMarker = lowered.includes("self.__next_f.push") || lowered.includes("/_next/static/chunks/");
  return hasNextShellMarker && !hasDmmMetadataSignals(html);
};

export const classifyDmmDetailFailure = (input: DmmFailureClassificationInput): string | null => {
  const { html, title, detailUrl, siteLabel } = input;

  if (isDmmRegionBlockedHtml(html, title, detailUrl)) {
    return `${siteLabel}: region blocked`;
  }

  if (isDmmLoginWallHtml(html, title)) {
    return `${siteLabel}: login wall`;
  }

  if (isDmmUnrenderedShellHtml(html)) {
    return `${siteLabel}: unrendered shell`;
  }

  return null;
};
