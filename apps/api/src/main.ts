import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ limit: "10mb", extended: true }));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: webOrigin,
    credentials: true
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
