export interface RuntimeLog {
  id: string;
  timestamp: string;
  level: string;
  message: string | object | null;
}
