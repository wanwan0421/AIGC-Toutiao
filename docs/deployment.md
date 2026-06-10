# Production Deployment

This project is deployed as a split PaaS setup:

- Web: Vercel, serving `apps/web`.
- API: Render web service, serving `apps/api`.
- Data: Render PostgreSQL and Redis.
- AI provider: Volcengine Ark API, configured through `ARK_*` environment variables.

## Domains

Use HTTPS subdomains under the same root domain:

- Web: `https://app.example.com`
- API: `https://api.example.com`

Set Vercel `NEXT_PUBLIC_API_BASE_URL` to `https://api.example.com/api`.
Set Render `WEB_ORIGIN` to `https://app.example.com`.

## Render API

`render.yaml` defines PostgreSQL, Redis, the API service, and a persistent disk for uploads.

Required secret environment variables:

- `AUTH_TOKEN_SECRET`
- `ARK_API_KEY`
- `ARK_MODEL_ID`
- `ARK_IMAGE_API_KEY` and `ARK_IMAGE_MODEL_ID` if image generation is enabled
- `AMAP_API_KEY` if nearby location and location search are enabled
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`
- `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ALIYUN_SMS_SIGN_NAME`, `ALIYUN_SMS_TEMPLATE_CODE`

Health check path: `/api/health`.

## Vercel Web

`vercel.json` builds the shared package first, then the Next.js app:

```sh
npm run build -w @aicp/shared && npm run build -w @aicp/web
```

Set `NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api` in Vercel.

## Prompt Initialization

Do not run the full demo seed against production. It creates demo users and demo content.

The API start command initializes missing production prompt definitions automatically. Existing prompt versions edited in production are not overwritten unless `PROMPT_INIT_FORCE_UPDATE=true` is set.

If you need to initialize prompts manually in a Docker deployment, run the compiled script inside the API container:

```sh
docker compose -f docker-compose.prod.yml exec api node apps/api/dist/scripts/seed-production-prompts.js
```

If you need to refresh existing prompt versions intentionally:

```sh
docker compose -f docker-compose.prod.yml exec -e PROMPT_INIT_FORCE_UPDATE=true api node apps/api/dist/scripts/seed-production-prompts.js
```

## Verification Codes

Local development defaults to console delivery when `VERIFICATION_DELIVERY_MODE=console`.

Production always uses real delivery:

- Email accounts go through SMTP.
- Phone accounts go through Aliyun SMS.
- API responses never include the raw verification code unless delivery is `console`.

The Aliyun SMS template must include a variable named `code`, unless `ALIYUN_SMS_CODE_PARAM_NAME` is changed.

## Uploads

The initial production setup stores uploads on the Render persistent disk:

- `UPLOAD_ROOT=/var/data/aicp/uploads`
- `UPLOAD_PUBLIC_BASE=https://api.example.com/api/uploads`

For multi-instance API deployments, migrate uploads to object storage before scaling horizontally.
