import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { VideoMeta } from "@mdcz/shared/types";
import { isTrackType, type MediaInfo, type MediaInfoResult, mediaInfoFactory } from "mediainfo.js";
import { isStrmFile } from "./strm";

const CHUNK_SIZE = 64 * 1024;

const toPositiveNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const toVideoMetadata = (result: MediaInfoResult): VideoMeta | undefined => {
  const tracks = result.media?.track ?? [];
  const generalTrack = tracks.find((track) => isTrackType(track, "General"));
  const videoTrack = tracks.find((track) => isTrackType(track, "Video"));

  const durationSeconds = toPositiveNumber(generalTrack?.Duration);
  const width = toPositiveNumber(videoTrack?.Width);
  const height = toPositiveNumber(videoTrack?.Height);
  const bitrate = toPositiveNumber(videoTrack?.BitRate) ?? toPositiveNumber(generalTrack?.OverallBitRate);
  if (durationSeconds === undefined && width === undefined && height === undefined && bitrate === undefined) {
    return undefined;
  }

  return {
    durationSeconds: durationSeconds ?? 0,
    width: width === undefined ? 0 : Math.round(width),
    height: height === undefined ? 0 : Math.round(height),
    bitrate,
  };
};

/** `wasmPath` is only needed when the module is not next to mediainfo.js, as in the packaged desktop app. */
export const createVideoProbe = (wasmPath?: string) => {
  let mediaInfo: Promise<MediaInfo<"object">> | undefined;
  // The WASM instance reads one file at a time; concurrent analyzeData calls corrupt each other's reads.
  let queue: Promise<unknown> = Promise.resolve();

  const analyze = async (filePath: string): Promise<VideoMeta | undefined> => {
    mediaInfo ??= mediaInfoFactory({
      format: "object",
      chunkSize: CHUNK_SIZE,
      ...(wasmPath ? { locateFile: () => pathToFileURL(wasmPath).href } : {}),
    });
    const instance = await mediaInfo;
    const handle = await open(filePath, "r");
    try {
      const { size } = await handle.stat();
      const result = await instance.analyzeData(
        () => size,
        async (chunkSize, offset) => {
          const length = Math.min(chunkSize > 0 ? chunkSize : CHUNK_SIZE, Math.max(0, size - offset));
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          return buffer.subarray(0, bytesRead);
        },
      );
      return toVideoMetadata(result);
    } finally {
      await handle.close();
    }
  };

  return (filePath: string): Promise<VideoMeta | undefined> => {
    if (isStrmFile(filePath)) return Promise.resolve(undefined);
    const run = queue.then(() => analyze(filePath));
    queue = run.catch(() => undefined);
    return run;
  };
};
