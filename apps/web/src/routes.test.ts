import { DESKTOP_ROUTE_DEFINITIONS } from "@mdcz/shared/desktopNavigation";
import { PRIMARY_SHELL_NAV, SYSTEM_SHELL_NAV } from "@mdcz/views/shell";
import { describe, expect, it } from "vitest";
import { buildHref } from "./routeHelpers";

describe("route helpers", () => {
  it("builds links with encoded query parameters", () => {
    expect(buildHref("/settings", { setting: "paths.mediaPath", rootId: "root-1", unused: undefined })).toBe(
      "/settings?setting=paths.mediaPath&rootId=root-1",
    );
  });

  it("keeps Web navigation aligned with desktop routes", () => {
    expect([...PRIMARY_SHELL_NAV, ...SYSTEM_SHELL_NAV].map((route) => [route.label, route.to])).toEqual(
      DESKTOP_ROUTE_DEFINITIONS.map((route) => [route.label, route.path]),
    );
  });
});
