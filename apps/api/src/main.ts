import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, static as serveStatic, urlencoded } from "express";
import { AppModule } from "./app.module";
import { getUploadRoot, getUploadRoute } from "./modules/storage/storage.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigins = parseWebOrigins(process.env.WEB_ORIGIN ?? "http://localhost:3000");
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ limit: "10mb", extended: true }));
  app.use(getUploadRoute(), serveStatic(getUploadRoot()));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: webOrigins,
    credentials: true
  });

  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen(port);
}

function parseWebOrigins(value: string) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

void bootstrap();
