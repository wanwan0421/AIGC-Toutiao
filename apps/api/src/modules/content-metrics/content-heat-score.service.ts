import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import {
  contentEngagementSignal,
  contentViewSignal,
  normalizeSignal,
  recentContentActionWeight,
  RECENT_CONTENT_SIGNAL_WINDOW_DAYS,
  type ContentSignalCounters,
} from "./content-signals";

const VIEW_SIGNAL_CAP = 10;
const ENGAGEMENT_SIGNAL_CAP = 14;
const RECENT_SIGNAL_CAP = 120;
const LEGACY_HEAT_SIGNAL_CAP = 10;

type HeatScoreSubject = ContentSignalCounters & {
  id: string;
  heatScore: number;
};

@Injectable()
export class ContentHeatScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async normalizeContent<T extends HeatScoreSubject>(content: T): Promise<T> {
    return (await this.normalizeContents([content]))[0] ?? content;
  }

  async normalizeContents<T extends HeatScoreSubject>(contents: readonly T[]): Promise<T[]> {
    if (!contents.length) return [];

    const recentSignals = await this.recentSignals(contents.map((content) => content.id));
    return contents.map((content) => ({
      ...content,
      heatScore: this.scoreContent(content, recentSignals.get(content.id) ?? 0),
    }));
  }

  scoreContent(content: HeatScoreSubject, recentSignal = 0) {
    const viewScore = normalizeSignal(contentViewSignal(content), VIEW_SIGNAL_CAP);
    const engagementScore = normalizeSignal(contentEngagementSignal(content), ENGAGEMENT_SIGNAL_CAP);
    const recentScore = normalizeSignal(recentSignal, RECENT_SIGNAL_CAP);
    const legacyHeatScore = normalizeSignal(Math.log1p(Math.max(0, content.heatScore)), LEGACY_HEAT_SIGNAL_CAP);
    const baseScore = recentScore * 0.45 + engagementScore * 0.25 + viewScore * 0.2 + legacyHeatScore * 0.1;

    return Math.max(0, Math.min(100, Math.round(baseScore * 100)));
  }

  private async recentSignals(contentIds: string[]) {
    const uniqueIds = Array.from(new Set(contentIds.filter(Boolean)));
    if (!uniqueIds.length) return new Map<string, number>();

    const since = new Date(Date.now() - RECENT_CONTENT_SIGNAL_WINDOW_DAYS * 86_400_000);
    const rows = await this.prisma.userActionEvent.groupBy({
      by: ["contentId", "eventType"],
      where: {
        contentId: { in: uniqueIds },
        createdAt: { gte: since },
      },
      _count: { _all: true },
    });

    const signals = new Map<string, number>();
    for (const row of rows) {
      const weight = recentContentActionWeight(row.eventType);
      if (weight === 0) continue;
      signals.set(row.contentId, Math.max(0, (signals.get(row.contentId) ?? 0) + weight * row._count._all));
    }
    return signals;
  }
}
