import type { NetworkCookieCheckStatus } from "@mdcz/shared/serverDtos";

export const configForm = {
  cookieCheckStatus: {
    not_configured: () => "Cookie is not configured",
    ready_without_cookie: (site: string) => `${site} movie pages are accessible anonymously; no cookie required`,
    ready_with_cookie: (site: string) => `${site} cookie is valid`,
    invalid_or_expired: (site: string) => `${site} cookie is invalid or expired`,
    verification_required: (site: string) =>
      `${site} requires age/region verification. Complete it in your browser, then copy the cookies again.`,
    login_wall: (site: string) => `${site} login wall detected; the current cookie cannot access movie content.`,
    unexpected_page: (site: string) => `${site} did not return a recognizable page; please try again later.`,
    request_failed: (site: string) => `${site} request failed`,
  } as Record<NetworkCookieCheckStatus, (site: string) => string>,
  cookieCheckFailed: (site: string, error: string) => `${site} cookie check failed: ${error}`,
  cookieCheckNoResult: "no result returned",
  cookieCheckRequestFailed: "Request failed",
  verifying: "Verifying…",
  verifyCookie: "Verify cookie",
  selectOption: "Select an option",
  selectAll: "Select all",
  selectNone: "Select none",
  chipArray: {
    noneSelected: "No fields selected",
    allSelected: (count: number) => `All ${count} fields selected`,
    someSelected: (count: number, preview: string) => `${count} fields selected (${preview}, …)`,
    searchPlaceholder: "Search fields…",
    selectedCount: (selected: number, total: number) => `${selected}/${total} selected`,
    noMatches: "No matching fields",
    inputPlaceholder: "Type text and press Enter or comma to add…",
    empty: "No entries yet",
  },
  orderedSite: {
    enabledCount: (enabled: number, total: number) => `Enabled ${enabled}/${total}`,
    moveUp: (label: string) => `Move ${label} up`,
    moveDown: (label: string) => `Move ${label} down`,
  },
  pathArray: {
    firstPlaceholder: "Absolute path, or a subdirectory of the scan directory",
    remove: "Remove directory",
    add: "Add directory",
  },
  secondsUnit: "s",
};
