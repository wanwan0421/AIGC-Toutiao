import { Body, Controller, Get, Headers, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";

const ACCESS_COOKIE_NAME = "aicp.accessToken";
const REFRESH_COOKIE_NAME = "aicp.refreshToken";
const ACCESS_TOKEN_MAX_AGE_MS = 1000 * 60 * 15;
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
    const result = await this.authService.register(body, this.buildContext(request));
    this.setSessionCookies(response, result.accessToken, result.refreshToken);
    return this.stripTokens(result);
  }

  @Post("login")
  async login(
    @Body() body: { account: string; password: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.authService.login(body, this.buildContext(request));
    this.setSessionCookies(response, result.accessToken, result.refreshToken);
    return this.stripTokens(result);
  }

  @Post("verification-code")
  verificationCode(@Body() body: { account: string }, @Req() request: Request) {
    return this.authService.requestVerificationCode(body, this.buildContext(request));
  }

  @Post("refresh")
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = this.authService.extractRefreshToken(request.headers.cookie);
    const result = await this.authService.refresh(refreshToken, this.buildContext(request));
    this.setSessionCookies(response, result.accessToken, result.refreshToken);
    return this.stripTokens(result);
  }

  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers("authorization") authorization?: string
  ) {
    const result = await this.authService.logout(authorization, request.headers.cookie, this.buildContext(request));
    this.clearSessionCookies(response);
    return result;
  }

  @Get("me")
  me(@Req() request: Request, @Headers("authorization") authorization?: string) {
    return this.authService.me(authorization, request.headers.cookie);
  }

  private buildContext(request: Request) {
    return {
      ip: request.ip,
      userAgent: request.headers["user-agent"] as string | undefined,
      cookieHeader: request.headers.cookie
    };
  }

  private setSessionCookies(response: Response, accessToken: string, refreshToken: string) {
    response.cookie(ACCESS_COOKIE_NAME, accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure(),
      path: "/api",
      maxAge: ACCESS_TOKEN_MAX_AGE_MS
    });

    response.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure(),
      path: "/api/auth",
      maxAge: REFRESH_TOKEN_MAX_AGE_MS
    });
  }

  private clearSessionCookies(response: Response) {
    response.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure(),
      path: "/api"
    });

    response.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure(),
      path: "/api/auth"
    });
  }

  private cookieSecure() {
    const configured = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
    if (configured) {
      return configured === "1" || configured === "true" || configured === "yes";
    }
    return process.env.NODE_ENV === "production";
  }

  private stripTokens<T extends { accessToken: string; refreshToken: string; refreshExpiresIn: number }>(result: T) {
    const { accessToken, refreshToken, refreshExpiresIn, ...rest } = result;
    return rest;
  }
}
