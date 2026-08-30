import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeInfoActorSourceProvider } from "@mdcz/runtime/mediaserver/infoSync";
import type { RuntimePhotoActorSourceProvider } from "@mdcz/runtime/mediaserver/photoSync";
import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it, vi } from "vitest";
import { createServerActorSourceProvider, serverActorImageCacheRoot } from "./actorSourceFactory";
import type { ServerConfigService } from "./services/configService";

const runtimeRoot = join(tmpdir(), "mdcz-actor-source");
const fakeConfig = {
  runtimePaths: {
    configDir: join(runtimeRoot, "config"),
    dataDir: join(runtimeRoot, "data"),
    configPath: join(runtimeRoot, "config", "default.toml"),
    databasePath: join(runtimeRoot, "data", "mdcz.sqlite"),
  },
} as ServerConfigService;

class FakeNetworkClient {
  readonly getJson = vi.fn(async () => ({}));
  readonly getText = vi.fn(async () => "");
  readonly getContent = vi.fn(async () => new Uint8Array());
  readonly postText = vi.fn(async () => "");
  readonly postJson = vi.fn(async () => ({}));
  readonly head = vi.fn(async () => ({ status: 200, ok: true }));
  readonly probe = vi.fn(async () => ({ ok: true, status: 200, contentLength: null, resolvedUrl: "" }));
  readonly download = vi.fn(async () => "");
  readonly createSession = vi.fn(() => ({ getText: vi.fn(async () => "") }));
  readonly registerSiteRequestConfigs = vi.fn();
}

describe("createServerActorSourceProvider", () => {
  it("roots the actor image cache under runtimePaths.dataDir", () => {
    expect(serverActorImageCacheRoot(fakeConfig)).toBe(join(fakeConfig.runtimePaths.dataDir, "actor-image-cache"));
  });

  it("satisfies the photo and info sync ports and looks up without throwing", async () => {
    const provider = createServerActorSourceProvider(
      new FakeNetworkClient() as never,
      {
        cacheRoot: serverActorImageCacheRoot(fakeConfig),
        resolveLocalImage: async () => undefined,
        materializeForMovie: async () => undefined,
        prepareActorProfilesForMovie: async () => undefined,
      } as never,
    );
    const photoPort: RuntimePhotoActorSourceProvider = provider;
    const infoPort: RuntimeInfoActorSourceProvider = provider;
    const configuration = configurationSchema.parse({
      ...defaultConfiguration,
      personSync: {
        ...defaultConfiguration.personSync,
        personOverviewSources: ["official"],
        personImageSources: ["local"],
      },
      paths: {
        ...defaultConfiguration.paths,
        mediaPath: "",
      },
    });

    const result = await provider.lookup(configuration, { name: "Actor A" });

    expect(photoPort).toBe(provider);
    expect(infoPort).toBe(provider);
    expect(result.profile.name).toBe("Actor A");
  });
});
