import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import * as bcrypt from "bcrypt";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { VerificationDeliveryService } from "./verification-delivery.service";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const VERIFICATION_CODE_TTL_SECONDS = 60 * 10;
const AUTH_RATE_LIMIT_WINDOW_SECONDS = 60 * 10;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 5;
const VERIFICATION_CODE_MAX_SENDS = 3;
const REFRESH_COOKIE_NAME = "aicp.refreshToken";
const REGISTER_CODE_PURPOSE = "register";
const CONTACT_UPDATE_CODE_PURPOSE = "contact_update";

type RequestContext = {
  ip?: string;
  userAgent?: string;
};

type NormalizedAccount = {
  account: string;
  kind: "email" | "phone";
};

type LoadedUser = {
  id: string;
  accountNo: number;
  email: string | null;
  phone: string | null;
  nickname: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    followers: number;
    following: number;
  };
  preferences: {
    defaultPlatform: string | null;
    writingStyles: string[];
    domains: string[];
    blockedWords: string[];
  } | null;
};

type AuthResult = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  csrfToken: string;
  user: ReturnType<AuthService["safeUser"]>;
};

type AuthAuditEvent = {
  action: "register" | "login" | "logout" | "refresh" | "verification_code";
  status: "success" | "failure";
  account?: string;
  accountKind?: "email" | "phone";
  ip?: string;
  userAgent?: string;
  reason?: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly verificationDelivery: VerificationDeliveryService
  ) {}

  requestVerificationCode(body: { account: string }, context: RequestContext = {}) {
    return this.requestCode(body, REGISTER_CODE_PURPOSE, "verification-code", context);
  }

  requestContactVerificationCode(body: { account: string }, context: RequestContext = {}) {
    return this.requestCode(body, CONTACT_UPDATE_CODE_PURPOSE, "contact-verification-code", context);
  }

  async verifyContactCode(account: string, verificationCode: string) {
    const normalized = this.normalizeAccount(account);
    if (!normalized) {
      throw new BadRequestException("account must be a valid email or phone number");
    }

    await this.assertVerificationCode(normalized, verificationCode, CONTACT_UPDATE_CODE_PURPOSE);
    await this.clearVerificationCode(normalized, CONTACT_UPDATE_CODE_PURPOSE);
  }

  async register(
    body: { account: string; password: string; nickname?: string; verificationCode: string },
    context: RequestContext = {}
  ): Promise<AuthResult> {
    const normalized = this.normalizeAccount(body.account);
    if (!normalized) {
      throw new BadRequestException("account must be a valid email or phone number");
    }

    return this.executeAuthAction("register", normalized, context, async () => {
      if (!body.verificationCode?.trim()) {
        throw new BadRequestException("verification code is required");
      }

      this.validatePasswordStrength(body.password);
      await this.enforceRateLimit("register", normalized, context, AUTH_RATE_LIMIT_MAX_ATTEMPTS);

      const exists = await this.prisma.user.findFirst({ where: this.accountWhere(normalized) });
      if (exists) {
        throw new ConflictException("account already exists");
      }

      await this.assertVerificationCode(normalized, body.verificationCode, REGISTER_CODE_PURPOSE);

      const user = await this.createRegisteredUser({
        email: normalized.kind === "email" ? normalized.account : undefined,
        phone: normalized.kind === "phone" ? normalized.account : undefined,
        passwordHash: await bcrypt.hash(body.password, 10),
        nickname: body.nickname?.trim() || "新创作者",
      });

      await this.clearVerificationCode(normalized, REGISTER_CODE_PURPOSE);
      return this.issueAuthResult(user.id, context, user);
    });
  }

  async login(body: { account: string; password: string }, context: RequestContext = {}): Promise<AuthResult> {
    const normalized = this.normalizeAccount(body.account);
    if (!normalized) {
      throw new BadRequestException("account must be a valid email or phone number");
    }

    return this.executeAuthAction("login", normalized, context, async () => {
      if (!body.password) {
        throw new BadRequestException("password is required");
      }

      await this.enforceRateLimit("login", normalized, context, AUTH_RATE_LIMIT_MAX_ATTEMPTS);

      const user = await this.prisma.user.findFirst({
        where: this.accountWhere(normalized),
        include: {
          preferences: true,
          _count: { select: { followers: true, following: true } },
        }
      });

      if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
        throw new UnauthorizedException("invalid account or password");
      }

      return this.issueAuthResult(user.id, context, user);
    });
  }

  async getCsrfToken(refreshToken: string | undefined) {
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException("refresh token required");
    }
    const session = await this.getRefreshSession(refreshToken);
    if (!session?.userId) {
      throw new UnauthorizedException("session expired");
    }
    return { csrfToken: this.createCsrfToken(refreshToken) };
  }

  async refresh(refreshToken: string | undefined, csrfToken: string | undefined, context: RequestContext = {}): Promise<AuthResult> {
    return this.executeAuthAction("refresh", undefined, context, async () => {
      if (!refreshToken?.trim()) {
        throw new UnauthorizedException("refresh token required");
      }

      const session = await this.getRefreshSession(refreshToken);
      if (!session?.userId) {
        throw new UnauthorizedException("session expired");
      }
      this.assertCsrfToken(refreshToken, csrfToken);

      const user = await this.prisma.user.findUnique({
        where: { id: session.userId },
        include: {
          preferences: true,
          _count: { select: { followers: true, following: true } },
        }
      });
      if (!user) {
        throw new UnauthorizedException("session expired");
      }

      const nextRefreshToken = this.createRefreshToken();
      const rotated = await this.rotateRefreshSession(refreshToken, nextRefreshToken, user.id, context);
      if (!rotated) {
        throw new UnauthorizedException("session expired");
      }
      return this.buildAuthResult(user, nextRefreshToken);
    });
  }

  async logout(
    authorization?: string,
    refreshToken?: string,
    csrfToken?: string,
    context: RequestContext = {}
  ) {
    return this.executeAuthAction("logout", undefined, context, async () => {
      if (!refreshToken?.trim()) {
        throw new UnauthorizedException("refresh token required");
      }
      const session = await this.getRefreshSession(refreshToken);
      if (!session?.userId) {
        throw new UnauthorizedException("session expired");
      }
      this.assertCsrfToken(refreshToken, csrfToken);
      const accessToken = this.extractAccessToken(authorization);

      if (accessToken) {
        await this.revokeAccessToken(accessToken);
      }
      if (refreshToken) {
        await this.deleteRefreshSession(refreshToken);
      }

      return { ok: true };
    });
  }

  async me(authorization?: string) {
    const token = this.extractAccessToken(authorization);
    const parsed = token ? this.verifyAccessToken(token) : undefined;
    if (!parsed) {
      throw new UnauthorizedException("login required");
    }

    const blacklisted = await this.redisService
      .getClient()
      .get(this.buildAccessBlacklistKey(parsed.jti))
      .catch(() => null);
    if (blacklisted) {
      throw new UnauthorizedException("session expired");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: parsed.sub },
      include: {
        preferences: true,
        _count: { select: { followers: true, following: true } },
      }
    });
    if (!user) {
      throw new UnauthorizedException("session expired");
    }

    return this.safeUser(user);
  }

  extractRefreshToken(cookieHeader?: string) {
    return this.extractCookie(cookieHeader, REFRESH_COOKIE_NAME);
  }

  extractAccessToken(authorization?: string) {
    return this.extractBearerToken(authorization);
  }

  private async requestCode(
    body: { account: string },
    purpose: string,
    rateLimitAction: string,
    context: RequestContext
  ): Promise<{ ok: boolean; verificationCode?: string; delivery: "console" | "email" | "sms" }> {
    const normalized = this.normalizeAccount(body.account);
    if (!normalized) {
      throw new BadRequestException("account must be a valid email or phone number");
    }

    return this.executeAuthAction("verification_code", normalized, context, async () => {
      await this.enforceRateLimit(rateLimitAction, normalized, context, VERIFICATION_CODE_MAX_SENDS);

      const existed = await this.prisma.user.findFirst({ where: this.accountWhere(normalized) });
      if (existed) {
        throw new ConflictException("account already exists");
      }

      const verificationCode = this.generateVerificationCode();
      await this.storeVerificationCode(normalized, purpose, verificationCode);
      let delivery: "console" | "email" | "sms";
      try {
        delivery = await this.verificationDelivery.sendVerificationCode({
          account: normalized.account,
          kind: normalized.kind,
          code: verificationCode,
          ttlSeconds: VERIFICATION_CODE_TTL_SECONDS,
          purpose,
        });
      } catch (error) {
        await this.clearVerificationCode(normalized, purpose);
        throw error;
      }

      return {
        ok: true,
        delivery,
        ...(delivery === "console" ? { verificationCode } : {})
      };
    });
  }

  private accountWhere(account: NormalizedAccount) {
    return account.kind === "email" ? { email: account.account } : { phone: account.account };
  }

  private normalizeAccount(account?: string): NormalizedAccount | undefined {
    if (!account) return undefined;

    const trimmed = account.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { account: trimmed.toLowerCase(), kind: "email" };
    }

    const normalizedPhone = trimmed.replace(/[\s\-().]/g, "");
    if (/^\+?\d{6,20}$/.test(normalizedPhone)) {
      return { account: normalizedPhone, kind: "phone" };
    }

    return undefined;
  }

  private validatePasswordStrength(password: string) {
    const trimmed = password?.trim() ?? "";
    if (trimmed.length < 8) {
      throw new BadRequestException("password must be at least 8 characters");
    }
    if (trimmed.length > 64) {
      throw new BadRequestException("password must be at most 64 characters");
    }
    if (!/[A-Za-z]/.test(trimmed) || !/\d/.test(trimmed)) {
      throw new BadRequestException("password must include letters and numbers");
    }
  }

  private generateVerificationCode() {
    return `${randomInt(100000, 1000000)}`;
  }

  private async createRegisteredUser(input: {
    email?: string;
    phone?: string;
    passwordHash: string;
    nickname: string;
  }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const accountNo = await this.nextAccountNo(tx);
            return tx.user.create({
              data: {
                accountNo,
                email: input.email,
                phone: input.phone,
                passwordHash: input.passwordHash,
                nickname: input.nickname,
                preferences: {
                  create: {
                    defaultPlatform: "short-note",
                    writingStyles: [],
                    domains: [],
                    blockedWords: [],
                  },
                },
              },
              include: {
                preferences: true,
                _count: { select: { followers: true, following: true } },
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error) {
        if (attempt < 2 && this.isRetryableAccountNoError(error)) continue;
        throw error;
      }
    }

    throw new ConflictException("account number allocation failed");
  }

  private async nextAccountNo(tx: Prisma.TransactionClient) {
    const aggregate = await tx.user.aggregate({ _max: { accountNo: true } });
    return (aggregate._max.accountNo ?? 100000) + 1;
  }

  private isRetryableAccountNoError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    );
  }

  private async storeVerificationCode(account: NormalizedAccount, purpose: string, verificationCode: string) {
    await this.redisService.getClient().set(
      this.buildVerificationCodeKey(account, purpose),
      JSON.stringify({
        codeHash: this.hashSecretValue(`${account.account}:${purpose}:${verificationCode}`),
        requestedAt: new Date().toISOString(),
        account: account.account,
        kind: account.kind
      }),
      "EX",
      VERIFICATION_CODE_TTL_SECONDS
    );
    this.logger.log(`Verification code generated for ${this.maskAccount(account.account)} via ${account.kind}`);
  }

  private async assertVerificationCode(account: NormalizedAccount, verificationCode: string, purpose: string) {
    const stored = await this.getVerificationSession(account, purpose);
    if (!stored?.codeHash) {
      throw new UnauthorizedException("verification code expired");
    }

    const codeHash = this.hashSecretValue(`${account.account}:${purpose}:${verificationCode.trim()}`);
    if (codeHash !== stored.codeHash) {
      throw new UnauthorizedException("invalid verification code");
    }
  }

  private async clearVerificationCode(account: NormalizedAccount, purpose: string) {
    await this.redisService.getClient().del(this.buildVerificationCodeKey(account, purpose)).catch(() => undefined);
  }

  private async getVerificationSession(account: NormalizedAccount, purpose: string) {
    const sessionJson = await this.redisService.getClient().get(this.buildVerificationCodeKey(account, purpose)).catch(() => null);
    if (!sessionJson) return undefined;

    try {
      return JSON.parse(sessionJson) as { codeHash?: string; requestedAt?: string };
    } catch {
      return undefined;
    }
  }

  private async issueAuthResult(userId: string, context: RequestContext, userRecord?: LoadedUser): Promise<AuthResult> {
    const user =
      userRecord ??
      (await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          preferences: true,
          _count: { select: { followers: true, following: true } },
        }
      }));

    if (!user) {
      throw new UnauthorizedException("session expired");
    }

    const refreshToken = this.createRefreshToken();
    await this.storeRefreshSession(refreshToken, user.id, context);
    return this.buildAuthResult(user, refreshToken);
  }

  private buildAuthResult(user: LoadedUser, refreshToken: string): AuthResult {
    return {
      accessToken: this.createAccessToken(user.id),
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      csrfToken: this.createCsrfToken(refreshToken),
      user: this.safeUser(user)
    };
  }

  private createAccessToken(userId: string) {
    const payload = {
      sub: userId,
      jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encodedPayload}.${this.signValue(encodedPayload)}`;
  }

  private verifyAccessToken(token: string) {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return undefined;

    if (!this.safeEqual(signature, this.signValue(encodedPayload))) {
      return undefined;
    }

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
        sub?: string;
        jti?: string;
        exp?: number;
        iat?: number;
      };
      if (!payload.sub || !payload.jti || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
        return undefined;
      }
      return payload as Required<Pick<typeof payload, "sub" | "jti" | "exp">> & { iat?: number };
    } catch {
      return undefined;
    }
  }

  private async revokeAccessToken(token: string) {
    const parsed = this.verifyAccessToken(token);
    if (!parsed) return;

    const remainingTtl = Math.max(parsed.exp - Math.floor(Date.now() / 1000), 1);
    await this.redisService.getClient().set(this.buildAccessBlacklistKey(parsed.jti), "1", "EX", remainingTtl).catch(() => undefined);
  }

  private createRefreshToken() {
    return randomUUID().replace(/-/g, "");
  }

  private createCsrfToken(refreshToken: string) {
    return this.signValue(`csrf:${refreshToken}`);
  }

  private assertCsrfToken(refreshToken: string, csrfToken?: string) {
    if (!csrfToken?.trim() || !this.safeEqual(csrfToken, this.createCsrfToken(refreshToken))) {
      throw new ForbiddenException("invalid csrf token");
    }
  }

  private async storeRefreshSession(refreshToken: string, userId: string, context: RequestContext) {
    await this.redisService.getClient().set(
      this.buildRefreshSessionKey(refreshToken),
      JSON.stringify({
        userId,
        createdAt: new Date().toISOString(),
        ip: context.ip,
        userAgent: context.userAgent
      }),
      "EX",
      REFRESH_TOKEN_TTL_SECONDS
    );
  }

  private async getRefreshSession(refreshToken: string) {
    const sessionJson = await this.redisService.getClient().get(this.buildRefreshSessionKey(refreshToken)).catch(() => null);
    if (!sessionJson) return undefined;

    try {
      return JSON.parse(sessionJson) as { userId?: string };
    } catch {
      return undefined;
    }
  }

  private async rotateRefreshSession(
    refreshToken: string,
    nextRefreshToken: string,
    userId: string,
    context: RequestContext
  ) {
    const sessionJson = JSON.stringify({
      userId,
      createdAt: new Date().toISOString(),
      ip: context.ip,
      userAgent: context.userAgent
    });
    const result = await this.redisService.getClient().eval(
      `
        if redis.call("GET", KEYS[1]) == false then
          return 0
        end
        redis.call("DEL", KEYS[1])
        redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
        return 1
      `,
      2,
      this.buildRefreshSessionKey(refreshToken),
      this.buildRefreshSessionKey(nextRefreshToken),
      sessionJson,
      String(REFRESH_TOKEN_TTL_SECONDS)
    ).catch(() => 0);
    return Number(result) === 1;
  }

  private async deleteRefreshSession(refreshToken: string) {
    await this.redisService.getClient().del(this.buildRefreshSessionKey(refreshToken)).catch(() => undefined);
  }

  private async enforceRateLimit(
    action: string,
    account: NormalizedAccount,
    context: RequestContext,
    maxAttempts: number,
    windowSeconds = AUTH_RATE_LIMIT_WINDOW_SECONDS
  ) {
    const identity = this.hashSecretValue(`${action}:${context.ip ?? "unknown"}:${account.account}`);
    const key = `auth:rate:${action}:${identity}`;
    const client = this.redisService.getClient();
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, windowSeconds);
    }
    if (current > maxAttempts) {
      throw new HttpException("too many auth attempts, please try again later", 429);
    }
  }

  private async executeAuthAction<T>(
    action: AuthAuditEvent["action"],
    account: NormalizedAccount | undefined,
    context: RequestContext,
    task: () => Promise<T>
  ) {
    try {
      const result = await task();
      await this.recordAuthAudit({
        action,
        status: "success",
        account: account?.account,
        accountKind: account?.kind,
        ip: context.ip,
        userAgent: context.userAgent
      });
      return result;
    } catch (error) {
      await this.recordAuthAudit({
        action,
        status: "failure",
        account: account?.account,
        accountKind: account?.kind,
        ip: context.ip,
        userAgent: context.userAgent,
        reason: error instanceof Error ? error.message : "unknown error"
      });
      throw error;
    }
  }

  private async recordAuthAudit(event: AuthAuditEvent) {
    this.logger[event.status === "failure" ? "warn" : "log"](
      `${event.action} ${event.status}${event.account ? ` for ${this.maskAccount(event.account)}` : ""}${
        event.reason ? `: ${event.reason}` : ""
      }`
    );

    await this.redisService
      .getClient()
      .lpush("auth:audit:events", JSON.stringify({ ...event, at: new Date().toISOString() }))
      .then(() => this.redisService.getClient().ltrim("auth:audit:events", 0, 499))
      .catch(() => undefined);
  }

  private hashSecretValue(value: string) {
    return createHmac("sha256", this.authSecret()).update(value).digest("hex");
  }

  private signValue(value: string) {
    return createHmac("sha256", this.authSecret()).update(value).digest("base64url");
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private authSecret() {
    const configuredSecret = process.env.AUTH_TOKEN_SECRET ?? process.env.AUTH_SECRET;
    if (configuredSecret) return configuredSecret;
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_TOKEN_SECRET is required in production");
    }
    return "dev-auth-secret";
  }

  private buildAccessBlacklistKey(jti: string) {
    return `auth:access:blacklist:${jti}`;
  }

  private buildRefreshSessionKey(refreshToken: string) {
    return `auth:refresh:${this.hashSecretValue(refreshToken)}`;
  }

  private buildVerificationCodeKey(account: NormalizedAccount, purpose: string) {
    return `auth:verification:${purpose}:${this.hashSecretValue(account.account)}`;
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) return undefined;
    return authorization.slice("Bearer ".length);
  }

  private extractCookie(cookieHeader: string | undefined, cookieName: string) {
    if (!cookieHeader) return undefined;
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((cookie) => {
        const [name, ...rest] = cookie.trim().split("=");
        return [name, decodeURIComponent(rest.join("="))];
      })
    );
    return cookies[cookieName];
  }

  private maskAccount(account: string) {
    if (account.includes("@")) {
      const [name, domain] = account.split("@");
      return name && domain ? `${name.slice(0, 2)}***@${domain}` : account;
    }
    return account.length <= 4 ? account : `${account.slice(0, 3)}***${account.slice(-2)}`;
  }

  private safeUser(user: {
    id: string;
    accountNo: number;
    email: string | null;
    phone: string | null;
    nickname: string;
    bio?: string | null;
    avatarUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count?: {
      followers: number;
      following: number;
    };
    preferences: {
      defaultPlatform: string | null;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    } | null;
  }) {
    return {
      id: user.id,
      accountNo: user.accountNo,
      account: user.email ?? user.phone ?? undefined,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      nickname: user.nickname,
      bio: user.bio ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
      followerCount: user._count?.followers ?? 0,
      followingCount: user._count?.following ?? 0,
      preferences: user.preferences ?? {
        defaultPlatform: "short-note",
        writingStyles: [],
        domains: [],
        blockedWords: []
      },
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    };
  }
}
