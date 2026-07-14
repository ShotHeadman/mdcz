import type { CrawlerLiveCase } from "./crawler-live-catalog";

export type CrawlerLiveTarget = "web" | "desktop";
export type CrawlerLiveFailureKind =
  | "network"
  | "timeout"
  | "rate_limited"
  | "blocked"
  | "authentication"
  | "not_found"
  | "contract_mismatch"
  | "parser"
  | "unknown";

export interface CrawlerLiveCaseResult {
  caseId: string;
  site: string;
  number: string;
  label: string;
  durationMs: number;
  status: "passed" | "failed";
  failureKind?: CrawlerLiveFailureKind;
  summary: string;
}

export interface CrawlerLiveReport {
  schemaVersion: 1;
  catalogVersion: string;
  target: CrawlerLiveTarget;
  appVersion: string;
  commit: string | null;
  startedAt: string;
  finishedAt: string;
  totals: {
    passed: number;
    failed: number;
    total: number;
  };
  cases: CrawlerLiveCaseResult[];
}

const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(authorization|cookie|headers?|password|raw.?response|response.?body|secret|token)\b\s*[:=]\s*(?:bearer\s+[^\s,;]+|"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/giu;
const UNIX_PRIVATE_PATH_PATTERN = /\/(?:home|users|private|var\/folders)\/[^\s"']+/giu;
const WINDOWS_PRIVATE_PATH_PATTERN = /\b[a-z]:\\[^\s"']+/giu;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

export const sanitizeCrawlerLiveDiagnostic = (value: unknown): string => {
  const text = value instanceof Error ? value.message : String(value ?? "Unknown failure");
  return text
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1=[redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(UNIX_PRIVATE_PATH_PATTERN, "[redacted-path]")
    .replace(WINDOWS_PRIVATE_PATH_PATTERN, "[redacted-path]")
    .slice(0, 800);
};

export const classifyCrawlerLiveFailure = (value: unknown): CrawlerLiveFailureKind => {
  const message = sanitizeCrawlerLiveDiagnostic(value).toLowerCase();
  if (/429|rate.?limit|too many requests|请求过于频繁/u.test(message)) return "rate_limited";
  if (/401|403|auth|login|cookie|credential|unauthori[sz]ed|forbidden|认证|登录/u.test(message)) {
    return "authentication";
  }
  if (/locator|element\(s\) not found|tobevisible|required field|contract|assert|字段|合同/u.test(message)) {
    return "contract_mismatch";
  }
  if (/404|not.?found|no result|未找到|未获取到|未抓取到|不存在/u.test(message)) return "not_found";
  if (/blocked|captcha|cloudflare|robot|access denied|访问受限|反爬/u.test(message)) return "blocked";
  if (/parse|parser|extract|解析/u.test(message)) return "parser";
  if (/timeout|timed out|超时/u.test(message)) return "timeout";
  if (/network|fetch|dns|econn|socket|tls|connection|网络|连接/u.test(message)) return "network";
  return "unknown";
};

export const passedCrawlerLiveCase = (
  liveCase: CrawlerLiveCase,
  durationMs: number,
  summary: string,
): CrawlerLiveCaseResult => ({
  caseId: liveCase.id,
  site: liveCase.site,
  number: liveCase.number,
  label: liveCase.label,
  durationMs,
  status: "passed",
  summary: sanitizeCrawlerLiveDiagnostic(summary),
});

export const failedCrawlerLiveCase = (
  liveCase: CrawlerLiveCase,
  durationMs: number,
  error: unknown,
): CrawlerLiveCaseResult => ({
  caseId: liveCase.id,
  site: liveCase.site,
  number: liveCase.number,
  label: liveCase.label,
  durationMs,
  status: "failed",
  failureKind: classifyCrawlerLiveFailure(error),
  summary: sanitizeCrawlerLiveDiagnostic(error),
});

export const buildCrawlerLiveReport = (input: {
  catalogVersion: string;
  target: CrawlerLiveTarget;
  appVersion: string;
  commit?: string;
  startedAt: Date;
  finishedAt: Date;
  cases: CrawlerLiveCaseResult[];
}): CrawlerLiveReport => {
  const passed = input.cases.filter((result) => result.status === "passed").length;
  const failed = input.cases.length - passed;
  return {
    schemaVersion: 1,
    catalogVersion: input.catalogVersion,
    target: input.target,
    appVersion: input.appVersion,
    commit: input.commit?.trim() || null,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    totals: { passed, failed, total: input.cases.length },
    cases: input.cases,
  };
};
