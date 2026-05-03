import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuthSessionDto } from "@mdcz/shared/serverDtos";
import type { ServerRuntimePaths } from "./configService";

export const DEFAULT_ADMIN_PASSWORD = "admin";

interface AuthState {
  setupCompleted: boolean;
  adminPassword?: string;
}

const safeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export class AuthService {
  readonly #tokens = new Set<string>();
  #state: AuthState | null = null;

  constructor(
    private readonly paths: Pick<ServerRuntimePaths, "configDir">,
    private readonly environmentPassword = process.env.MDCZ_ADMIN_PASSWORD,
  ) {}

  get passwordFromEnvironment(): string | undefined {
    return this.environmentPassword;
  }

  async setup(mediaRootCount = 0): Promise<AuthSessionDto> {
    return await this.status(undefined, mediaRootCount);
  }

  async status(token?: string, mediaRootCount = 0): Promise<AuthSessionDto> {
    const state = await this.loadState();
    const adminPassword = this.currentAdminPassword(state);
    return {
      authenticated: Boolean(token && this.#tokens.has(token)),
      setupRequired: !state.setupCompleted || adminPassword === DEFAULT_ADMIN_PASSWORD || mediaRootCount === 0,
      usingDefaultPassword: adminPassword === DEFAULT_ADMIN_PASSWORD,
      environmentPassword: this.environmentPassword,
    };
  }

  async login(password: string): Promise<AuthSessionDto> {
    const state = await this.loadState();
    if (!safeEquals(password, this.currentAdminPassword(state))) {
      throw new Error("Invalid admin password");
    }

    const token = randomBytes(24).toString("base64url");
    this.#tokens.add(token);
    return { authenticated: true, token };
  }

  logout(token?: string): AuthSessionDto {
    if (token) {
      this.#tokens.delete(token);
    }
    return { authenticated: false };
  }

  assertAuthenticated(token?: string): void {
    if (!token || !this.#tokens.has(token)) {
      throw new Error("Authentication required");
    }
  }

  async completeSetup(password: string): Promise<AuthSessionDto> {
    if (password === DEFAULT_ADMIN_PASSWORD) {
      throw new Error("不能使用默认管理员密码 admin 完成初始化");
    }

    const state = await this.loadState();
    state.setupCompleted = true;
    if (!this.environmentPassword) {
      state.adminPassword = password;
    }
    await this.persistState(state);
    return await this.login(this.environmentPassword ?? password);
  }

  private currentAdminPassword(state: AuthState): string {
    return this.environmentPassword ?? state.adminPassword ?? DEFAULT_ADMIN_PASSWORD;
  }

  private async loadState(): Promise<AuthState> {
    if (this.#state) {
      return this.#state;
    }

    const statePath = this.statePath();
    if (!existsSync(statePath)) {
      this.#state = { setupCompleted: false };
      return this.#state;
    }

    this.#state = JSON.parse(await readFile(statePath, "utf8")) as AuthState;
    return this.#state;
  }

  private async persistState(state: AuthState): Promise<void> {
    this.#state = state;
    await mkdir(this.paths.configDir, { recursive: true });
    await writeFile(this.statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private statePath(): string {
    return path.join(this.paths.configDir, "auth-state.json");
  }
}
