import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WorkerAppModule } from "./worker-app.module";

async function bootstrap() {
  process.env.AI_JOB_PROCESS_ROLE = "worker";
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { logger: ["log", "warn", "error"] });
  app.enableShutdownHooks();
  new Logger("AiJobWorker").log("Independent AI job worker application started");
}

void bootstrap().catch((error) => {
  new Logger("AiJobWorker").error("Independent AI job worker failed to start", error instanceof Error ? error.stack : undefined);
  process.exit(1);
});
