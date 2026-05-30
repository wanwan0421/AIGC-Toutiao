import "reflect-metadata";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { json, static as serveStatic, urlencoded } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ limit: "10mb", extended: true }));
  app.use("/api/uploads", serveStatic(join(process.cwd(), "uploads")));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: webOrigin,
    credentials: true
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
