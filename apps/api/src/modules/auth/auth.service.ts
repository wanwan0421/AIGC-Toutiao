import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { hashPassword } from "../../common/defaults";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

  async register(body: { account: string; password: string; nickname?: string }) {
    const account = body.account?.trim();
    if (!account || !body.password) {
      throw new UnauthorizedException("account and password are required");
    }

    const where = this.accountWhere(account);
    const existed = await this.prisma.user.findFirst({ where });
    if (existed) {
      throw new ConflictException("account already exists");
    }

    const user = await this.prisma.user.create({
      data: {
        email: account.includes("@") ? account : undefined,
        phone: account.includes("@") ? undefined : account,
        passwordHash: hashPassword(body.password),
        nickname: body.nickname?.trim() || "新创作者",
        preferences: {
          create: {
            defaultPlatform: "short-note",
            writingStyles: [],
            domains: [],
            blockedWords: []
          }
        }
      },
      include: { preferences: true }
    });

    return {
      user: this.safeUser(user),
      message: "registered"
    };
  }

  async login(body: { account: string; password: string }) {
    const account = body.account?.trim();
    const user = await this.prisma.user.findFirst({
      where: this.accountWhere(account),
      include: { preferences: true }
    });

    if (!user || user.passwordHash !== hashPassword(body.password)) {
      throw new UnauthorizedException("invalid account or password");
    }

    const accessToken = `mock_${user.id}_${randomUUID()}`;
    const session = {
      userId: user.id,
      createdAt: new Date().toISOString()
    };

    await this.redisService
      .getClient()
      .set(`session:${accessToken}`, JSON.stringify(session), "EX", 60 * 60 * 24 * 7)
      .catch(() => undefined);

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: 60 * 60 * 24 * 7,
      user: this.safeUser(user)
    };
  }

  async logout(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    if (token) {
      await this.redisService
        .getClient()
        .set(`token:blacklist:${token}`, "1", "EX", 60 * 60 * 24 * 7)
        .catch(() => undefined);
    }

    return { ok: true };
  }

  async me(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    const sessionJson = token
      ? await this.redisService
          .getClient()
          .get(`session:${token}`)
          .catch(() => null)
      : null;
    const session = sessionJson ? (JSON.parse(sessionJson) as { userId: string }) : null;

    const user = await this.prisma.user.findFirst({
      where: session ? { id: session.userId } : {},
      include: { preferences: true },
      orderBy: { createdAt: "asc" }
    });

    if (!user) {
      throw new UnauthorizedException("session expired");
    }

    return this.safeUser(user);
  }

  private accountWhere(account?: string) {
    if (!account) {
      return { id: "__missing__" };
    }

    return account.includes("@") ? { email: account } : { phone: account };
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) {
      return undefined;
    }

    return authorization.slice("Bearer ".length);
  }

  private safeUser(user: {
    id: string;
    email: string | null;
    phone: string | null;
    nickname: string;
    avatarUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    preferences: {
      defaultPlatform: string | null;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    } | null;
  }) {
    return {
      id: user.id,
      account: user.email ?? user.phone,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl ?? undefined,
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
