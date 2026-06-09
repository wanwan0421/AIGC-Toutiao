import { Injectable } from "@nestjs/common";
import { ContentStatus as DbContentStatus, ContentVisibility as DbContentVisibility } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

export type ContentAccessSubject = {
  authorId: string;
  status: DbContentStatus;
  visibility: DbContentVisibility;
};

@Injectable()
export class ContentAccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async canView(userId: string | undefined | null, content: ContentAccessSubject) {
    if (content.authorId === userId) return true;
    if (content.status !== DbContentStatus.published) return false;
    if (content.visibility === DbContentVisibility.public) return true;
    if (!userId || content.visibility === DbContentVisibility.private) return false;

    return this.isFollower(userId, content.authorId);
  }

  publicContentWhere() {
    return {
      status: DbContentStatus.published,
      visibility: DbContentVisibility.public,
    };
  }

  private async isFollower(followerId: string, authorId: string) {
    const follow = await this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId: authorId,
        },
      },
      select: { id: true },
    });
    return Boolean(follow);
  }
}
