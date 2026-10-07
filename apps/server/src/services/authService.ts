import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ApiKeyCreateInput,
  ApiKeyCreateResponse,
  ApiKeyListResponse,
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

/** Authentication failures answer 401 on plain HTTP routes; tRPC maps them to UNAUTHORIZED itself. */
export class AuthenticationError extends Error {
  override readonly name = "AuthenticationError";
  readonly statusCode = 401;
}

const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/**
 * WebUI sessions and API keys are stored as hashes in the database, so sessions survive restarts and container
 * updates. API keys authorize only the automation endpoints, never the WebUI.
 */
export class AuthService {
  readonly #touchedSessions = new Map<string, number>();

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

  async login(password: string): Promise<AuthSessionDto> {
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
    if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect administrator password" });
    const token = randomBytes(24).toString("base64url");
    (await this.persistence.getState()).repositories.credentials.createSession(hashSecret(token));
    return { authenticated: true, token };
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
    const salt = randomBytes(16);
    const hash = (await deriveKey(input.password, salt, 64)) as Buffer;
    await mkdir(this.paths.configDir, { recursive: true, mode: 0o700 });
    const statePath = path.join(this.paths.configDir, "auth-state.json");
    const temporaryPath = `${statePath}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ passwordHash: `scrypt$${salt.toString("hex")}$${hash.toString("hex")}` })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600, flush: true },
      );
      // Publishing a complete file with link() also rejects concurrent registration.
      await link(temporaryPath, statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new TRPCError({ code: "CONFLICT", message: "Administrator already exists; please sign in" });
      }
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return await this.login(input.password);
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
    const statePath = path.join(this.paths.configDir, "auth-state.json");
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
