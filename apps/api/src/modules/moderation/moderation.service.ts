import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ContentWorkflowEngine } from "../workflow/content-workflow.engine";

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ContentWorkflowEngine
  ) {}

  async getContentAudit(contentId: string) {
    const [audit, quality] = await Promise.all([
      this.prisma.auditRecord.findFirst({ where: { contentId }, orderBy: { createdAt: "desc" } }),
      this.prisma.qualityScore.findFirst({ where: { contentId }, orderBy: { createdAt: "desc" } }),
    ]);

    if (audit || quality) {
      return {
        contentId,
        audit,
        quality: audit && !audit.passed ? null : quality,
        checkedAt: audit?.createdAt.toISOString() ?? quality?.createdAt.toISOString(),
      };
    }

    return this.runContentAudit(contentId);
  }

  async runContentAudit(contentId: string) {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    return this.workflow.runContentAudit(contentId);
  }

  async checkText(body: { title: string; body: string }) {
    return this.workflow.checkText(body);
  }
}
