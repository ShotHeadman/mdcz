import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RUNTIME_AUTH_STATE_FILE } from "@mdcz/runtime/config";
import type {
  ApiKeyCreateInput,
  ApiKeyCreateResponse,
  ApiKeyListResponse,
  AuthChangePasswordInput,
  AuthSessionDto,
  SetupCompleteInput,
} from "@mdcz/shared/serverDtos";
import { TRPCError } from "@trpc/server";
import type { ServerRuntimePaths } from "./configService";
import type { ServerPersistenceService } from "./persistenceService";

const deriveKey = promisify(scrypt);
const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
// Recording every request's use would write the database per request; a session's last use is only needed coarsely.
const SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const API_KEY_PREFIX = "mdcz_";
const FREE_LOGIN_FAILURES = 5;
const LOGIN_LOCK_BASE_MS = 30 * 1000;
const LOGIN_LOCK_MAX_MS = 15 * 60 * 1000;

/** Authentication failures answer 401 on plain HTTP routes; tRPC maps them to UNAUTHORIZED itself. */
export class AuthenticationError extends Error {
  override readonly name = "AuthenticationError";
  readonly statusCode = 401;
}

const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/** What the API asks of authentication. The server checks sessions and API keys; desktop admits its one window. */
export type ServerAuth = Pick<
  AuthService,
  | "status"
  | "login"
  | "logout"
  | "assertAuthenticated"
  | "assertAutomation"
  | "listApiKeys"
  | "createApiKey"
  | "deleteApiKey"
  | "completeSetup"
  | "changePassword"
>;

/**
 * WebUI sessions and API keys are stored as hashes in the database, so sessions survive restarts and container
 * updates. API keys authorize only the automation endpoints, never the WebUI.
 */
export class AuthService {
  readonly #touchedSessions = new Map<string, number>();
  readonly #loginFailures = new Map<string, { count: number; lastFailureAt: number; lockedUntil: number }>();

  constructor(
    private readonly paths: Pick<ServerRuntimePaths, "configDir">,
    private readonly persistence: Pick<ServerPersistenceService, "getState">,
    private readonly environmentPassword = process.env.MDCZ_ADMIN_PASSWORD || undefined,
  ) {}

  get environmentPasswordConfigured(): boolean {
    return Boolean(this.environmentPassword);
  }

  async status(token?: string): Promise<AuthSessionDto> {
    const passwordHash = await this.readPasswordHash();
    return {
      authenticated: await this.isSession(token),
      setupRequired: !this.environmentPassword && !passwordHash,
      environmentPasswordConfigured: this.environmentPasswordConfigured,
    };
  }

  async login(password: string, clientAddress = "unknown"): Promise<AuthSessionDto> {
    await this.verifyPassword(password, clientAddress);
    const token = randomBytes(24).toString("base64url");
    (await this.persistence.getState()).repositories.credentials.createSession(hashSecret(token));
    return { authenticated: true, token };
  }

  async changePassword(input: AuthChangePasswordInput, token?: string, clientAddress = "unknown"): Promise<void> {
    if (this.environmentPassword) {
      throw new TRPCError({ code: "FORBIDDEN", message: "The password is set by MDCZ_ADMIN_PASSWORD" });
    }
    await this.verifyPassword(input.currentPassword, clientAddress);
    await this.writePasswordHash(input.newPassword, "replace");
    // A changed password must also lock out whoever might have signed in with the old one.
    const credentials = (await this.persistence.getState()).repositories.credentials;
    credentials.deleteOtherSessions(token ? hashSecret(token) : "");
    this.#touchedSessions.clear();
  }

  async logout(token?: string): Promise<AuthSessionDto> {
    if (token) {
      this.#touchedSessions.delete(hashSecret(token));
      (await this.persistence.getState()).repositories.credentials.deleteSession(hashSecret(token));
    }
    return { authenticated: false };
  }

  async assertAuthenticated(token?: string): Promise<void> {
    if (!(await this.isSession(token))) throw new AuthenticationError("Authentication required");
  }

  /** Automation endpoints accept an API key or a WebUI session. */
  async assertAutomation(token?: string): Promise<void> {
    if (token?.startsWith(API_KEY_PREFIX)) {
      if ((await this.persistence.getState()).repositories.credentials.touchApiKey(hashSecret(token))) return;
      throw new AuthenticationError("Invalid API key");
    }
    await this.assertAuthenticated(token);
  }

  async listApiKeys(): Promise<ApiKeyListResponse> {
    return {
      keys: (await this.persistence.getState()).repositories.credentials.listApiKeys().map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      })),
    };
  }

  async createApiKey(input: ApiKeyCreateInput): Promise<ApiKeyCreateResponse> {
    const secret = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
    const key = (await this.persistence.getState()).repositories.credentials.createApiKey({
      name: input.name,
      prefix: secret.slice(0, API_KEY_PREFIX.length + 4),
      keyHash: hashSecret(secret),
    });
    return {
      secret,
      key: { ...key, createdAt: key.createdAt.toISOString(), lastUsedAt: null },
    };
  }

  async deleteApiKey(id: string): Promise<void> {
    (await this.persistence.getState()).repositories.credentials.deleteApiKey(id);
  }

  async completeSetup(input: SetupCompleteInput): Promise<AuthSessionDto> {
    if (!(await this.status()).setupRequired) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Setup is already complete; please sign in" });
    }
    await this.writePasswordHash(input.password, "create");
    return await this.login(input.password);
  }

  private async verifyPassword(password: string, clientAddress: string): Promise<void> {
    const now = Date.now();
    for (const [address, entry] of this.#loginFailures) {
      if (now - entry.lastFailureAt > LOGIN_LOCK_MAX_MS && entry.lockedUntil <= now)
        this.#loginFailures.delete(address);
    }
    const failures = this.#loginFailures.get(clientAddress);
    if (failures && failures.lockedUntil > now) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many failed sign-ins; try again in ${Math.ceil((failures.lockedUntil - now) / 1000)} s`,
      });
    }
    const passwordHash = await this.readPasswordHash();
    let valid = false;
    if (this.environmentPassword) {
      const supplied = Buffer.from(password);
      const expected = Buffer.from(this.environmentPassword);
      valid = supplied.length === expected.length && timingSafeEqual(supplied, expected);
    } else if (passwordHash) {
      const [, salt, hash] = passwordHash.split("$") as [string, string, string];
      const actual = (await deriveKey(password, Buffer.from(salt, "hex"), 64)) as Buffer;
      valid = timingSafeEqual(actual, Buffer.from(hash, "hex"));
    }
    if (valid) {
      this.#loginFailures.delete(clientAddress);
      return;
    }
    const count = (failures?.count ?? 0) + 1;
    const lockMs =
      count < FREE_LOGIN_FAILURES
        ? 0
        : Math.min(LOGIN_LOCK_BASE_MS * 2 ** (count - FREE_LOGIN_FAILURES), LOGIN_LOCK_MAX_MS);
    this.#loginFailures.set(clientAddress, { count, lastFailureAt: now, lockedUntil: now + lockMs });
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect administrator password" });
  }

  private async writePasswordHash(password: string, mode: "create" | "replace"): Promise<void> {
    const salt = randomBytes(16);
    const hash = (await deriveKey(password, salt, 64)) as Buffer;
    await mkdir(this.paths.configDir, { recursive: true, mode: 0o700 });
    const statePath = path.join(this.paths.configDir, RUNTIME_AUTH_STATE_FILE);
    const temporaryPath = `${statePath}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ passwordHash: `scrypt$${salt.toString("hex")}$${hash.toString("hex")}` })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600, flush: true },
      );
      // Publishing a complete file with link() also rejects concurrent registration.
      if (mode === "create") await link(temporaryPath, statePath);
      else await rename(temporaryPath, statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new TRPCError({ code: "CONFLICT", message: "Administrator already exists; please sign in" });
      }
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async isSession(token?: string): Promise<boolean> {
    if (!token || token.startsWith(API_KEY_PREFIX)) return false;
    const tokenHash = hashSecret(token);
    const now = Date.now();
    const touched = this.#touchedSessions.get(tokenHash);
    if (touched !== undefined && now - touched < SESSION_TOUCH_INTERVAL_MS) return true;
    const valid = (await this.persistence.getState()).repositories.credentials.touchSession(
      tokenHash,
      new Date(now - SESSION_IDLE_MS),
      new Date(now),
    );
    if (valid) this.#touchedSessions.set(tokenHash, now);
    else this.#touchedSessions.delete(tokenHash);
    return valid;
  }

  private async readPasswordHash(): Promise<string | null> {
    const statePath = path.join(this.paths.configDir, RUNTIME_AUTH_STATE_FILE);
    let content: string;
    try {
      content = await readFile(statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const state = JSON.parse(content) as { passwordHash?: unknown } | null;
    if (typeof state?.passwordHash !== "string" || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(state.passwordHash)) {
      throw new Error(
        "Invalid auth-state.json: expected a scrypt password hash. Reset the file while the server is stopped to register again.",
      );
    }
    return state.passwordHash;
  }
}
