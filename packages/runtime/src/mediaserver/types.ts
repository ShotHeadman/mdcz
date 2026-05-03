export interface MediaServerPerson {
  id: string;
  name: string;
  overview?: string;
  imageTags?: Record<string, string>;
  raw: unknown;
}

export interface MediaServerProbeResult {
  ok: boolean;
  message: string;
  serverName?: string;
  version?: string;
  personCount?: number;
}
