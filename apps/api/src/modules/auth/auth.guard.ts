import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { UserProfileSummary } from "@aicp/shared";
import { AuthService } from "./auth.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: UserProfileSummary }>();
    const user = await this.authService.me(request.headers.authorization, request.headers.cookie);
    if (!user) {
      throw new UnauthorizedException("login required");
    }

    request.user = user;
    return true;
  }
}
