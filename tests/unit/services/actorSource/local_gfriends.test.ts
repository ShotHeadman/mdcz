import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  buildLocalActorIndex,
  GfriendsActorSource,
  LocalActorSource,
} from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-actor-source-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

class FakeNetworkClient {
  readonly getJson = vi.fn(async (_url: string) => ({}));
}

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: ["Actor A"],
  actor_profiles: [
    {
      name: "Actor A",
      photo_url: "thumbs/actor-a.jpg",
    },
  ],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("Actor source local and gfriends", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("filters out movie-local, missing, and remote actor thumbs from the shared local actor index", async () => {
    const cases = [
      {
        setup: async (movieDir: string) => {
          const thumbPath = join(movieDir, "thumbs", "actor-a.jpg");
          await mkdir(dirname(thumbPath), { recursive: true });
          await writeFile(thumbPath, "thumb", "utf8");
          await writeFile(join(movieDir, "ABC-123.nfo"), new NfoGenerator().buildXml(createCrawlerData()), "utf8");
        },
      },
      {
        setup: async (movieDir: string) => {
          await mkdir(movieDir, { recursive: true });
          await writeFile(join(movieDir, "ABC-123.nfo"), new NfoGenerator().buildXml(createCrawlerData()), "utf8");
        },
      },
      {
        setup: async (movieDir: string) => {
          await mkdir(movieDir, { recursive: true });
          await writeFile(
            join(movieDir, "ABC-123.nfo"),
            new NfoGenerator().buildXml(
              createCrawlerData({
                actor_profiles: [
                  {
                    name: "Actor A",
                    photo_url: "https://img.example.com/actor-a.jpg",
                  },
                ],
              }),
            ),
            "utf8",
          );
        },
      },
    ];

    for (const { setup } of cases) {
      const root = await createTempDir();
      const movieDir = join(root, "Actor A", "ABC-123");
      await setup(movieDir);

      const sources = await buildLocalActorIndex(
        createConfig({
          paths: {
            ...defaultConfiguration.paths,
            mediaPath: root,
          },
        }),
      );

      expect(sources.get("actora")).toMatchObject({
        name: "Actor A",
        photo_url: undefined,
      });
      expect(sources.get("aliasa")).toBeUndefined();
    }
  });

  it("uses exact local names to resolve gfriends image matches through the provider", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "Actor A", "ABC-123");
    await mkdir(movieDir, { recursive: true });
    await writeFile(join(movieDir, "ABC-123.nfo"), new NfoGenerator().buildXml(createCrawlerData()), "utf8");

    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      if (url === "https://example.com/Filetree.json") {
        return {
          Content: {
            actresses: {
              "Actor A": "actor-a.jpg",
            },
          },
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([
        new LocalActorSource(),
        new GfriendsActorSource({
          networkClient: networkClient as unknown as NetworkClient,
          actorMapUrl: "https://example.com/Filetree.json",
        }),
      ]),
    });

    const result = await provider.lookup(
      createConfig({
        paths: {
          ...defaultConfiguration.paths,
          mediaPath: root,
        },
        personSync: {
          ...defaultConfiguration.personSync,
          personImageSources: ["local", "gfriends"],
        },
      }),
      "Actor A",
    );

    expect(result.profile).toMatchObject({
      name: "Actor A",
      photo_url: "https://example.com/Content/actresses/actor-a.jpg",
    });
    expect(result.profileSources.photo_url).toBe("gfriends");
  });
});
