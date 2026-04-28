type MediaInfoTrack = Record<string, unknown>;

export interface MediaInfoResult {
  media?: {
    track?: MediaInfoTrack[];
  };
}

type MediaInfoInstance = {
  analyzeData: (...args: unknown[]) => Promise<MediaInfoResult>;
};

type MediaInfoMockState = {
  factory?: (options?: unknown) => Promise<MediaInfoInstance> | MediaInfoInstance;
};

const getState = (): MediaInfoMockState | undefined =>
  (globalThis as typeof globalThis & { __mdczMediaInfoMock?: MediaInfoMockState }).__mdczMediaInfoMock;

export const isTrackType = (track: MediaInfoTrack | undefined, type: string): boolean =>
  track?.["@type"] === type || track?.type === type || track?.Type === type;

export const mediaInfoFactory = async (options?: unknown): Promise<MediaInfoInstance> => {
  const factory = getState()?.factory;
  if (factory) {
    return await factory(options);
  }

  return {
    analyzeData: async () => ({ media: { track: [] } }),
  };
};
