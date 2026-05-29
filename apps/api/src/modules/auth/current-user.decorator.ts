import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { UserProfileSummary } from "@aicp/shared";

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request & { user?: UserProfileSummary }>();
  return request.user;
});
