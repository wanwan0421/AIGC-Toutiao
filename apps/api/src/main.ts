import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { json, static as serveStatic, type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { getUploadRoot, getUploadRoute } from "./modules/storage/storage.config";

async function bootstrap() {
  process.env.AI_JOB_PROCESS_ROLE = "api";
  const app = await NestFactory.create(AppModule);
  const webOrigins = parseWebOrigins(process.env.WEB_ORIGIN ?? "http://localhost:3000");
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.use(requestIdMiddleware);
  app.use(rejectSimpleMutationContentTypes);
  app.use(json({ limit: "1mb" }));
  app.use(businessQualityValidation);
  app.use(getUploadRoute(), serveStatic(getUploadRoot()));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: webOrigins,
    credentials: true
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
  }));

  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen(port);
}

function businessQualityValidation(request: Request, response: Response, next: NextFunction) {
  if (!request.body || typeof request.body !== "object") return next();
  const issue = validateValue(request.body, "body", 0);
  if (!issue) return next();
  response.status(422).json({
    statusCode: 422,
    code: "VALIDATION_FAILED",
    message: "请求内容不符合业务约束",
    retryable: false,
    requestId: String(response.getHeader("X-Request-ID") ?? randomUUID()),
    details: { fields: [issue] },
  });
}

function validateValue(value: unknown, path: string, depth: number): { path: string; message: string } | null {
  if (depth > 8) return { path, message: "object nesting exceeds 8 levels" };
  if (typeof value === "string" && value.length > 20_000) return { path, message: "text exceeds 20000 characters" };
  if (Array.isArray(value)) {
    const limit = /images?|imagePrompts/i.test(path) ? 5 : 10;
    if (value.length > limit) return { path, message: `array exceeds ${limit} items` };
    for (let index = 0; index < value.length; index += 1) {
      const issue = validateValue(value[index], `${path}.${index}`, depth + 1);
      if (issue) return issue;
    }
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 50) return { path, message: "object has too many fields" };
    for (const [key, child] of entries) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") return { path: `${path}.${key}`, message: "unsafe field name" };
      const issue = validateValue(child, `${path}.${key}`, depth + 1);
      if (issue) return issue;
    }
  }
  return null;
}

function requestIdMiddleware(request: Request, response: Response, next: NextFunction) {
  const requestId = String(request.headers["x-request-id"] ?? randomUUID()).slice(0, 128);
  response.setHeader("X-Request-ID", requestId);
  next();
}

function rejectSimpleMutationContentTypes(request: Request, response: Response, next: NextFunction) {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(request.method)) {
    next();
    return;
  }

  const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
  const isAssetUpload = request.path === "/api/assets/upload";
  const isRejectedSimpleType =
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("text/plain") ||
    (contentType.startsWith("multipart/form-data") && !isAssetUpload);

  if (isRejectedSimpleType) {
    const requestId = String(response.getHeader("X-Request-ID") ?? randomUUID());
    response.status(415).json({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "unsupported content type",
      retryable: false,
      requestId,
    });
    return;
  }

  next();
}

function parseWebOrigins(value: string) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

void bootstrap();
