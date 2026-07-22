import { Controller, Get } from "@nestjs/common";
import { AppError } from "./common/app-error";
import { PrismaService } from "./infra/prisma/prisma.service";

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("health")
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new AppError({
        code: "DATABASE_UNAVAILABLE",
        message: "database readiness check failed",
        statusCode: 503,
        retryable: true,
        cause: error,
      });
    }
    return {
      ok: true,
      service: "ai-creator-platform-api",
      database: "ready",
    };
  }
}
