import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import type { PersistenceDatabase } from "@mdcz/persistence";
import { vi } from "vitest";

export const collectObservableTrace = (
  sqlite: PersistenceDatabase["sqlite"],
  roots: Record<string, string>,
  crossDevice = false,
) => {
  const events: { channel: string; operation: string; args: unknown[] }[] = [];
  const normalize = (value: unknown): unknown => {
    if (Buffer.isBuffer(value)) return { bytes: value.length };
    if (typeof value !== "string") return typeof value === "object" ? String(value) : value;
    let text = value;
    for (const [name, root] of Object.entries(roots)) text = text.replaceAll(root, `<${name}>`);
    return text.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
  };
  const record = (channel: string, operation: string, ...args: unknown[]) => {
    events.push({ channel, operation, args: args.map(normalize) });
  };
  const restores: (() => void)[] = [];
  for (const operation of [
    "readdir",
    "stat",
    "realpath",
    "statfs",
    "copyFile",
    "rename",
    "mkdir",
    "rm",
    "readFile",
    "writeFile",
    "open",
  ] as const) {
    const original = fs[operation];
    const spy = vi.spyOn(fs, operation);
    spy.mockImplementation((async (...args: unknown[]) => {
      record("filesystem", operation, ...args);
      if (
        crossDevice &&
        operation === "rename" &&
        typeof args[0] === "string" &&
        !path.relative(roots.media, args[0]).startsWith("..") &&
        path.extname(args[0]).toLowerCase() === ".mp4" &&
        !path.relative(roots.media, args[0]).split(path.sep).includes("output")
      ) {
        record("filesystem-result", operation, "EXDEV");
        throw Object.assign(new Error("Fixture cross-device boundary"), { code: "EXDEV" });
      }
      return Reflect.apply(original, fs, args);
    }) as never);
    restores.push(() => spy.mockRestore());
  }
  syncBuiltinESMExports();
  const prepare = sqlite.prepare.bind(sqlite);
  const prepareSpy = vi.spyOn(sqlite, "prepare").mockImplementation((sql: string) => {
    const statement = prepare(sql);
    for (const method of ["run", "get", "all", "iterate"] as const) {
      const original = statement[method].bind(statement);
      vi.spyOn(statement, method).mockImplementation(((...args: unknown[]) => {
        record("sql", method, sql, ...args);
        return Reflect.apply(original, statement, args);
      }) as never);
    }
    return statement;
  });
  const exec = sqlite.exec.bind(sqlite);
  const execSpy = vi.spyOn(sqlite, "exec").mockImplementation((sql: string) => {
    record("sql", "exec", sql);
    return exec(sql);
  });
  const transaction = sqlite.transaction.bind(sqlite);
  const transactionSpy = vi.spyOn(sqlite, "transaction").mockImplementation(((fn: (...args: unknown[]) => unknown) => {
    return transaction((...args: unknown[]) => {
      record("transaction", "begin");
      try {
        const value = fn(...args);
        record("transaction", "commit");
        return value;
      } catch (error) {
        record("transaction", "rollback");
        throw error;
      }
    });
  }) as typeof sqlite.transaction);
  let stopped = false;
  return {
    record,
    stop: () => {
      if (!stopped) {
        for (const restore of restores) restore();
        syncBuiltinESMExports();
        prepareSpy.mockRestore();
        execSpy.mockRestore();
        transactionSpy.mockRestore();
        stopped = true;
      }
      return {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceDiffSha256: createHash("sha256")
          .update(execFileSync("git", ["diff", "HEAD", "--", "apps", "tests", "packages"]))
          .digest("hex"),
        counts: Object.fromEntries(
          [...new Set(events.map((event) => `${event.channel}.${event.operation}`))]
            .sort()
            .map((key) => [key, events.filter((event) => `${event.channel}.${event.operation}` === key).length]),
        ),
        events,
      };
    },
  };
};
