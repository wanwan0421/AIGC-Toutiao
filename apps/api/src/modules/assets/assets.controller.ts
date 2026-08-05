import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import type { UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AssetsService } from "./assets.service";
import { FileInterceptor } from "@nestjs/platform-express";
import { CreateAssetDto, UploadAssetDto } from "./assets.dto";
import { AdminGuard } from "../auth/admin.guard";

type UploadFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const { memoryStorage } = require("multer") as { memoryStorage: () => unknown };

@UseGuards(AuthGuard)
@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(@CurrentUser() user: UserProfileSummary, @Query("contentId") contentId?: string) {
    return this.assetsService.list(user.id, contentId);
  }

  @Get("admin/pending-audit")
  @UseGuards(AdminGuard)
  listPendingAudit() {
    return this.assetsService.listAllPendingAudit();
  }

  @Post("admin/batch-reaudit")
  @UseGuards(AdminGuard)
  batchReaudit() {
    return this.assetsService.batchReauditAllPending();
  }

  @Post()
  create(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: CreateAssetDto
  ) {
    return this.assetsService.create(user.id, body);
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() user: UserProfileSummary,
    @UploadedFile() file: UploadFile,
    @Body() body: UploadAssetDto
  ) {
    return this.assetsService.upload(user.id, file, body.contentId);
  }

  @Post(":id/link/:contentId")
  link(@CurrentUser() user: UserProfileSummary, @Param("id") id: string, @Param("contentId") contentId: string) {
    return this.assetsService.link(user.id, id, contentId);
  }

  @Post(":id/delete")
  delete(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.assetsService.delete(user.id, id);
  }
}
