import { Injectable, NotFoundException } from "@nestjs/common";
import { DEFAULT_USER_EMAIL } from "../../common/defaults";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile() {
    const user = await this.prisma.user.findFirst({
      where: { email: DEFAULT_USER_EMAIL },
      include: { preferences: true }
    });

    if (!user) {
      throw new NotFoundException("user not found, please run prisma seed first");
    }

    return {
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      preferences: user.preferences
    };
  }

  async updatePreferences(
    body: Partial<{
      defaultPlatform: string;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    }>
  ) {
    const user = await this.prisma.user.findFirst({ where: { email: DEFAULT_USER_EMAIL } });
    if (!user) {
      throw new NotFoundException("user not found, please run prisma seed first");
    }

    const preferences = await this.prisma.userPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        defaultPlatform: body.defaultPlatform ?? "short-note",
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
}
