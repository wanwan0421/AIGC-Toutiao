# AI Creator Platform

AI creator production and distribution platform scaffold based on the current implementation plan.

## Structure

- `apps/web`: Next.js + React + TypeScript frontend.
- `apps/api`: NestJS backend API.
- `packages/shared`: Shared enums and DTO contracts.
- `apps/api/prisma/schema.prisma`: PostgreSQL data model draft.
- `docker-compose.yml`: Local PostgreSQL and Redis.

## Local Start

```bash
npm.cmd install
cp .env.example .env
docker compose -p aicp up -d
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev:api
npm.cmd run dev:web
```

Frontend: `http://localhost:3000`

Backend: `http://localhost:3001/api`

Default seeded account: `creator@example.com` / `123456`.

## Editor Flow

- Editor autosaves drafts to PostgreSQL and also keeps a local offline cache for recovery.
- The asset manager supports real image/text uploads into the `Asset` table and shows the uploaded list in the editor.
- The version history panel lets you inspect previous content versions and roll back the current title/body.
- Direct AI generation can fill the title, body, tags, and image assets from the current brief.

## Current Scope

This is the first full-stack framework version. It includes the Next.js frontend, NestJS API module boundaries, shared types, Prisma/Redis infrastructure services, the initial PostgreSQL schema, and a runnable backend foundation backed by PostgreSQL through Prisma. Redis is used for sessions, autosave cache, ranking cache, and counters when it is available.

## API Modules

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/users/profile`
- `PATCH /api/users/preferences`
- `GET /api/contents`
- `POST /api/contents`
- `GET /api/contents/:id`
- `PATCH /api/contents/:id`
- `GET /api/contents/:id/versions`
- `POST /api/contents/:id/submit-review`
- `POST /api/contents/:id/approve`
- `POST /api/contents/:id/publish`
- `POST /api/contents/:id/offline`
- `PUT /api/drafts/:contentId/autosave`
- `GET /api/drafts/:contentId`
- `POST /api/ai/generate`
- `POST /api/ai/audit`
- `POST /api/ai/score`
- `POST /api/ai/rewrite`
- `GET /api/ai/logs`
- `GET /api/prompts`
- `GET /api/prompts/:id`
- `POST /api/prompts`
- `PATCH /api/prompts/:id`
- `GET /api/assets`
- `POST /api/assets`
- `POST /api/assets/:id/link/:contentId`
- `GET /api/rankings`
- `GET /api/moderation/contents/:contentId`
- `POST /api/moderation/contents/:contentId/run`
- `POST /api/moderation/text`
- `POST /api/analytics/events`
- `GET /api/analytics/contents/:contentId`

## Next Implementation Steps

1. Add real JWT guards and request user context instead of the current development default user.
2. Upgrade Redis counters into scheduled write-back and ranking ZSets.
3. Implement the Volcano Ark API gateway and model error handling.
4. Connect the editor autosave, AI generation, review, and publish buttons to the backend APIs.
