import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLibraryDirectWrite } from "../library/mediaLibraryService";
import { createStagingDirectory, removeStagingDirectory } from "./publicationJournal";
import { matchCloudMount, parseLinuxMountInfo, publicationPolicy } from "./publicationPolicy";

const SAMPLE_MOUNTINFO = [
  "22 1 0:21 / / rw,relatime shared:1 - ext4 /dev/sda1 rw",
  "48 22 0:42 / /mnt/cloud rw,nosuid,nodev shared:18 - fuse.clouddrive2 CloudFS rw",
  "49 22 0:43 / /mnt/cloud/local rw,relatime shared:19 - ext4 /dev/sdb1 rw",
  "50 22 0:44 / /mnt/my\\040drive rw,nosuid shared:20 - fuse.rclone gdrive: rw",
  "51 22 0:45 / /mnt/generic rw,nosuid shared:21 - fuse clouddrive2 rw",
  "52 22 0:46 / /mnt/ntfs rw,nosuid shared:22 - fuseblk /dev/sdc1 rw",
].join("\n");

const directories: string[] = [];

afterEach(async () => {
  publicationPolicy.reset();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("publicationPolicy", () => {
  it("parses Linux mountinfo and matches the deepest cloud FUSE mount only", () => {
    const entries = parseLinuxMountInfo(SAMPLE_MOUNTINFO);
    expect(matchCloudMount("/mnt/cloud/movies/ABC-123", entries)).toEqual({
      mountPoint: "/mnt/cloud",
      fsType: "fuse.clouddrive2",
    });
    expect(matchCloudMount("/mnt/cloud/local/movies", entries)).toBeUndefined();
    expect(matchCloudMount("/mnt/my drive/videos", entries)).toEqual({
      mountPoint: "/mnt/my drive",
      fsType: "fuse.rclone",
    });
    expect(matchCloudMount("/mnt/generic/sub", entries)).toEqual({
      mountPoint: "/mnt/generic",
      fsType: "fuse",
    });
    expect(matchCloudMount("/mnt/ntfs/sub", entries)).toBeUndefined();
    expect(matchCloudMount("/var/media/sub", entries)).toBeUndefined();
  });

  it("redirects staging to local storage only for direct-write libraries and learned EIO roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mdcz-pub-policy-"));
    directories.push(root);
    const localStaging = path.join(root, "data", "staging");
    const cloudOut = path.join(root, "cloud-out");
    const localOut = path.join(root, "local-out");
    const libraries = [
      { placement: "move", sourcePath: path.join(root, "cloud-in"), outputPath: cloudOut, directWrite: true },
      { placement: "move", sourcePath: path.join(root, "cloud-src"), outputPath: localOut, directWrite: false },
      { placement: "inPlace", sourcePath: path.join(root, "inplace-cloud"), outputPath: "", directWrite: true },
    ];

    expect(resolveLibraryDirectWrite(libraries, path.join(cloudOut, "ABC-123"))).toEqual({
      directWrite: true,
      root: cloudOut,
    });
    expect(resolveLibraryDirectWrite(libraries, path.join(localOut, "ABC-123"))).toEqual({
      directWrite: false,
      root: localOut,
    });
    expect(resolveLibraryDirectWrite(libraries, path.join(root, "inplace-cloud", "ABC-123"))).toEqual({
      directWrite: true,
      root: path.join(root, "inplace-cloud"),
    });

    publicationPolicy.configure({
      stagingRoot: () => localStaging,
      resolveTarget: (targetPath) => resolveLibraryDirectWrite(libraries, targetPath),
    });

    const cloudStaging = await createStagingDirectory(path.join(cloudOut, "ABC-123"));
    expect(path.dirname(cloudStaging)).toBe(localStaging);
    expect(existsSync(cloudOut)).toBe(false);
    await removeStagingDirectory(cloudStaging);

    const localMovieDir = path.join(localOut, "ABC-123");
    const localStagingDir = await createStagingDirectory(localMovieDir);
    expect(path.dirname(localStagingDir)).toBe(localMovieDir);
    await removeStagingDirectory(localStagingDir);

    // Learning EIO on one movie inside a library latches the owning library root for subsequent movies.
    await publicationPolicy.markDirectWrite(path.join(localOut, "MovieA", "movie.nfo"));
    expect(await publicationPolicy.isDirectWrite(path.join(localOut, "MovieB", "poster.jpg"))).toBe(true);
    const learnedStaging = await createStagingDirectory(path.join(localOut, "MovieB"));
    expect(path.dirname(learnedStaging)).toBe(localStaging);
    await removeStagingDirectory(learnedStaging);
  });
});
