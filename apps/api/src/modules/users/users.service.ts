import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ContentStatus as DbContentStatus, ContentVisibility as DbContentVisibility } from "@prisma/client";
import { toContentSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { ContentHeatScoreService } from "../content-metrics/content-heat-score.service";

const publicContentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  _count: { select: { comments: true } },
};

type UserProfileUpdate = Partial<{
  nickname: string;
  bio: string;
  avatarUrl: string;
  email: string;
  phone: string;
  contactVerificationCode: string;
  defaultPlatform: string;
  writingStyles: string[];
  domains: string[];
  blockedWords: string[];
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly authService: AuthService,
    private readonly heatScores: ContentHeatScoreService
  ) {}

  async getProfile(authorization?: string) {
    const user = await this.resolveCurrentUser(authorization);
    return this.toProfile(user);
  }

  async requestContactVerificationCode(authorization: string | undefined, body: { account: string }) {
    await this.resolveCurrentUser(authorization);
    return this.authService.requestContactVerificationCode(body);
  }

  async updateProfile(authorization: string | undefined, body: UserProfileUpdate) {
    const user = await this.resolveCurrentUser(authorization);

    const nextPhone = body.phone?.trim();
    const nextEmail = body.email?.trim();
    const finalPhone = body.phone === undefined ? user.phone : nextPhone || null;
    const finalEmail = body.email === undefined ? user.email : nextEmail || null;
    if (!finalPhone && !finalEmail) {
      throw new BadRequestException("email or phone is required");
    }

    const contactChanged = (nextPhone && nextPhone !== user.phone) || (nextEmail && nextEmail !== user.email);
    if (contactChanged && !body.contactVerificationCode?.trim()) {
      throw new BadRequestException("contact verification code is required");
    }

    if (nextPhone && nextPhone !== user.phone) {
      const existed = await this.prisma.user.findUnique({ where: { phone: nextPhone } });
      if (existed && existed.id !== user.id) {
        throw new ConflictException("phone already exists");
      }
    }
    if (nextEmail && nextEmail !== user.email) {
      const existed = await this.prisma.user.findUnique({ where: { email: nextEmail } });
      if (existed && existed.id !== user.id) {
        throw new ConflictException("email already exists");
      }
    }

    if (contactChanged) {
      await this.authService.verifyContactCode(
        nextEmail && nextEmail !== user.email ? nextEmail : nextPhone ?? "",
        body.contactVerificationCode ?? ""
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        nickname: body.nickname?.trim() || undefined,
        bio: body.bio === undefined ? undefined : body.bio.trim() || null,
        email: body.email === undefined ? undefined : finalEmail,
        avatarUrl: body.avatarUrl === undefined ? undefined : body.avatarUrl.trim() || null,
        phone: body.phone === undefined ? undefined : finalPhone
      }
    });

    if (
      body.defaultPlatform !== undefined ||
      body.writingStyles !== undefined ||
      body.domains !== undefined ||
      body.blockedWords !== undefined
    ) {
      await this.prisma.userPreference.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          defaultPlatform: body.defaultPlatform ?? "toutiao",
          writingStyles: body.writingStyles ?? [],
          domains: body.domains ?? [],
          blockedWords: body.blockedWords ?? []
        },
        update: {
          defaultPlatform: body.defaultPlatform,
          writingStyles: body.writingStyles,
          domains: body.domains,
          blockedWords: body.blockedWords
        }
      });
    }

    return this.getProfile(authorization);
  }

  async updatePreferences(
    authorization: string | undefined,
    body: Partial<{
      defaultPlatform: string;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    }>
  ) {
    const user = await this.resolveCurrentUser(authorization);

    const preferences = await this.prisma.userPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        defaultPlatform: body.defaultPlatform ?? "toutiao",
        writingStyles: body.writingStyles ?? [],
        domains: body.domains ?? [],
        blockedWords: body.blockedWords ?? []
      },
      update: body
    });

    return {
      ok: true,
      preferences
    };
  }

  async getPublicProfile(authorization: string | undefined, targetUserId: string) {
    const viewer = await this.resolveOptionalUser(authorization);
    const cacheKey = `users:v2:public-profile:${targetUserId}`;
    
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached);
      const following =
        !viewer || viewer.id === targetUserId
          ? null
          : await this.prisma.userFollow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: viewer.id,
                  followingId: targetUserId,
                },
              },
            });
      return {
        ...parsed,
        viewerState: {
          following: Boolean(following),
          isSelf: viewer?.id === targetUserId,
        },
      };
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        _count: {
          select: {
            followers: true,
            following: true,
            contents: { where: { status: DbContentStatus.published, visibility: DbContentVisibility.public } },
          },
        },
      },
    });

    if (!target) {
      throw new NotFoundException("user not found");
    }

    const publicProfile = {
      profile: {
        id: target.id,
        accountNo: target.accountNo,
        nickname: target.nickname,
        bio: target.bio ?? undefined,
        avatarUrl: target.avatarUrl ?? undefined,
        followerCount: target._count.followers,
        followingCount: target._count.following,
        contentCount: target._count.contents,
        createdAt: target.createdAt.toISOString(),
      },
    };
    
    await this.redisService.getClient().setex(cacheKey, 300, JSON.stringify(publicProfile)).catch(() => undefined);
    
    const following =
      !viewer || viewer.id === targetUserId
        ? null
        : await this.prisma.userFollow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewer.id,
                followingId: targetUserId,
              },
            },
          });

    return {
      ...publicProfile,
      viewerState: {
        following: Boolean(following),
        isSelf: viewer?.id === targetUserId,
      },
    };
  }

  async listPublicContents(targetUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!target) {
      throw new NotFoundException("user not found");
    }

    const cacheKey = `users:v3:public-contents:${targetUserId}`;
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return this.filterCachedPublicContents(JSON.parse(cached));
    }

    const items = await this.prisma.content.findMany({
      where: { authorId: targetUserId, status: DbContentStatus.published, visibility: DbContentVisibility.public },
      include: publicContentInclude,
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: 48,
    });

    const result = { items: (await this.heatScores.normalizeContents(items)).map(toContentSummary) };
    await this.redisService.getClient().setex(cacheKey, 300, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  async toggleFollow(authorization: string | undefined, targetUserId: string) {
    const user = await this.resolveCurrentUser(authorization);
    if (user.id === targetUserId) {
      throw new BadRequestException("cannot follow yourself");
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) {
      throw new NotFoundException("user not found");
    }

    return this.prisma.$transaction(async (tx) => {
      const where = {
        followerId_followingId: {
          followerId: user.id,
          followingId: targetUserId,
        },
      };
      const existing = await tx.userFollow.findUnique({ where });
      const following = !existing;
      if (existing) {
        await tx.userFollow.delete({ where });
      } else {
        await tx.userFollow.create({
          data: {
            followerId: user.id,
            followingId: targetUserId,
          },
        });
      }

      const [followingCount, followerCount] = await Promise.all([
        tx.userFollow.count({ where: { followerId: user.id } }),
        tx.userFollow.count({ where: { followingId: targetUserId } }),
      ]);

      return {
        userId: targetUserId,
        following,
        followingCount,
        followerCount,
      };
    });
  }

  private async resolveCurrentUser(authorization?: string) {
    const currentUser = await this.authService.me(authorization).catch((error) => {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("session expired");
    });
    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.id },
      include: {
        preferences: true,
        _count: { select: { followers: true, following: true } },
      }
    });

    if (!user) {
      throw new NotFoundException("user not found");
    }

    return user;
  }

  private async resolveOptionalUser(authorization?: string) {
    return this.resolveCurrentUser(authorization).catch((error) => {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    });
  }

  private async filterCachedPublicContents<T extends { items: Array<{ id: string }> }>(response: T): Promise<T> {
    const ids = response.items.map((item) => item.id);
    if (!ids.length) return response;

    const current = await this.prisma.content.findMany({
      where: {
        id: { in: ids },
        status: DbContentStatus.published,
        visibility: DbContentVisibility.public,
      },
      include: publicContentInclude,
    });
    const summaries = new Map(
      (await this.heatScores.normalizeContents(current)).map((item) => [item.id, toContentSummary(item)])
    );
    return {
      ...response,
      items: ids.map((id) => summaries.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    };
  }

  private toProfile(user: Awaited<ReturnType<UsersService["resolveCurrentUser"]>>) {
    return {
      id: user.id,
      accountNo: user.accountNo,
      account: user.email ?? user.phone ?? undefined,
      nickname: user.nickname,
      bio: user.bio ?? undefined,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
      followerCount: user._count.followers,
      followingCount: user._count.following,
      preferences: user.preferences ?? {
        defaultPlatform: "toutiao",
        writingStyles: [],
        domains: [],
        blockedWords: []
      },
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    };
  }
}
