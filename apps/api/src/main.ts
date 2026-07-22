import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
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
  app.use(json({ limit: "10mb" }));
  app.use(getUploadRoute(), serveStatic(getUploadRoot()));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: webOrigins,
    credentials: true
  });
  app.useGlobalFilters(new ApiExceptionFilter());

  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen(port);
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
