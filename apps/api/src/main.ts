import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, static as serveStatic, urlencoded } from "express";
import { AppModule } from "./app.module";
import { getUploadRoot, getUploadRoute } from "./modules/storage/storage.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ limit: "10mb", extended: true }));
  app.use(getUploadRoute(), serveStatic(getUploadRoot()));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: webOrigin,
    credentials: true
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
