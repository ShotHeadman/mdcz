import { describe, expect, it } from "vitest";
import { resolveServerRuntimePaths } from "./services/configService";

describe("resolveServerRuntimePaths", () => {
  it("uses XDG-style defaults on Linux", () => {
    const paths = resolveServerRuntimePaths({ env: {}, platform: "linux", homeDir: "/home/tester" });

    expect(paths.configDir).toBe("/home/tester/.local/state/mdcz/config");
    expect(paths.dataDir).toBe("/home/tester/.local/state/mdcz/data");
    expect(paths.configPath).toBe("/home/tester/.local/state/mdcz/config/default.toml");
    expect(paths.databasePath).toBe("/home/tester/.local/state/mdcz/data/mdcz.sqlite");
  });

  it("supports explicit env overrides", () => {
    const paths = resolveServerRuntimePaths({
      env: {
        MDCZ_CONFIG_DIR: "/srv/mdcz/config",
        MDCZ_DATA_DIR: "/srv/mdcz/data",
        MDCZ_DATABASE_PATH: "/srv/mdcz/database.sqlite",
      },
      platform: "linux",
      homeDir: "/home/tester",
    });

    expect(paths.configDir).toBe("/srv/mdcz/config");
    expect(paths.dataDir).toBe("/srv/mdcz/data");
    expect(paths.databasePath).toBe("/srv/mdcz/database.sqlite");
  });
});
