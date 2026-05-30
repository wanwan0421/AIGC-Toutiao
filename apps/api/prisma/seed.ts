import bcrypt from "bcrypt";
import {
  AssetAuditStatus,
  ContentStatus,
  PrismaClient,
  PromptScene
} from "@prisma/client";
import { AI_PROMPT_NAMES } from "../src/modules/ai/prompt-names";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10);
}

async function main() {
  const textModel = process.env.ARK_MODEL_ID ?? process.env.ARK_MODEL ?? "doubao-seed";
  const seededPasswordHash = hashPassword("123456");

  const user = await prisma.user.upsert({
    where: { email: "creator@example.com" },
    create: {
      email: "creator@example.com",
      passwordHash: seededPasswordHash,
      nickname: "Luna Studio",
      bio: "专注 AI 辅助图文创作、内容增长与生活方式选题。",
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
      bio: "专注 AI 辅助图文创作、内容增长与生活方式选题。",
      avatarUrl: "",
      passwordHash: seededPasswordHash
    }
  });

  const officialUser = await prisma.user.upsert({
    where: { email: "topics@toutiao.example.com" },
    create: {
      email: "topics@toutiao.example.com",
      passwordHash: seededPasswordHash,
      nickname: "头条创作中心",
      bio: "提供官方创作活动、热点话题与优质内容样例。",
      avatarUrl: ""
    },
    update: {
      nickname: "头条创作中心",
      bio: "提供官方创作活动、热点话题与优质内容样例。",
      avatarUrl: "",
      passwordHash: seededPasswordHash
    }
  });

  const travelCreator = await prisma.user.upsert({
    where: { email: "northcity@example.com" },
    create: {
      email: "northcity@example.com",
      passwordHash: seededPasswordHash,
      nickname: "北城小鹿",
      bio: "城市微旅行与周末生活方式创作者。",
      avatarUrl: ""
    },
    update: {
      nickname: "北城小鹿",
      bio: "城市微旅行与周末生活方式创作者。",
      avatarUrl: "",
      passwordHash: seededPasswordHash
    }
  });

  const techCreator = await prisma.user.upsert({
    where: { email: "mosslab@example.com" },
    create: {
      email: "mosslab@example.com",
      passwordHash: seededPasswordHash,
      nickname: "Moss Lab",
      bio: "关注 AI 工具、效率系统和内容生产流程。",
      avatarUrl: ""
    },
    update: {
      nickname: "Moss Lab",
      bio: "关注 AI 工具、效率系统和内容生产流程。",
      avatarUrl: "",
      passwordHash: seededPasswordHash
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
      authorId: user.id,
      assetId: "asset_content_001",
      coverUrl: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
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
      collectCount: 416,
      clickCount: 2200,
      publishedAt: new Date("2026-05-20T08:30:00.000Z")
    },
    {
      id: "content_002",
      authorId: user.id,
      assetId: "asset_content_002",
      coverUrl: "https://images.unsplash.com/photo-1504851149312-7a075b496cc7?auto=format&fit=crop&w=900&q=80",
      title: "AI 辅助整理露营装备清单",
      excerpt: "从人群、预算和天气出发，拆成封面、正文、标签和发布摘要。",
      body: "露营装备内容可以先按人群、天气、预算三个维度拆解，再由 AI 辅助生成清单和发布摘要。",
      status: ContentStatus.pending_review,
      tags: ["露营", "清单", "户外"],
      qualityScore: 84,
      heatScore: 63,
      viewCount: 3520,
      likeCount: 214,
      collectCount: 98,
      clickCount: 640,
      publishedAt: null
    },
    {
      id: "content_003",
      authorId: user.id,
      assetId: "asset_content_003",
      coverUrl: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=80",
      title: "新手咖啡器具选购指南",
      excerpt: "用 AI 生成结构，再由创作者补充个人体验与图片素材。",
      body: "这是一篇待完善草稿，计划补充手冲壶、磨豆机、滤杯和入门预算建议。",
      status: ContentStatus.draft,
      tags: ["咖啡", "新手", "器具"],
      qualityScore: 0,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      collectCount: 0,
      clickCount: 0,
      publishedAt: null
    },
    {
      id: "content_004",
      authorId: user.id,
      assetId: "asset_content_004",
      coverUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
      title: "城市微旅行：半天完成一篇可发布攻略",
      excerpt: "把路线、预算、拍照点和避坑提醒组合成读者可直接收藏的城市指南。",
      body: "半天微旅行攻略需要先确认路线密度，再组合预算、拍照点和避坑提醒。",
      status: ContentStatus.approved,
      tags: ["微旅行", "攻略", "城市"],
      qualityScore: 89,
      heatScore: 74,
      viewCount: 6788,
      likeCount: 463,
      collectCount: 256,
      clickCount: 1160,
      publishedAt: null
    },
    {
      id: "content_005",
      authorId: user.id,
      assetId: "asset_content_005",
      coverUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
      title: "低预算桌面改造清单",
      excerpt: "从素材图片中识别物品层级，生成适合种草平台的封面标题和正文结构。",
      body: "当前版本存在部分绝对化表达，适合进入合规改写后再次提交审核。",
      status: ContentStatus.rejected,
      tags: ["桌面", "改造", "清单"],
      qualityScore: 72,
      heatScore: 41,
      viewCount: 980,
      likeCount: 57,
      collectCount: 22,
      clickCount: 180,
      publishedAt: null
    },
    {
      id: "content_006",
      authorId: user.id,
      assetId: "asset_content_006",
      coverUrl: "https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?auto=format&fit=crop&w=900&q=80",
      title: "一周内容复盘：把灵感整理成可发布选题",
      excerpt: "用固定模板沉淀灵感、素材、标题和发布节奏，让创作更稳定。",
      body: "复盘不是简单记录数据，而是把每一次发布拆成选题来源、标题表达、图片素材和读者反馈。\n\n这一周我把零散灵感放进同一张表，标记适合短图文、长图文和清单型内容的方向，再用 AI 辅助补标题和正文结构。真正有用的部分，是每个选题都留下下一步动作。",
      status: ContentStatus.published,
      tags: ["内容复盘", "选题库", "效率"],
      qualityScore: 88,
      heatScore: 79,
      viewCount: 9120,
      likeCount: 641,
      collectCount: 310,
      clickCount: 1540,
      publishedAt: new Date("2026-05-24T10:00:00.000Z")
    },
    {
      id: "content_007",
      authorId: user.id,
      assetId: "asset_content_007",
      coverUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
      title: "用 AI 做图文封面前，我会先写这 4 句话",
      excerpt: "先确定主体、场景、光线和文字空间，再生成更稳定的封面图。",
      body: "封面图最怕只有氛围，没有主体。我的做法是先写清楚四件事：画面主体是谁、读者看到的场景是什么、光线和色彩要传达什么、标题文字放在哪里。\n\n当提示词具备这些信息后，AI 生成的图片更容易被二次编辑，也更适合信息流展示。",
      status: ContentStatus.published,
      tags: ["AI封面", "图文创作", "提示词"],
      qualityScore: 90,
      heatScore: 92,
      viewCount: 18320,
      likeCount: 1324,
      collectCount: 704,
      clickCount: 3150,
      publishedAt: new Date("2026-05-26T09:20:00.000Z")
    },
    {
      id: "content_008",
      authorId: user.id,
      assetId: "asset_content_008",
      coverUrl: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80",
      title: "团队共创图文时，如何避免来回返工",
      excerpt: "用清晰分工、素材清单和版本备注，让多人协作更顺畅。",
      body: "这篇草稿准备整理团队协作中的图文生产流程，重点放在分工、素材命名、审核备注和发布前检查。",
      status: ContentStatus.draft,
      tags: ["团队协作", "图文流程", "效率"],
      qualityScore: 0,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      collectCount: 0,
      clickCount: 0,
      publishedAt: null
    },
    {
      id: "official_topic_001",
      authorId: officialUser.id,
      assetId: "asset_official_001",
      coverUrl: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80",
      title: "官方话题：城市生活灵感季",
      excerpt: "记录通勤、街区、周末和小店里的真实生活切面。",
      body: "城市生活灵感季鼓励创作者从身边的街区、通勤路线、周末活动和小店体验出发，写出具体、真实、有画面感的图文内容。\n\n建议内容包含场景、路线、花费、体验感受和适合人群，让读者能直接收藏并尝试。",
      status: ContentStatus.published,
      tags: ["城市生活灵感季", "城市观察", "生活方式"],
      qualityScore: 94,
      heatScore: 98,
      viewCount: 42600,
      likeCount: 3200,
      collectCount: 1880,
      clickCount: 7600,
      publishedAt: new Date("2026-05-25T03:00:00.000Z")
    },
    {
      id: "official_topic_002",
      authorId: officialUser.id,
      assetId: "asset_official_002",
      coverUrl: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80",
      title: "官方话题：周末微旅行计划",
      excerpt: "半天到一天的小路线、低预算玩法和避坑提醒都适合参与。",
      body: "周末微旅行计划适合分享短途路线、城市周边玩法、预算清单和真实体验。内容最好给出时间安排、交通方式、拍照点和避坑提醒。",
      status: ContentStatus.published,
      tags: ["周末微旅行计划", "微旅行", "攻略"],
      qualityScore: 92,
      heatScore: 95,
      viewCount: 38800,
      likeCount: 2860,
      collectCount: 2090,
      clickCount: 6900,
      publishedAt: new Date("2026-05-25T05:00:00.000Z")
    },
    {
      id: "official_topic_003",
      authorId: officialUser.id,
      assetId: "asset_official_003",
      coverUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
      title: "官方话题：我的效率工作台",
      excerpt: "分享桌面、工具、模板和工作流，让经验能被复用。",
      body: "我的效率工作台欢迎创作者展示自己的桌面布置、工具选择、模板搭建和工作流复盘。优秀内容通常会把工具背后的使用场景讲清楚。",
      status: ContentStatus.published,
      tags: ["我的效率工作台", "效率工具", "桌面改造"],
      qualityScore: 91,
      heatScore: 90,
      viewCount: 31900,
      likeCount: 2380,
      collectCount: 1640,
      clickCount: 5300,
      publishedAt: new Date("2026-05-25T07:30:00.000Z")
    },
    {
      id: "official_topic_004",
      authorId: officialUser.id,
      assetId: "asset_official_004",
      coverUrl: "https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=900&q=80",
      title: "官方话题：AI 创作实验室",
      excerpt: "围绕提示词、图片生成、改写和选题复盘分享真实过程。",
      body: "AI 创作实验室关注真实的创作过程。可以分享提示词、草稿迭代、封面生成、标题优化和数据复盘，也欢迎写清楚失败经验。",
      status: ContentStatus.published,
      tags: ["AI创作实验室", "提示词", "图文创作"],
      qualityScore: 95,
      heatScore: 99,
      viewCount: 51600,
      likeCount: 4210,
      collectCount: 2530,
      clickCount: 9800,
      publishedAt: new Date("2026-05-26T01:00:00.000Z")
    },
    {
      id: "creator_travel_001",
      authorId: travelCreator.id,
      assetId: "asset_travel_001",
      coverUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
      title: "南京半日微旅行：从公园走到湖边日落",
      excerpt: "一条适合周末下午的城市路线，包含交通、拍照点和咖啡补给。",
      body: "这条路线从城市公园开始，沿湖边步道走到日落视角最好的栈道。整体强度不高，适合想短暂换个环境的人。\n\n建议下午三点出发，先完成公园散步和咖啡补给，再把日落时间留给湖边。",
      status: ContentStatus.published,
      tags: ["周末微旅行计划", "南京", "城市路线"],
      qualityScore: 89,
      heatScore: 87,
      viewCount: 22100,
      likeCount: 1460,
      collectCount: 980,
      clickCount: 3400,
      publishedAt: new Date("2026-05-26T04:00:00.000Z")
    },
    {
      id: "creator_tech_001",
      authorId: techCreator.id,
      assetId: "asset_tech_001",
      coverUrl: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=900&q=80",
      title: "把 AI 写作流程拆成 3 个可复用模板",
      excerpt: "从选题、正文结构到发布复盘，给出一套适合图文创作者的模板。",
      body: "AI 写作流程可以拆成选题模板、正文模板和复盘模板。选题模板负责确定读者、场景和问题；正文模板负责拆结构；复盘模板负责记录发布后的数据和下一步动作。",
      status: ContentStatus.published,
      tags: ["AI创作实验室", "效率工具", "内容复盘"],
      qualityScore: 93,
      heatScore: 94,
      viewCount: 27600,
      likeCount: 2080,
      collectCount: 1420,
      clickCount: 4700,
      publishedAt: new Date("2026-05-26T06:30:00.000Z")
    }
  ];

  for (const seed of contentSeeds) {
    const { assetId, coverUrl, authorId, ...content } = seed;

    await prisma.content.upsert({
      where: { id: content.id },
      create: {
        ...content,
        authorId
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
        collectCount: content.collectCount,
        clickCount: content.clickCount,
        publishedAt: content.publishedAt
      }
    });

    await prisma.asset.upsert({
      where: { id: assetId },
      create: {
        id: assetId,
        uploaderId: authorId,
        fileName: `${content.id}.jpg`,
        mimeType: "image/jpeg",
        url: coverUrl,
        source: "official-seed",
        auditStatus: AssetAuditStatus.approved
      },
      update: {
        uploaderId: authorId,
        fileName: `${content.id}.jpg`,
        mimeType: "image/jpeg",
        url: coverUrl,
        source: "official-seed",
        auditStatus: AssetAuditStatus.approved
      }
    });

    await prisma.contentAsset.upsert({
      where: {
        contentId_assetId: {
          contentId: content.id,
          assetId
        }
      },
      create: {
        contentId: content.id,
        assetId,
        sortOrder: 0
      },
      update: {
        sortOrder: 0
      }
    });
  }

  const draftSeeds = contentSeeds.filter((content) => content.authorId === user.id && content.status === ContentStatus.draft);
  for (const draft of draftSeeds) {
    await prisma.draft.upsert({
      where: { contentId: draft.id },
      create: {
        contentId: draft.id,
        authorId: user.id,
        title: draft.title,
        body: draft.body,
        payload: {
          coverPreview: draft.coverUrl,
          tags: draft.tags
        }
      },
      update: {
        title: draft.title,
        body: draft.body,
        payload: {
          coverPreview: draft.coverUrl,
          tags: draft.tags
        }
      }
    });
  }

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

  const creativePrompts = [
    {
      id: "prompt_direct_generate",
      name: AI_PROMPT_NAMES.directGenerate,
      scene: PromptScene.generate,
      template: `你是今日头条图文创作助手。请根据用户提供的前置需求生成结构完整、表达丰富的图文草稿。

主题：{{theme}}
目标人群：{{audience}}
风格：{{style}}
核心观点：{{viewpoint}}
素材参考：{{materialNotes}}

只返回 JSON，字段必须包含：
title, titleCandidates, bodyMarkdown, tags, coverSuggestion, imagePrompts, outline。`,
      variables: ["theme", "audience", "style", "viewpoint", "materialNotes"],
      modelOptions: { temperature: 0.75 }
    },
    {
      id: "prompt_creative_chat",
      name: AI_PROMPT_NAMES.creativeChat,
      scene: PromptScene.generate,
      template: `你是今日头条创作者的右侧创作助手，当前模式是「碰撞思路」，不是「直接生成」。

必须优先回答用户这一次的问题：{{message}}
不要根据“主题、目标人群、风格”重新生成整篇图文，除非用户明确要求你生成完整草稿。
如果用户要求扩充、润色、改写正文中的某个部分，请先依据当前正文判断相关段落；如果正文里没有找到该部分，要明确说明“当前正文未检测到该段落”，再给出一段可插入内容。
回答使用 Markdown，但不要输出推理过程、不要重复回答。

当前标题：{{currentTitle}}
当前正文：{{currentBody}}
正文摘要：{{bodySummary}}
选中文本：{{selectedText}}
最近对话：{{historyText}}
用户问题：{{message}}

请给出具体、可插入、可行动的回答。`,
      variables: ["message", "currentTitle", "currentBody", "bodySummary", "selectedText", "historyText"],
      modelOptions: { temperature: 0.75 }
    },
    {
      id: "prompt_title_generate",
      name: AI_PROMPT_NAMES.titleGenerate,
      scene: PromptScene.generate,
      template: `你是今日头条标题优化助手。只能根据当前标题和正文生成标题候选，不要使用用户未提供的主题、目标人群或风格。

当前标题：{{currentTitle}}
正文：{{body}}

只返回 JSON：{"candidates":[{"title":"标题","reason":"推荐理由"}]}`,
      variables: ["currentTitle", "body"],
      modelOptions: { temperature: 0.65 }
    },
    {
      id: "prompt_selection_polish",
      name: AI_PROMPT_NAMES.selectionPolish,
      scene: PromptScene.rewrite,
      template: `你是中文图文编辑助手。请润色选中文本，让表达更顺、更清晰，但不要改变原意。

选中文本：{{selectedText}}
周边上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
      variables: ["selectedText", "surroundingContext", "tone"],
      modelOptions: { temperature: 0.45 }
    },
    {
      id: "prompt_selection_expand",
      name: AI_PROMPT_NAMES.selectionExpand,
      scene: PromptScene.rewrite,
      template: `你是中文图文编辑助手。请扩写选中文本，补充具体场景、细节或可执行建议，使其更适合今日头条图文内容。

选中文本：{{selectedText}}
周边上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
      variables: ["selectedText", "surroundingContext", "tone"],
      modelOptions: { temperature: 0.6 }
    },
    {
      id: "prompt_selection_tone",
      name: AI_PROMPT_NAMES.selectionTone,
      scene: PromptScene.rewrite,
      template: `你是中文图文编辑助手。请将选中文本改写为目标语气，保持信息准确，不额外解释。

选中文本：{{selectedText}}
周边上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
      variables: ["selectedText", "surroundingContext", "tone"],
      modelOptions: { temperature: 0.55 }
    }
  ];

  for (const prompt of creativePrompts) {
    await prisma.promptTemplate.upsert({
      where: { id: prompt.id },
      create: {
        id: prompt.id,
        creatorId: user.id,
        name: prompt.name,
        scene: prompt.scene,
        template: prompt.template,
        variables: prompt.variables,
        model: textModel,
        modelOptions: prompt.modelOptions,
        version: 1,
        status: "active"
      },
      update: {
        name: prompt.name,
        scene: prompt.scene,
        template: prompt.template,
        variables: prompt.variables,
        model: textModel,
        modelOptions: prompt.modelOptions,
        status: "active"
      }
    });
  }

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
