import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { UserProfileSummary } from "@aicp/shared";
import type { Request } from "express";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: UserProfileSummary }>();
    const allowed = new Set((process.env.ADMIN_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
    if (!request.user || !allowed.has(request.user.id)) throw new ForbiddenException("administrator access required");
    return true;
  }
}
