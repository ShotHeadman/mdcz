import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthSessionDto } from "@mdcz/shared/serverDtos";

const DEFAULT_ADMIN_PASSWORD = "admin";

const safeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export class AuthService {
  readonly #tokens = new Set<string>();

  constructor(private readonly adminPassword = process.env.MDCZ_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD) {}

  status(token?: string): AuthSessionDto {
    return { authenticated: Boolean(token && this.#tokens.has(token)) };
  }

  login(password: string): AuthSessionDto {
    if (!safeEquals(password, this.adminPassword)) {
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
}
