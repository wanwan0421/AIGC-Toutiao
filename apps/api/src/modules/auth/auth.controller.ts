import { Body, Controller, ForbiddenException, Get, Headers, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";

const ACCESS_COOKIE_NAME = "aicp.accessToken";
const REFRESH_COOKIE_NAME = "aicp.refreshToken";
const REFRESH_TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(
    @Body() body: { account: string; password: string; nickname?: string; verificationCode: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    this.assertTrustedMutation(request);
    const result = await this.authService.register(body, this.buildContext(request));
    this.setRefreshCookie(response, result.refreshToken);
    this.clearLegacyAccessCookie(response);
    this.disableAuthCaching(response);
    return this.stripRefreshToken(result);
  }

  @Post("login")
  async login(
    @Body() body: { account: string; password: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    this.assertTrustedMutation(request);
    const result = await this.authService.login(body, this.buildContext(request));
    this.setRefreshCookie(response, result.refreshToken);
    this.clearLegacyAccessCookie(response);
    this.disableAuthCaching(response);
    return this.stripRefreshToken(result);
  }

  @Post("verification-code")
  verificationCode(@Body() body: { account: string }, @Req() request: Request) {
    this.assertTrustedMutation(request);
    return this.authService.requestVerificationCode(body, this.buildContext(request));
  }

  @Get("csrf")
  async csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedRead(request);
    const refreshToken = this.authService.extractRefreshToken(request.headers.cookie);
    const result = await this.authService.getCsrfToken(refreshToken);
    this.disableAuthCaching(response);
    return result;
  }

  @Post("refresh")
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers("x-csrf-token") csrfToken?: string
  ) {
    this.assertTrustedMutation(request);
    const refreshToken = this.authService.extractRefreshToken(request.headers.cookie);
    const result = await this.authService.refresh(refreshToken, csrfToken, this.buildContext(request));
    this.setRefreshCookie(response, result.refreshToken);
    this.clearLegacyAccessCookie(response);
    this.disableAuthCaching(response);
    return this.stripRefreshToken(result);
  }

  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers("authorization") authorization?: string,
    @Headers("x-csrf-token") csrfToken?: string
  ) {
    this.assertTrustedMutation(request);
    const refreshToken = this.authService.extractRefreshToken(request.headers.cookie);
    this.clearSessionCookies(response);
    this.disableAuthCaching(response);
    const result = await this.authService.logout(authorization, refreshToken, csrfToken, this.buildContext(request));
    return result;
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.me(authorization);
  }

  private buildContext(request: Request) {
    return {
      ip: request.ip,
      userAgent: request.headers["user-agent"] as string | undefined
    };
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure(),
      path: "/api/auth",
      maxAge: REFRESH_TOKEN_MAX_AGE_MS
    });
  }

  private clearSessionCookies(response: Response) {
    this.clearLegacyAccessCookie(response);
    response.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure(),
      path: "/api/auth"
    });
  }

  private clearLegacyAccessCookie(response: Response) {
    response.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure(),
      path: "/api"
    });
  }

  private disableAuthCaching(response: Response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
  }

  private assertTrustedMutation(request: Request) {
    const origin = request.headers.origin;
    if (!origin || !this.allowedOrigins().has(origin)) {
      throw new ForbiddenException("untrusted request origin");
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      throw new ForbiddenException("cross-site request rejected");
    }
  }

  private assertTrustedRead(request: Request) {
    if (request.headers["sec-fetch-site"] === "cross-site") {
      throw new ForbiddenException("cross-site request rejected");
    }
    const origin = request.headers.origin;
    if (origin && !this.allowedOrigins().has(origin)) {
      throw new ForbiddenException("untrusted request origin");
    }
  }

  private allowedOrigins() {
    return new Set(
      (process.env.WEB_ORIGIN ?? "http://localhost:3000")
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean)
    );
  }

  private cookieSecure() {
    const configured = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
    if (configured) {
      return configured === "1" || configured === "true" || configured === "yes";
    }
    return process.env.NODE_ENV === "production";
  }

  private stripRefreshToken<T extends { refreshToken: string; refreshExpiresIn: number }>(result: T) {
    const { refreshToken, refreshExpiresIn, ...rest } = result;
    return rest;
  }
}
