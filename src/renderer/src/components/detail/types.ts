export type DetailViewStatus = "success" | "failed" | "processing";

export interface DetailViewItem {
  id: string;
  status: DetailViewStatus;
  number: string;
  minimalErrorView?: boolean;
  title?: string;
  path?: string;
  nfoPath?: string;
  actors?: string[];
  outline?: string;
  tags?: string[];
  release?: string;
  duration?: string;
  resolution?: string;
  codec?: string;
  bitrate?: string;
  directors?: string[];
  series?: string;
  studio?: string;
  publisher?: string;
  score?: string;
  posterUrl?: string;
  thumbUrl?: string;
  fanartUrl?: string;
  outputPath?: string;
  sceneImages?: string[];
  errorMessage?: string;
}
