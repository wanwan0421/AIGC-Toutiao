import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, static as serveStatic, type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module";
import { getUploadRoot, getUploadRoute } from "./modules/storage/storage.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigins = parseWebOrigins(process.env.WEB_ORIGIN ?? "http://localhost:3000");
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.use(rejectSimpleMutationContentTypes);
  app.use(json({ limit: "10mb" }));
  app.use(getUploadRoute(), serveStatic(getUploadRoot()));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: webOrigins,
    credentials: true
  });

  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen(port);
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
    response.status(415).json({ message: "unsupported content type" });
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
