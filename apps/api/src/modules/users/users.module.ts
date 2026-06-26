import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentMetricsModule } from "../content-metrics/content-metrics.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule, ContentMetricsModule],
  controllers: [UsersController],
  providers: [UsersService]
})
export class UsersModule {}
