import bcrypt from "bcrypt";
import { AssetAuditStatus, ContentStatus, PrismaClient, PromptScene } from "@prisma/client";
import { AI_PROMPT_NAMES } from "../src/modules/ai/prompt-names";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10);
}

const demoPasswordHash = hashPassword("123456");

async function seedUsers() {
  const creator = await prisma.user.upsert({
    where: { email: "creator@example.com" },
    create: {
      email: "creator@example.com",
      phone: "13800000001",
      passwordHash: demoPasswordHash,
      nickname: "Luna Studio",
      bio: "专注 AI 辅助图文创作、内容增长与生活方式选题。",
      avatarUrl: "",
      preferences: {
        create: {
          defaultPlatform: "toutiao",
          writingStyles: ["种草", "攻略", "清单"],
          domains: ["穿搭", "生活方式", "效率工具"],
          blockedWords: [],
        },
      },
    },
    update: {
      phone: "13800000001",
      passwordHash: demoPasswordHash,
      nickname: "Luna Studio",
      bio: "专注 AI 辅助图文创作、内容增长与生活方式选题。",
      avatarUrl: "",
    },
  });

  await prisma.userPreference.upsert({
    where: { userId: creator.id },
    create: {
      userId: creator.id,
      defaultPlatform: "toutiao",
      writingStyles: ["种草", "攻略", "清单"],
      domains: ["穿搭", "生活方式", "效率工具"],
      blockedWords: [],
    },
    update: {
      defaultPlatform: "toutiao",
      writingStyles: ["种草", "攻略", "清单"],
      domains: ["穿搭", "生活方式", "效率工具"],
      blockedWords: [],
    },
  });

  const official = await prisma.user.upsert({
    where: { email: "topics@toutiao.example.com" },
    create: {
      email: "topics@toutiao.example.com",
      passwordHash: demoPasswordHash,
      nickname: "今日头条创作中心",
      bio: "提供官方创作活动、热点话题与优质内容样例。",
      avatarUrl: "",
    },
    update: {
      passwordHash: demoPasswordHash,
      nickname: "今日头条创作中心",
      bio: "提供官方创作活动、热点话题与优质内容样例。",
      avatarUrl: "",
    },
  });

  const travelCreator = await prisma.user.upsert({
    where: { email: "northcity@example.com" },
    create: {
      email: "northcity@example.com",
      passwordHash: demoPasswordHash,
      nickname: "北城小鹿",
      bio: "城市微旅行与周末生活方式创作者。",
      avatarUrl: "",
    },
    update: {
      passwordHash: demoPasswordHash,
      nickname: "北城小鹿",
      bio: "城市微旅行与周末生活方式创作者。",
      avatarUrl: "",
    },
  });

  return { creator, official, travelCreator };
}

async function seedContents(users: Awaited<ReturnType<typeof seedUsers>>) {
  const seeds = [
    {
      id: "content_001",
      authorId: users.creator.id,
      assetId: "asset_content_001",
      coverUrl: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
      title: "夏日通勤穿搭的 5 个轻量公式",
      excerpt: "围绕舒适、清爽、可复用三条线，整理适合信息流平台的短图文内容。",
      body:
        "夏天通勤最难的不是穿得好看，而是在热、晒、空调和通勤拥挤之间找到平衡。\n\n可以先准备三类基础单品：透气衬衫、低饱和半裙或阔腿裤、轻薄外搭。每一套搭配都尽量保留一个可重复公式，例如“白衬衫 + 冷感裤 + 低饱和包”。\n\n最后别忘了鞋包配色统一，整体会更干净，也更适合在首图里被快速识别。",
      status: ContentStatus.published,
      tags: ["通勤", "穿搭", "夏日"],
      qualityScore: 91,
      heatScore: 86,
      viewCount: 12840,
      likeCount: 928,
      collectCount: 416,
      clickCount: 2200,
      publishedAt: new Date("2026-05-20T08:30:00.000Z"),
    },
    {
      id: "content_002",
      authorId: users.creator.id,
      assetId: "asset_content_002",
      coverUrl: "https://images.unsplash.com/photo-1504851149312-7a075b496cc7?auto=format&fit=crop&w=900&q=80",
      title: "AI 辅助整理露营装备清单",
      excerpt: "从人群、预算和天气出发，拆成封面、正文、标签和发布摘要。",
      body:
        "露营装备内容适合先按人群、天气、预算三个维度拆解。\n\n新手最关心的是少踩坑，所以正文可以从帐篷、睡眠系统、照明、餐具和收纳五个模块写起。AI 负责把素材整理成清单结构，创作者再补充真实体验和避坑提醒。",
      status: ContentStatus.pending_review,
      tags: ["露营", "清单", "户外"],
      qualityScore: 84,
      heatScore: 63,
      viewCount: 3520,
      likeCount: 214,
      collectCount: 98,
      clickCount: 640,
      publishedAt: null,
    },
    {
      id: "content_003",
      authorId: users.creator.id,
      assetId: "asset_content_003",
      coverUrl: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=80",
      title: "新手咖啡器具选购指南",
      excerpt: "由 AI 生成结构，再由创作者补入个人体验与图片素材。",
      body:
        "这是一篇待完善草稿，计划补充手冲壶、磨豆机、滤杯和入门预算建议。\n\n下一步会把每个器具拆成适用人群、价格区间、购买建议和常见误区。",
      status: ContentStatus.draft,
      tags: ["咖啡", "新手", "器具"],
      qualityScore: 0,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      collectCount: 0,
      clickCount: 0,
      publishedAt: null,
    },
    {
      id: "content_004",
      authorId: users.official.id,
      assetId: "asset_official_001",
      coverUrl: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80",
      title: "官方话题：城市生活灵感季",
      excerpt: "记录通勤、街区、周末和小店里的真实生活切面。",
      body:
        "城市生活灵感季鼓励创作者从身边的街区、通勤路线、周末活动和小店体验出发，写出具体、真实、有画面感的图文内容。\n\n建议内容包含场景、路线、花费、体验感受和适合人群。",
      status: ContentStatus.published,
      tags: ["城市生活灵感季", "城市观察", "生活方式"],
      qualityScore: 94,
      heatScore: 98,
      viewCount: 42600,
      likeCount: 3200,
      collectCount: 1880,
      clickCount: 7600,
      publishedAt: new Date("2026-05-25T03:00:00.000Z"),
    },
    {
      id: "content_005",
      authorId: users.official.id,
      assetId: "asset_official_002",
      coverUrl: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80",
      title: "官方话题：周末微旅行计划",
      excerpt: "半天到一天的小路线、低预算玩法和避坑提醒都适合参与。",
      body:
        "周末微旅行计划适合分享短途路线、城市周边玩法、预算清单和真实体验。内容最好给出时间安排、交通方式、拍照点和避坑提醒。",
      status: ContentStatus.published,
      tags: ["周末微旅行计划", "微旅行", "攻略"],
      qualityScore: 92,
      heatScore: 95,
      viewCount: 38800,
      likeCount: 2860,
      collectCount: 2090,
      clickCount: 6900,
      publishedAt: new Date("2026-05-25T05:00:00.000Z"),
    },
    {
      id: "content_006",
      authorId: users.travelCreator.id,
      assetId: "asset_travel_001",
      coverUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
      title: "南京半日微旅行：从公园走到湖边日落",
      excerpt: "一条适合周末下午的城市路线，包含交通、拍照点和咖啡补给。",
      body:
        "这条路线从城市公园开始，沿湖边步道走到日落视角最好的栈道。整体强度不高，适合想短暂换个环境的人。\n\n建议下午三点出发，先完成公园散步和咖啡补给，再把日落时间留给湖边。",
      status: ContentStatus.published,
      tags: ["周末微旅行计划", "南京", "城市路线"],
      qualityScore: 89,
      heatScore: 87,
      viewCount: 22100,
      likeCount: 1460,
      collectCount: 980,
      clickCount: 3400,
      publishedAt: new Date("2026-05-26T04:00:00.000Z"),
    },
  ];

  for (const seed of seeds) {
    const { assetId, coverUrl, authorId, ...content } = seed;

    await prisma.content.upsert({
      where: { id: content.id },
      create: {
        ...content,
        authorId,
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
        publishedAt: content.publishedAt,
      },
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
        auditStatus: AssetAuditStatus.approved,
      },
      update: {
        uploaderId: authorId,
        fileName: `${content.id}.jpg`,
        mimeType: "image/jpeg",
        url: coverUrl,
        source: "official-seed",
        auditStatus: AssetAuditStatus.approved,
      },
    });

    await prisma.contentAsset.upsert({
      where: {
        contentId_assetId: {
          contentId: content.id,
          assetId,
        },
      },
      create: {
        contentId: content.id,
        assetId,
        sortOrder: 0,
      },
      update: {
        sortOrder: 0,
      },
    });
  }

  const draft = seeds.find((item) => item.id === "content_003");
  if (draft) {
    await prisma.draft.upsert({
      where: { contentId: draft.id },
      create: {
        contentId: draft.id,
        authorId: users.creator.id,
        title: draft.title,
        body: draft.body,
        payload: {
          tags: draft.tags,
          coverPreview: draft.coverUrl,
          assetIds: [draft.assetId],
        },
      },
      update: {
        title: draft.title,
        body: draft.body,
        payload: {
          tags: draft.tags,
          coverPreview: draft.coverUrl,
          assetIds: [draft.assetId],
        },
      },
    });
  }

  await prisma.contentVersion.upsert({
    where: { contentId_version: { contentId: "content_003", version: 1 } },
    create: {
      contentId: "content_003",
      version: 1,
      title: "新手咖啡器具选购指南",
      body: "第一版草稿：先列出器具清单，再补充真实体验。",
      snapshot: { source: "seed" },
    },
    update: {
      title: "新手咖啡器具选购指南",
      body: "第一版草稿：先列出器具清单，再补充真实体验。",
      snapshot: { source: "seed" },
    },
  });
}

async function seedMaterialAssets(userId: string) {
  const assets = [
    {
      id: "asset_material_text_001",
      fileName: "夏日通勤素材笔记.txt",
      mimeType: "text/plain",
      url: "material://text/asset_material_text_001",
      metadata: {
        text: "用户调研：20-30 岁女性夏季通勤最关注防晒、显瘦、空调房保暖和鞋子舒适度。",
        preview: "用户调研：20-30 岁女性夏季通勤最关注防晒、显瘦、空调房保暖和鞋子舒适度。",
      },
    },
    {
      id: "asset_material_text_002",
      fileName: "音乐节内容补充.txt",
      mimeType: "text/plain",
      url: "material://text/asset_material_text_002",
      metadata: {
        text: "音乐节内容可以补充入场时间、穿搭舒适度、补水、防晒、拍照点和散场交通提醒。",
        preview: "音乐节内容可以补充入场时间、穿搭舒适度、补水、防晒、拍照点和散场交通提醒。",
      },
    },
  ];

  for (const asset of assets) {
    await prisma.asset.upsert({
      where: { id: asset.id },
      create: {
        ...asset,
        uploaderId: userId,
        source: "seed-material",
        auditStatus: AssetAuditStatus.approved,
      },
      update: {
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        url: asset.url,
        source: "seed-material",
        metadata: asset.metadata,
        auditStatus: AssetAuditStatus.approved,
      },
    });
  }
}

async function seedPrompts(userId: string) {
  const textModel = process.env.ARK_MODEL_ID ?? process.env.ARK_MODEL ?? "doubao-seed";
  const prompts = [
    {
      id: "prompt_direct_generate",
      name: AI_PROMPT_NAMES.directGenerate,
      scene: PromptScene.generate,
      variables: ["theme", "audience", "style", "viewpoint", "materialNotes"],
      modelOptions: { temperature: 0.75 },
      template: `你是今日头条图文创作助手。请根据用户提供的前置需求生成结构完整、表达丰富、适合信息流阅读的图文草稿。

主题：{{theme}}
目标人群：{{audience}}
风格：{{style}}
核心观点：{{viewpoint}}
素材参考：{{materialNotes}}

只返回 JSON，不要输出 Markdown 代码块。字段必须包含 title、titleCandidates、bodyMarkdown、tags、coverSuggestion、imagePrompts、outline。`,
    },
    {
      id: "prompt_creative_chat",
      name: AI_PROMPT_NAMES.creativeChat,
      scene: PromptScene.generate,
      variables: ["message", "currentTitle", "currentBody", "bodySummary", "selectedText", "historyText"],
      modelOptions: { temperature: 0.75 },
      template: `你是今日头条创作者的右侧创作助手，当前模式是“碰撞思路”，不是“直接生成”。

必须优先回答用户这一轮问题：{{message}}
不要主动要求用户补充主题、目标人群、风格，除非用户明确要求生成完整图文且信息不足。
如果用户要求扩充、润色、改写正文中的某个部分，请结合当前正文和选中文本给出可插入内容。

当前标题：{{currentTitle}}
当前正文：{{currentBody}}
正文摘要：{{bodySummary}}
选中文本：{{selectedText}}
最近对话：{{historyText}}
用户问题：{{message}}`,
    },
    {
      id: "prompt_title_generate",
      name: AI_PROMPT_NAMES.titleGenerate,
      scene: PromptScene.generate,
      variables: ["currentTitle", "body"],
      modelOptions: { temperature: 0.65 },
      template: `你是今日头条标题优化助手。请只基于当前标题和正文生成标题候选，不要使用用户未提供的主题、目标人群或风格。

当前标题：{{currentTitle}}
正文：{{body}}

只返回 JSON：{"candidates":[{"title":"标题","reason":"推荐理由"}]}`,
    },
    {
      id: "prompt_selection_polish",
      name: AI_PROMPT_NAMES.selectionPolish,
      scene: PromptScene.rewrite,
      variables: ["selectedText", "surroundingContext", "tone"],
      modelOptions: { temperature: 0.45 },
      template: `你是中文图文编辑助手。请润色选中文本，让表达更顺、更清晰，但不要改变原意。

选中文本：{{selectedText}}
周围上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
    },
    {
      id: "prompt_selection_expand",
      name: AI_PROMPT_NAMES.selectionExpand,
      scene: PromptScene.rewrite,
      variables: ["selectedText", "surroundingContext", "tone"],
      modelOptions: { temperature: 0.6 },
      template: `你是中文图文编辑助手。请扩写选中文本，补充具体场景、细节或可执行建议。

选中文本：{{selectedText}}
周围上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
    },
    {
      id: "prompt_selection_tone",
      name: AI_PROMPT_NAMES.selectionTone,
      scene: PromptScene.rewrite,
      variables: ["selectedText", "surroundingContext", "tone"],
      modelOptions: { temperature: 0.55 },
      template: `你是中文图文编辑助手。请将选中文本改写为目标语气，保持信息准确。

选中文本：{{selectedText}}
周围上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
    },
    {
      id: "prompt_safety_review",
      name: AI_PROMPT_NAMES.safetyReview,
      scene: PromptScene.audit,
      variables: ["title", "body"],
      modelOptions: { temperature: 0.15 },
      template: `你是中文内容安全审核专家，只负责判断内容是否合规，不做质量评分，也不做改写。

标题：{{title}}
正文：{{body}}

请检查涉黄、赌博、毒品、敏感信息、低俗表达、隐私泄露、夸大绝对化等风险。
只返回 JSON，不要输出 Markdown 或额外解释：
{
  "passed": true,
  "riskLevel": "low",
  "riskTypes": ["none"],
  "reasons": ["未发现明显合规风险"],
  "rewriteAvailable": false
}`,
    },
    {
      id: "prompt_quality_score",
      name: AI_PROMPT_NAMES.qualityScore,
      scene: PromptScene.score,
      variables: ["title", "body"],
      modelOptions: { temperature: 0.25 },
      template: `你是中文图文内容质量评估专家，只负责多维质量评分，不做安全审核，也不做改写。

标题：{{title}}
正文：{{body}}

请从五个维度评分，每个维度 0-20 分，总分 0-100：
1. structure：结构完整度
2. clarity：表达清晰度
3. value：信息价值
4. attraction：标题与内容吸引力
5. compliance：合规表达质量

只返回 JSON，不要输出 Markdown 或额外解释：
{
  "total": 86,
  "dimensions": {
    "structure": 18,
    "clarity": 17,
    "value": 18,
    "attraction": 16,
    "compliance": 17
  },
  "reason": "结构完整，表达清晰，具备发布基础"
}`,
    },
    {
      id: "prompt_compliance_rewrite",
      name: AI_PROMPT_NAMES.complianceRewrite,
      scene: PromptScene.rewrite,
      variables: ["title", "body", "reasons"],
      modelOptions: { temperature: 0.45 },
      template: `你是中文内容合规改写编辑，只负责生成可替换的合规版本。

原标题：{{title}}
原正文：{{body}}
审核原因：
{{reasons}}

请保留原主题和有价值信息，弱化或移除违规、敏感、夸大、隐私泄露和低俗表达。
只返回 JSON，不要输出 Markdown 或额外解释：
{
  "title": "合规改写后的标题",
  "body": "合规改写后的正文",
  "reasons": ["弱化绝对化表达", "移除敏感信息"]
}`,
    },
  ];

  for (const prompt of prompts) {
    await prisma.promptTemplate.upsert({
      where: { id: prompt.id },
      create: {
        id: prompt.id,
        creatorId: userId,
        name: prompt.name,
        scene: prompt.scene,
        template: prompt.template,
        variables: prompt.variables,
        model: textModel,
        modelOptions: prompt.modelOptions,
        version: 1,
        status: "active",
      },
      update: {
        name: prompt.name,
        scene: prompt.scene,
        template: prompt.template,
        variables: prompt.variables,
        model: textModel,
        modelOptions: prompt.modelOptions,
        status: "active",
      },
    });
  }
}

async function main() {
  const users = await seedUsers();
  await seedContents(users);
  await seedMaterialAssets(users.creator.id);
  await seedPrompts(users.creator.id);
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
