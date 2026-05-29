import { Body, Controller, Get, Headers, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("profile")
  getProfile(@Req() request: Request, @Headers("authorization") authorization?: string) {
    return this.usersService.getProfile(authorization, request.headers.cookie);
  }

  @Post("contact-verification-code")
  requestContactVerificationCode(
    @Req() request: Request,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { account: string }
  ) {
    return this.usersService.requestContactVerificationCode(authorization, request.headers.cookie, body);
  }

  @Patch("profile")
  updateProfile(
    @Headers("authorization") authorization: string | undefined,
    @Req() request: Request,
    @Body()
    body: Partial<{
      nickname: string;
      bio: string;
      avatarUrl: string;
      email: string;
      phone: string;
      contactVerificationCode: string;
      defaultPlatform: string;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    }>
  ) {
    return this.usersService.updateProfile(authorization, request.headers.cookie, body);
  }

  @Patch("preferences")
  updatePreferences(
    @Headers("authorization") authorization: string | undefined,
    @Req() request: Request,
    @Body()
    body: Partial<{
      defaultPlatform: string;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    }>
  ) {
    return this.usersService.updatePreferences(authorization, request.headers.cookie, body);
  }
}
