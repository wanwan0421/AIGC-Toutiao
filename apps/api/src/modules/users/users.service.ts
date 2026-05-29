import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AuthService } from "../auth/auth.service";

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
    private readonly authService: AuthService
  ) {}

  async getProfile(authorization?: string, cookieHeader?: string) {
    const user = await this.resolveCurrentUser(authorization, cookieHeader);
    return this.toProfile(user);
  }

  async requestContactVerificationCode(authorization: string | undefined, cookieHeader: string | undefined, body: { account: string }) {
    await this.resolveCurrentUser(authorization, cookieHeader);
    return this.authService.requestContactVerificationCode(body);
  }

  async updateProfile(authorization: string | undefined, cookieHeader: string | undefined, body: UserProfileUpdate) {
    const user = await this.resolveCurrentUser(authorization, cookieHeader);

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

    return this.getProfile(authorization, cookieHeader);
  }

  async updatePreferences(
    authorization: string | undefined,
    cookieHeader: string | undefined,
    body: Partial<{
      defaultPlatform: string;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    }>
  ) {
    const user = await this.resolveCurrentUser(authorization, cookieHeader);

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

  private async resolveCurrentUser(authorization?: string, cookieHeader?: string) {
    const currentUser = await this.authService.me(authorization, cookieHeader).catch((error) => {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("session expired");
    });
    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.id },
      include: { preferences: true }
    });

    if (!user) {
      throw new NotFoundException("user not found");
    }

    return user;
  }
  private toProfile(user: Awaited<ReturnType<UsersService["resolveCurrentUser"]>>) {
    return {
      id: user.id,
      account: user.email ?? user.phone ?? undefined,
      nickname: user.nickname,
      bio: user.bio ?? undefined,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
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
