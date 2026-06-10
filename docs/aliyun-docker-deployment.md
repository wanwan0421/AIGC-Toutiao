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

Create the real env file from the template:

```bash
cp .env.production.example .env.production
nano .env.production
```

Required edits:

- Replace `SERVER_PUBLIC_IP` with your ECS public IP for temporary HTTP testing.
- Set `AUTH_TOKEN_SECRET` to a long random string.
- Set `POSTGRES_PASSWORD`, and update the password inside `DATABASE_URL` to match.
- Fill `ARK_API_KEY`, `ARK_MODEL_ID`, and optional image model variables.
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

After the API is running, initialize prompt definitions:

```bash
docker compose -f docker-compose.prod.yml exec api npm run seed:prompts -w @aicp/api
```

This does not create demo users or demo content.

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
