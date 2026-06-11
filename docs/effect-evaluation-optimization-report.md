# 效果评估与优化报告

生成日期：2026-06-11  
项目范围：`G:\LWH\字节训练营` AI 创作者平台  
报告口径：`/dashboard` 是项目首页和主性能指标页；`/rankings` 是榜单/内容分发场景补充页。

## 1. 证据来源与可信度

| 证据类型 | 来源 | 可信度 | 说明 |
| --- | --- | --- | --- |
| 历史对话证据 | 本地 Codex 历史线程：`019e4927...`、`019e742c...`、`019e86cb...`、`019e884f...`、`019e96ec...`、`019eaa29...`、`019eabca...`、`019eacbc...`、`019eb15b...` | 高 | PE 调教证据只使用我与你在 Codex 中围绕本工作区的历史对话；不使用项目数据库中存储的业务对话。 |
| 代码推导 | `apps/api/src/modules/ai/*`、`apps/api/src/modules/workflow/content-workflow.engine.ts`、`apps/api/src/modules/rankings/rankings.service.ts`、`apps/web/app/dashboard/page.tsx` | 高 | 用于解释 AI 审核链路、缓存、排序公式、页面首屏依赖和发布门禁。 |
| 审核实测 | `docs/evaluation/high-risk-eval-results.json`、`docs/evaluation/high-risk-eval-full-llm-results.json` | 高 | 已完成 rule-only 和 Full LLM 全链路审核两套结果。 |
| 性能实测 | `docs/lighthouse/*.json`、`docs/evaluation/lighthouse-summary.json`、`docs/evaluation/dashboard-lcp-results.json` | 高 | Lighthouse 来自线上 `/dashboard`，桌面端和移动端各 3 次；本地 HTTP/API 计时作为补充。 |
| 数据库实测 | 本地 Prisma 查询 `PromptEvalRun.count()` | 中 | 查询结果为 `0`，说明当前缺少 PromptEvalRun 真实模型评测记录。 |

纠偏说明：PE 调教过程来自 Codex 历史对话和对应代码/文档改动，不来自今日头条项目数据库里的业务对话。性能主指标页为 `/dashboard`，不是 `/rankings`。

## 2. PE 调教过程

| 阶段 | 初始问题 | 调整方式 | 效果 |
| --- | --- | --- | --- |
| 初版 AI 创作链路 | 初版偏功能验证，提示词、工作流和前端状态边界不稳定。 | 建立图文生成、编辑器、内容发布、榜单、仪表盘主链路，持续修复草稿恢复、删除内容、布局一致性和接口校验。 | 从“可演示”推进到“主要工作流可贯通”。 |
| Prompt 管理平台 | Prompt 变量维护容易手写出错，预览输入固定，运行参数没有完全进入 agent。 | 变量从模板自动抽取；预览输入跟随变量动态生成；保存并激活 Prompt；`PromptVersion.modelOptions.temperature` 进入 agent 调用。 | Prompt 运维具备版本化、变量可视化和参数可控能力。 |
| Skill Router | 早期路由依赖关键词硬编码，扩展新 skill 成本高。 | 读取 `SKILL.md` 的 name/description 注册表，由 LLM 在中文提示词中选择 skill；移除 keyword fallback。 | 路由逻辑更贴近 PE，失败更显式。 |
| 安全审核 Prompt | LLM 可能判定 unsafe 但不返回 `riskItems`，导致合并结果缺少可解释证据。 | 强化 safety review prompt；`SafetyResultMerger` 对 blocking 但无 risk item 的情况补 fallback 风险项；质量评分增加合规 backstop。 | 审核输出可解释性增强，但本次实测显示召回仍未达标。 |
| 图文生成与图片插槽 | 图片候选和正文位置可能错位，SSE debug 日志会污染前端流。 | 引入 `<!-- aicp-image-slot:slot_1 -->` 和 `slotId`；候选图持久化；动态图片数量；增加生成结果 validator。 | 图文生成从“正文 + 图片提示词并列”升级为“正文插槽 + 图片候选绑定”。 |
| 编辑器 autosave | 刷新/切换时草稿状态和选中文本不稳定。 | 使用 localStorage 保留编辑状态；保存节奏拆成 800ms/3s/30s；抽取 hook；修复地理位置 fallback。 | 减少生成内容丢失，编辑体验更稳。 |

代表性结论：

- 生成类 Prompt 从“直接生成正文”迭代为结构化 JSON 输出，包含 `titleCandidates`、`bodyMarkdown`、`tags`、`coverSuggestion`、`imagePrompts`、`outline`。
- 改写类 Prompt 按润色、扩写、语气转换拆分，并要求只返回 replacement JSON，降低编辑器替换风险。
- 安全审核 Prompt 明确“只做安全审核，不做质量评分或改写”，但高危召回仍需要样本集和模型策略继续优化。
- 目前缺少固定 Prompt 回归集和真实模型 A/B 数据，`PromptEvalRun` 仍为空。

## 3. 审核准确率评估

### 3.1 方法

- 样本：`docs/evaluation/high-risk-eval-samples.json`，共 30 条。
- 覆盖：色情引流、赌博、诈骗、隐私泄露、违禁交易、毒品交易、普通安全内容、新闻/科普/反诈/隐私保护等误杀场景。
- rule-only：直接调用 `SafetyRuleEngine.scan`，结果见 `docs/evaluation/high-risk-eval-results.json`。
- Full LLM 全链路：逐条调用 `POST /api/moderation/text`，使用返回的 merged `audit` 作为最终预测，结果见 `docs/evaluation/high-risk-eval-full-llm-results.json`。
- 指标：accuracy、high-risk recall、precision、F1、TP/FP/TN/FN、漏检/误杀样本。

### 3.2 结果对比

| 指标 | Rule-only | Full LLM 全链路 | 目标/说明 |
| --- | ---: | ---: | --- |
| 样本数 | 30 | 30 | - |
| 成功完成 | 30 | 30 | Full LLM 失败样本经低频重试后全部完成。 |
| TP | 6 | 6 | - |
| FP | 0 | 1 | Full LLM 误杀 `HR-016`。 |
| TN | 16 | 15 | - |
| FN | 8 | 8 | 两套结果漏检样本相同。 |
| Accuracy | 73.33% | 70.00% | Full LLM 因误杀下降。 |
| High-risk Recall | 42.86% | 42.86% | 目标 ≥ 90%，未达标。 |
| High-risk Precision | 100.00% | 85.71% | Full LLM 多 1 个误报。 |
| F1 | 60.00% | 57.14% | 未达预期。 |
| False Positive Rate | 0.00% | 6.25% | - |

Full LLM 漏检样本：`HR-002`、`HR-006`、`HR-009`、`HR-010`、`HR-019`、`HR-020`、`HR-023`、`HR-025`。  
Full LLM 误杀样本：`HR-016`。  
Full LLM 耗时：30 条成功样本平均 `18594 ms`，中位数 `16049 ms`，最短 `5206 ms`，最长 `34209 ms`。

### 3.3 结论

- Full LLM 全链路已经补测完成，但没有达到高危识别准确率目标，核心短板仍是高危召回。
- 漏检集中在赌博引流、违禁交易、诈骗引流、色情资源售卖等高危组合表达上，说明当前 LLM 语义复核与 merger 未能弥补规则召回不足。
- `HR-016` 是“内容安全规则复盘”的元讨论样本，Full LLM 将其判为高危，说明误杀样本集需要纳入 Prompt 回归。
- 当前不能宣称审核准确率达标；应将 rule-only、LLM-only、merged-result 分开记录，继续优化规则映射、Prompt、阈值和合并策略。

## 4. 首页 `/dashboard` 性能指标达成

### 4.1 Lighthouse 线上实测

线上地址：`http://47.99.127.195/dashboard`  
原始文件：`docs/lighthouse/移动端1.json` 至 `docs/lighthouse/移动端3.json`，`docs/lighthouse/桌面端1.json` 至 `docs/lighthouse/桌面端3.json`。  
汇总文件：`docs/evaluation/lighthouse-summary.json`。

桌面端 3 次 Lighthouse 结果：

| 指标 | 平均 | 最小 | 最大 | 结论 |
| --- | ---: | ---: | ---: | --- |
| Performance | 95.33 | 95 | 96 | 达到优秀水平。 |
| FCP | 339 ms | 317 ms | 350 ms | 首次内容绘制很快。 |
| LCP | 888 ms | 856 ms | 905 ms | 首页桌面端 LCP 达标。 |
| TBT | 0 ms | 0 ms | 0 ms | 主线程阻塞非常低。 |
| CLS | 0.118 | 0.118 | 0.118 | 略高于理想值 0.1，需要小幅优化。 |
| Speed Index | 644 ms | 571 ms | 691 ms | 视觉完成速度稳定。 |
| TTFB | 42 ms | 39 ms | 45 ms | 服务器响应快。 |

桌面端 LCP 元素主要是顶部品牌文字“今日头条创作服务平台”。性能瓶颈不在后端响应，剩余优化主要是布局偏移和少量资源体积。

### 4.2 移动端风险

移动端 3 次 Lighthouse 结果：

| 指标 | 平均 | 最小 | 最大 | 结论 |
| --- | ---: | ---: | ---: | --- |
| Performance | 64.00 | 52 | 71 | 不稳定，需要优化。 |
| FCP | 884 ms | 867 ms | 899 ms | FCP 尚可。 |
| LCP | 4166 ms | 3477 ms | 5499 ms | 移动端主要短板。 |
| TBT | 121 ms | 92 ms | 156 ms | 主线程阻塞不算严重。 |
| CLS | 0.407 | 0.407 | 0.407 | 严重偏移，需要优先修复。 |
| Speed Index | 4532 ms | 1813 ms | 8641 ms | 波动大。 |
| TTFB | 46 ms | 44 ms | 48 ms | 后端响应不是瓶颈。 |

移动端 LCP 元素是“进入 AI 协作创作中心，完成从构思到图文发布的流程”这段文本。主要问题是移动端模拟节流下的元素渲染延迟和布局偏移，而不是图片 LCP。Lighthouse 还提示约 `183 KiB` 未使用 JavaScript，部分缩略图以 900px 级别资源显示在 50px 左右区域，存在资源浪费。

### 4.3 本地 HTTP/API 补充

本地计时文件 `docs/evaluation/dashboard-lcp-results.json` 显示 `/dashboard` 的 HTML shell 返回较快，但首屏数据依赖 `getContents()`、`getRankings({ type: "viral", limit: 20 })`、`getOfficialTopics(6)`、`getDashboardAnalytics(...)` 并行加载。该结果用于定位接口依赖，不替代 Lighthouse LCP。

## 5. 榜单 `/rankings` 分发性能补充

`/rankings` 是榜单/内容分发场景，不作为项目首页主指标。  
本地补充文件：`docs/evaluation/rankings-lcp-results.json`。

| 指标 | 冷缓存中位数 | 热缓存中位数 | 说明 |
| --- | ---: | ---: | --- |
| 页面 shell HTTP | 126.90 ms | 117.73 ms | `GET /rankings` HTML shell。 |
| `/api/rankings?type=viral&limit=12` | 1304.20 ms | 1301.79 ms | 榜单页首屏依赖瓶颈。 |
| `/api/rankings/topics?limit=8` | 17.45 ms | 19.10 ms | 状态 200。 |
| Critical API Path | 1304.20 ms | 1301.79 ms | 按最大接口耗时估算。 |

排序效果来自 `rankings.service.ts`：`recommended` 偏质量优先，`viral` 偏爆款热度，`hot` 偏即时热度，官方话题榜综合质量、热度、互动和新鲜度。

## 6. 内容生成与分发效果

| 维度 | 当前完成情况 | 评价 |
| --- | --- | --- |
| 结构完整性 | 生成结果要求结构化 JSON，包含标题候选、正文 Markdown、标签、封面建议、图片提示词和 outline。 | 可解析性强，适合落库和编辑器承接。 |
| 标题吸引力 | 标题生成拆成独立 agent，只基于当前标题和正文生成候选。 | 降低无关主题注入，但缺少 CTR/A-B 数据证明收益。 |
| 正文可编辑性 | 选中文本润色、扩写、语气转换返回 replacement JSON。 | 适合局部替换，编辑体验较完整。 |
| 图片插槽 | `slotId` 与正文机器插槽绑定图片候选。 | 能减少图文错位，但仍需统计采用率和错配率。 |
| 审核/质量衔接 | 安全审核、合规改写、质量评分、发布流程已经贯通。 | 功能存在，但 Full LLM 审核召回未达标。 |
| 榜单分发 | 已实现推荐、热门、爆款、话题等排序逻辑和 Redis 缓存。 | 缺少长期曝光、点击、互动、转化和 A/B 数据。 |

## 7. 项目完成度、课题差距与后续优化

### 7.1 已完成能力

- AI 图文生成：支持选题、正文、标题候选、标签、封面建议、图片提示词和图文插槽。
- Prompt 管理：支持 Prompt 版本、变量抽取、预览、保存激活、模型参数进入 agent。
- 编辑器草稿：支持 autosave、本地状态保留、内容版本和局部改写。
- 内容安全：支持规则预检、LLM 语义审核、结果合并、合规改写和审核记录。
- 质量评分：支持结构、清晰度、价值、吸引力、合规等维度评分。
- 内容发布：支持审核、质量评分、发布、下线、可见性和定时发布基础链路。
- 内容分发：支持榜单排序、官方话题、Redis 缓存和 Dashboard 数据展示。
- 部署与实测：项目已部署到 `http://47.99.127.195/dashboard`，并完成桌面端/移动端 Lighthouse 各 3 次实测。

### 7.2 课题差距

- Full LLM 审核准确率未达标：高危召回仅 `42.86%`，距离 ≥ 90% 目标明显不足。
- PromptEvalRun 真实模型评测为空：缺少固定 Prompt 回归集、模型输出评测和版本对比数据。
- 移动端性能不稳定：移动端 Performance 平均 `64`，LCP 平均 `4166 ms`，CLS `0.407`。
- 分发效果缺少长期数据：当前有排序公式和榜单展示，但没有曝光、点击、互动、完读、转化、A/B 实验来证明效果提升。
- 发布门禁仍需收紧：`pending_review` 发布兼容逻辑需要继续评估，避免审核未通过内容进入发布态。

### 7.3 后续优化

- 审核召回：修复规则类型映射，扩充高危样本到至少 200 条，覆盖谐音、拆词、外链、二维码、截图 OCR、规避表达。
- Prompt 回归：建立 PromptEvalRun 真实模型评测，将 rule-only、LLM-only、merged-result 分开统计。
- 移动端 CLS/LCP：为 Dashboard 首屏卡片设置稳定尺寸，减少登录态/数据加载后的整体位移；拆分首屏数据优先级。
- Dashboard 首屏加载：核心用户信息和关键指标优先渲染，榜单/话题延迟加载或独立 skeleton，避免单个慢接口拖住整屏。
- 图片资源：缩略图使用按需尺寸、压缩参数和统一优化组件，避免小图加载 900px 资源。
- 榜单排序实验：增加 quality-first、heat-first、freshness boosted、diversity boosted 分桶，建立效果看板。
- 发布门禁：移除或收紧 `pending_review` 直接发布兼容路径，发布前强制检查最近一次审核和质量评分状态。

## 8. 产物清单

- 主报告：`docs/effect-evaluation-optimization-report.md`
- 高危审核样本：`docs/evaluation/high-risk-eval-samples.json`
- 高危审核 rule-only 结果：`docs/evaluation/high-risk-eval-results.json`
- 高危审核 rule-only 指标：`docs/evaluation/high-risk-eval-metrics.json`
- Full LLM 审核结果：`docs/evaluation/high-risk-eval-full-llm-results.json`
- Full LLM 审核指标：`docs/evaluation/high-risk-eval-full-llm-metrics.json`
- Lighthouse 汇总：`docs/evaluation/lighthouse-summary.json`
- 首页 `/dashboard` 本地 HTTP/API 补充数据：`docs/evaluation/dashboard-lcp-results.json`
- 榜单 `/rankings` 本地 HTTP/API 补充数据：`docs/evaluation/rankings-lcp-results.json`
