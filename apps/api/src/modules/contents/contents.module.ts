import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";

@Module({
  imports: [AuthModule],
  controllers: [ContentsController],
  providers: [ContentsService]
})
export class ContentsModule {}
