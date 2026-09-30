type MediaInfoTrack = Record<string, unknown>;

export interface MediaInfoResult {
  media?: {
    track?: MediaInfoTrack[];
  };
}

export const isTrackType = (track: MediaInfoTrack | undefined, type: string): boolean => track?.["@type"] === type;

export const mediaInfoFactory = async () => ({
  analyzeData: async (): Promise<MediaInfoResult> => ({ media: { track: [] } }),
});
