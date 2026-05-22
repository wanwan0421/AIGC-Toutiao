import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { buildAuditResult, buildQualityScore } from "../../common/business-rules";
import { toDbAuditRiskLevel } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  async getContentAudit(contentId: string) {
    const [audit, quality] = await Promise.all([
      this.prisma.auditRecord.findFirst({ where: { contentId }, orderBy: { createdAt: "desc" } }),
      this.prisma.qualityScore.findFirst({ where: { contentId }, orderBy: { createdAt: "desc" } })
    ]);

    if (audit || quality) {
      return {
        contentId,
        audit,
        quality,
        checkedAt: audit?.createdAt.toISOString() ?? quality?.createdAt.toISOString()
      };
    }

    return this.runContentAudit(contentId);
  }

  async runContentAudit(contentId: string) {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    const audit = buildAuditResult(content.title, content.body);
    const quality = buildQualityScore(content.title, content.body);

    const [auditRecord, qualityRecord] = await this.prisma.$transaction([
      this.prisma.auditRecord.create({
        data: {
          contentId,
          passed: audit.passed,
          riskLevel: toDbAuditRiskLevel(audit.riskLevel),
          riskTypes: audit.riskTypes,
          reasons: audit.reasons,
          rawResponse: audit as unknown as Prisma.InputJsonValue
        }
      }),
      this.prisma.qualityScore.create({
        data: {
          contentId,
          total: quality.total,
          dimensions: quality.dimensions as unknown as Prisma.InputJsonValue,
          reason: quality.reason,
          rawResponse: quality as unknown as Prisma.InputJsonValue
        }
      }),
      this.prisma.content.update({
        where: { id: contentId },
        data: { qualityScore: quality.total }
      })
    ]);

    return {
      contentId,
      audit: auditRecord,
      quality: qualityRecord,
      checkedAt: auditRecord.createdAt.toISOString()
    };
  }

  checkText(body: { title: string; body: string }) {
    return {
      audit: buildAuditResult(body.title, body.body),
      quality: buildQualityScore(body.title, body.body),
      checkedAt: new Date().toISOString()
    };
  }
}
