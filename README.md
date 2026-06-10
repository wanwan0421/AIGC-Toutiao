# AI 创作者辅助生产与分发平台

这是一个面向图文内容创作者的 AI 内容生产平台，覆盖选题、写作、配图、审核、评分、发布和数据反馈等流程。项目采用 monorepo 组织，包含 Next.js 前端、NestJS 后端、PostgreSQL、Redis 和前后端共享类型包。

## 核心功能

- 用户注册登录：支持邮箱/手机号注册、验证码、登录会话和个人资料管理。
- AI 图文创作：根据主题、受众、风格、观点和素材生成标题、正文、标签、封面建议和配图提示词。
- AI 创作助手：支持对话式写作建议、标题生成、选中文本润色/扩写/改写。
- AI 配图生成：调用火山方舟图片接口生成封面和正文配图，并保存为素材。
- 内容审核：结合本地规则和大模型语义审核，识别敏感、违规、隐私、诈骗等风险。
- 合规改写与质量评分：对未通过内容生成改写建议，并对内容进行多维质量评分。
- 内容管理与发布：支持草稿、自动保存、版本管理、审核后发布、定时发布和下线。
- 分发反馈：包含榜单、话题、阅读、点赞、收藏、评论和数据看板。
- Prompt 管理：支持 Prompt 模板、版本、变量预览、测试用例和 dry-run。

## 技术栈

- 前端：Next.js 14、React 18、Tiptap、Tailwind CSS、lucide-react
- 后端：NestJS、Prisma、ioredis、bcrypt、nodemailer
- 数据库：PostgreSQL
- 缓存/会话：Redis
- AI：火山方舟 Ark Chat Completions 和 Images API
- 工程化：npm workspaces、TypeScript、Docker Compose

## 目录结构

```text
apps/web         Next.js 前端
apps/api         NestJS 后端
packages/shared 前后端共享类型
```

## 本地开发

先安装依赖：

```bash
npm install
```

启动本地 PostgreSQL 和 Redis：

```bash
docker compose up -d postgres redis
```

配置后端环境变量：

```bash
cp apps/api/.env.example apps/api/.env
```

根据需要填写 `DATABASE_URL`、`REDIS_URL`、`AUTH_TOKEN_SECRET`、`ARK_API_KEY`、`ARK_MODEL_ID` 等配置。若要使用地点定位、附近地点和地点搜索，还需要填写高德地图 Web 服务 Key：`AMAP_API_KEY`。

生成 Prisma Client 并初始化数据库：

```bash
npm run db:generate
npm run prisma -w @aicp/api -- migrate dev
npm run db:seed:prompts
```

分别启动前后端：

```bash
npm run dev:api
npm run dev:web
```

默认访问地址：

```text
Web: http://localhost:3000
API: http://localhost:3001/api/health
```

## 常用脚本

```bash
npm run typecheck        类型检查
npm run build            构建 shared、api、web
npm run db:generate      生成 Prisma Client
npm run db:seed:prompts  初始化 Prompt 模板
```

## 环境变量

本地开发至少需要配置：

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
AUTH_TOKEN_SECRET=...
ARK_API_KEY=...
ARK_MODEL_ID=...
ARK_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions
AMAP_API_KEY=...
```

如需真实发送验证码，还需要配置 SMTP 邮件或阿里云短信相关变量。不要提交真实 `.env` 或任何密钥。
