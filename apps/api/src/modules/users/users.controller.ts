import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("profile")
  getProfile(@Headers("authorization") authorization?: string) {
    return this.usersService.getProfile(authorization);
  }

  @Post("contact-verification-code")
  requestContactVerificationCode(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { account: string }
  ) {
    return this.usersService.requestContactVerificationCode(authorization, body);
  }

  @Patch("profile")
  updateProfile(
    @Headers("authorization") authorization: string | undefined,
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
    return this.usersService.updateProfile(authorization, body);
  }

  @Patch("preferences")
  updatePreferences(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Partial<{
      defaultPlatform: string;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    }>
  ) {
    return this.usersService.updatePreferences(authorization, body);
  }

  @Get(":id/public-profile")
  getPublicProfile(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    return this.usersService.getPublicProfile(authorization, id);
  }

  @Get(":id/contents")
  listPublicContents(
    @Param("id") id: string
  ) {
    return this.usersService.listPublicContents(id);
  }

  @Post(":id/follow/toggle")
  toggleFollow(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    return this.usersService.toggleFollow(authorization, id);
  }
}
