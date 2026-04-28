import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface RuntimeLog {
  id: string;
  timestamp: string;
  level: string;
  message: string | object | null;
}

export const createRuntimeLog = (
  level: string,
  message: string | object | null,
  timestamp: string | number = new Date().toISOString(),
): RuntimeLog => {
  return {
    id: crypto.randomUUID(),
    timestamp: typeof timestamp === "number" ? new Date(timestamp).toISOString() : timestamp,
    level,
    message,
  };
};

interface LogStore {
  logs: RuntimeLog[];
  addLog: (log: RuntimeLog) => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogStore>()(
  subscribeWithSelector((set) => ({
    logs: [],

    addLog: (log) =>
      set((state) => {
        const newLogs = [...state.logs, log];
        if (newLogs.length > 1000) {
          return { logs: newLogs.slice(-1000) };
        }
        return { logs: newLogs };
      }),

    clearLogs: () => set({ logs: [] }),
  })),
);
