import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AuthSessionDto, SetupCompleteInput } from "@mdcz/shared/serverDtos";
import { TRPCError } from "@trpc/server";
import type { ServerRuntimePaths } from "./configService";

const deriveKey = promisify(scrypt);

export class AuthService {
  readonly #tokens = new Set<string>();

  constructor(
    private readonly paths: Pick<ServerRuntimePaths, "configDir">,
    private readonly environmentPassword = process.env.MDCZ_ADMIN_PASSWORD || undefined,
  ) {}

  get environmentPasswordConfigured(): boolean {
    return Boolean(this.environmentPassword);
  }

  async status(token?: string): Promise<AuthSessionDto> {
    const passwordHash = await this.readPasswordHash();
    return {
      authenticated: Boolean(token && this.#tokens.has(token)),
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
    if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "管理员密码错误" });
    const token = randomBytes(24).toString("base64url");
    this.#tokens.add(token);
    return { authenticated: true, token };
  }

  logout(token?: string): AuthSessionDto {
    if (token) this.#tokens.delete(token);
    return { authenticated: false };
  }

  assertAuthenticated(token?: string): void {
    if (!token || !this.#tokens.has(token)) throw new Error("Authentication required");
  }

  async completeSetup(input: SetupCompleteInput): Promise<AuthSessionDto> {
    if (!(await this.status()).setupRequired) {
      throw new TRPCError({ code: "FORBIDDEN", message: "系统已完成初始化，请直接登录" });
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
        throw new TRPCError({ code: "CONFLICT", message: "管理员已创建，请登录" });
      }
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return await this.login(input.password);
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
