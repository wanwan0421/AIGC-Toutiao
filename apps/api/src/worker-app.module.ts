import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { RedisModule } from "./infra/redis/redis.module";
import { WorkflowModule } from "./modules/workflow/workflow.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), ".env"), join(process.cwd(), "apps/api/.env"), join(process.cwd(), "../../.env")],
    }),
    PrismaModule,
    RedisModule,
    WorkflowModule,
  ],
})
export class WorkerAppModule {}
