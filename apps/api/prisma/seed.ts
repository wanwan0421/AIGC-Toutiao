import { createHash } from "node:crypto";
import {
  AssetAuditStatus,
  ContentStatus,
  PrismaClient,
  PromptScene
} from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "creator@example.com" },
    create: {
      email: "creator@example.com",
      passwordHash: hashPassword("123456"),
      nickname: "Luna Studio",
      avatarUrl: "",
      preferences: {
        create: {
          defaultPlatform: "short-note",
          writingStyles: ["种草", "攻略"],
          domains: ["穿搭", "生活方式"],
          blockedWords: []
        }
      }
    },
    update: {
      nickname: "Luna Studio",
      avatarUrl: ""
    }
  });

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      defaultPlatform: "short-note",
      writingStyles: ["种草", "攻略"],
      domains: ["穿搭", "生活方式"],
      blockedWords: []
    },
    update: {
      defaultPlatform: "short-note",
      writingStyles: ["种草", "攻略"],
      domains: ["穿搭", "生活方式"]
    }
  });

  const contentSeeds = [
    {
      id: "content_001",
      title: "夏日通勤穿搭的 5 个轻量公式",
      excerpt: "围绕舒适、清爽、易复用三条线，生成适合短图文平台的种草内容。",
      body:
        "这篇内容由创作者提供主题、目标人群和素材线索，AI 先生成标题、正文结构、标签与配图建议，再由创作者补充真实体验。\n\n核心建议包括选择透气面料、统一低饱和配色、准备一件空调房外套、用轻量鞋包提高通勤舒适度，并把每一套搭配拆成可复用公式。",
      status: ContentStatus.published,
      tags: ["通勤", "穿搭", "夏日"],
      qualityScore: 91,
      heatScore: 86,
      viewCount: 12840,
      likeCount: 928,
      publishedAt: new Date("2026-05-20T08:30:00.000Z")
    },
    {
      id: "content_002",
      title: "AI 辅助整理露营装备清单",
      excerpt: "从人群、预算和天气出发，拆成封面、正文、标签和发布摘要。",
      body: "露营装备内容可以先按人群、天气、预算三个维度拆解，再由 AI 辅助生成清单和发布摘要。",
      status: ContentStatus.pending_review,
      tags: ["露营", "清单", "户外"],
      qualityScore: 84,
      heatScore: 63,
      viewCount: 3520,
      likeCount: 214,
      publishedAt: null
    },
    {
      id: "content_003",
      title: "新手咖啡器具选购指南",
      excerpt: "用 AI 生成结构，再由创作者补充个人体验与图片素材。",
      body: "这是一篇待完善草稿，计划补充手冲壶、磨豆机、滤杯和入门预算建议。",
      status: ContentStatus.draft,
      tags: ["咖啡", "新手", "器具"],
      qualityScore: 0,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      publishedAt: null
    },
    {
      id: "content_004",
      title: "城市微旅行：半天完成一篇可发布攻略",
      excerpt: "把路线、预算、拍照点和避坑提醒组合成读者可直接收藏的城市指南。",
      body: "半天微旅行攻略需要先确认路线密度，再组合预算、拍照点和避坑提醒。",
      status: ContentStatus.approved,
      tags: ["微旅行", "攻略", "城市"],
      qualityScore: 89,
      heatScore: 74,
      viewCount: 6788,
      likeCount: 463,
      publishedAt: null
    },
    {
      id: "content_005",
      title: "低预算桌面改造清单",
      excerpt: "从素材图片中识别物品层级，生成适合种草平台的封面标题和正文结构。",
      body: "当前版本存在部分绝对化表达，适合进入合规改写后再次提交审核。",
      status: ContentStatus.rejected,
      tags: ["桌面", "改造", "清单"],
      qualityScore: 72,
      heatScore: 41,
      viewCount: 980,
      likeCount: 57,
      publishedAt: null
    }
  ];

  for (const content of contentSeeds) {
    await prisma.content.upsert({
      where: { id: content.id },
      create: {
        ...content,
        authorId: user.id
      },
      update: {
        title: content.title,
        excerpt: content.excerpt,
        body: content.body,
        status: content.status,
        tags: content.tags,
        qualityScore: content.qualityScore,
        heatScore: content.heatScore,
        viewCount: content.viewCount,
        likeCount: content.likeCount,
        publishedAt: content.publishedAt
      }
    });
  }

  await prisma.draft.deleteMany({ where: { contentId: "content_003" } });
  await prisma.draft.create({
    data: {
      contentId: "content_003",
      authorId: user.id,
      title: "新手咖啡器具选购指南",
      body: "这是一篇待完善草稿，计划补充手冲壶、磨豆机、滤杯和入门预算建议。"
    }
  });

  await prisma.promptTemplate.upsert({
    where: { id: "prompt_generate_short_note" },
    create: {
      id: "prompt_generate_short_note",
      creatorId: user.id,
      name: "短图文种草生成",
      scene: PromptScene.generate,
      template: "根据主题 {{topic}}、目标人群 {{audience}}、风格 {{style}} 生成标题、正文、标签与配图建议。",
      variables: ["topic", "audience", "style", "materials"],
      model: "doubao-seed",
      modelOptions: { temperature: 0.7 },
      version: 1,
      status: "active",
      usageCount: 12
    },
    update: {
      status: "active",
      template: "根据主题 {{topic}}、目标人群 {{audience}}、风格 {{style}} 生成标题、正文、标签与配图建议。"
    }
  });

  await prisma.promptTemplate.upsert({
    where: { id: "prompt_audit_safety" },
    create: {
      id: "prompt_audit_safety",
      creatorId: user.id,
      name: "内容安全审核",
      scene: PromptScene.audit,
      template: "检查标题和正文是否存在违规风险，输出风险类型、风险等级和原因。",
      variables: ["title", "body"],
      model: "doubao-seed",
      modelOptions: { temperature: 0.2 },
      version: 1,
      status: "active",
      usageCount: 7
    },
    update: {
      status: "active",
      template: "检查标题和正文是否存在违规风险，输出风险类型、风险等级和原因。"
    }
  });

  await prisma.asset.upsert({
    where: { id: "asset_001" },
    create: {
      id: "asset_001",
      uploaderId: user.id,
      fileName: "summer-outfit-cover.jpg",
      mimeType: "image/jpeg",
      url: "/uploads/summer-outfit-cover.jpg",
      auditStatus: AssetAuditStatus.approved
    },
    update: {
      fileName: "summer-outfit-cover.jpg",
      mimeType: "image/jpeg",
      url: "/uploads/summer-outfit-cover.jpg",
      auditStatus: AssetAuditStatus.approved
    }
  });

  await prisma.contentAsset.upsert({
    where: {
      contentId_assetId: {
        contentId: "content_001",
        assetId: "asset_001"
      }
    },
    create: {
      contentId: "content_001",
      assetId: "asset_001",
      sortOrder: 0
    },
    update: {
      sortOrder: 0
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
