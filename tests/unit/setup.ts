import { vi } from "vitest";

vi.mock("electron", () => import("./electronMock"));

vi.mock("@egoist/tipc/main", () => {
  type MockProcedure = {
    input: () => MockProcedure;
    action: <TInput, TResult>(
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>,
    ) => {
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>;
    };
  };
  const createProcedure = (): MockProcedure => ({
    input: () => createProcedure(),
    action: (action) => ({ action }),
  });

  return {
    tipc: {
      create: () => ({ procedure: createProcedure() }),
    },
  };
});
