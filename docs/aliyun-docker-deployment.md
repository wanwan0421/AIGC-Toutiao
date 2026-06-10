# Aliyun ECS Docker Deployment

This guide deploys the whole project on one Aliyun ECS instance with Docker Compose:

- `nginx`: public HTTP entrypoint
- `web`: Next.js frontend
- `api`: NestJS backend
- `postgres`: PostgreSQL
- `redis`: Redis
- Docker volumes: database, Redis data, uploads

## 1. Prepare ECS

Recommended starting point:

- Ubuntu 22.04 LTS
- 2 vCPU / 4 GB RAM minimum, 2 vCPU / 8 GB preferred
- 40 GB disk minimum, 80 GB preferred
- Security group inbound rules:
  - `22/tcp`: your own IP only
  - `80/tcp`: `0.0.0.0/0`
  - `443/tcp`: `0.0.0.0/0` after TLS is configured

## 2. Install Docker

SSH into the ECS instance:

```bash
ssh root@SERVER_PUBLIC_IP
```

Install Docker Engine and verify Compose:

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

## 3. Upload Code

Clone the repository on the server:

```bash
git clone YOUR_REPOSITORY_URL aicp
cd aicp
```

Or upload the project directory with `scp`/SFTP.

## 4. Create Production Env

Create the real env file in the project root on the server:

```bash
cp .env.production.example .env.production
nano .env.production
```

If `.env.production.example` is not present on the server, create `.env.production` directly:

```bash
cd /root/aicp
nano .env.production
```

Minimum example for temporary IP-based testing:

```env
NODE_ENV=production

WEB_ORIGIN=http://SERVER_PUBLIC_IP
AUTH_COOKIE_SECURE=false
AUTH_TOKEN_SECRET=replace-with-a-long-random-secret

POSTGRES_USER=aicp
POSTGRES_PASSWORD=replace-with-a-strong-db-password
POSTGRES_DB=aicp
DATABASE_URL=postgresql://aicp:replace-with-a-strong-db-password@postgres:5432/aicp?schema=public

REDIS_URL=redis://redis:6379

ARK_API_KEY=your-ark-api-key
ARK_MODEL_ID=your-ark-model-id
ARK_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions

AMAP_API_KEY=your-amap-web-service-key

UPLOAD_ROOT=/app/uploads
UPLOAD_PUBLIC_BASE=http://SERVER_PUBLIC_IP/api/uploads

VERIFICATION_DELIVERY_MODE=real

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=

ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
```

Required edits:

- Replace `SERVER_PUBLIC_IP` with your ECS public IP for temporary HTTP testing.
- Set `AUTH_TOKEN_SECRET` to a long random string.
- Set `POSTGRES_PASSWORD`, and update the password inside `DATABASE_URL` to match.
- Fill `ARK_API_KEY`, `ARK_MODEL_ID`, and optional image model variables.
- Fill `AMAP_API_KEY` if you want nearby location and location search in the editor.
- Fill SMTP and Aliyun SMS variables if you need real verification delivery.

Temporary HTTP testing:

```env
WEB_ORIGIN=http://SERVER_PUBLIC_IP
AUTH_COOKIE_SECURE=false
UPLOAD_PUBLIC_BASE=http://SERVER_PUBLIC_IP/api/uploads
```

After domain and HTTPS are ready:

```env
WEB_ORIGIN=https://your-domain.com
AUTH_COOKIE_SECURE=true
UPLOAD_PUBLIC_BASE=https://your-domain.com/api/uploads
```

Never commit `.env.production`.

## 5. Start Services

Build and start all containers:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Check status:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

The API container runs `prisma migrate deploy` on startup.

## 6. Initialize Production Prompts

The production API container automatically initializes missing prompt definitions on startup, after database migrations are applied. This does not create demo users or demo content.

If you need to initialize prompts manually, do it inside the API container. The host machine does not need Node.js or npm:

```bash
docker compose -f docker-compose.prod.yml exec api node apps/api/dist/scripts/seed-production-prompts.js
```

If you need to refresh existing production prompt versions intentionally:

```bash
docker compose -f docker-compose.prod.yml exec -e PROMPT_INIT_FORCE_UPDATE=true api node apps/api/dist/scripts/seed-production-prompts.js
```

## 7. Smoke Test

Open:

```text
http://SERVER_PUBLIC_IP
http://SERVER_PUBLIC_IP/api/health
```

Expected health response:

```json
{"ok":true,"service":"ai-creator-platform-api"}
```

Then test:

- Register with email or phone
- Login
- Open editor
- Run AI generation
- Upload an image and refresh the page

## 8. Domain and HTTPS

For long-term access, bind a domain to the ECS public IP:

1. Add an `A` record pointing to `SERVER_PUBLIC_IP`.
2. Complete ICP filing if using a mainland China ECS with a domain.
3. Configure HTTPS with Nginx certificates, Certbot, Caddy, or an Aliyun SSL certificate.
4. Update `.env.production`:

```env
WEB_ORIGIN=https://your-domain.com
AUTH_COOKIE_SECURE=true
UPLOAD_PUBLIC_BASE=https://your-domain.com/api/uploads
```

Restart services:

```bash
docker compose -f docker-compose.prod.yml up -d
```

## 9. Useful Commands

View logs:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

Restart API only:

```bash
docker compose -f docker-compose.prod.yml restart api
```

Rebuild after code updates:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Backup PostgreSQL:

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U aicp aicp > backup.sql
```

Stop services:

```bash
docker compose -f docker-compose.prod.yml down
```

Do not run `docker compose down -v` unless you intentionally want to delete database, Redis, and uploads volumes.
