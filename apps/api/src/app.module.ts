import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { ContentsModule } from "./modules/contents/contents.module";
import { DraftsModule } from "./modules/drafts/drafts.module";
import { AiModule } from "./modules/ai/ai.module";
import { PromptsModule } from "./modules/prompts/prompts.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { RankingsModule } from "./modules/rankings/rankings.module";
import { ModerationModule } from "./modules/moderation/moderation.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { RedisModule } from "./infra/redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    ContentsModule,
    DraftsModule,
    AiModule,
    PromptsModule,
    AssetsModule,
    RankingsModule,
    ModerationModule,
    AnalyticsModule
  ],
  controllers: [AppController]
})
export class AppModule {}
