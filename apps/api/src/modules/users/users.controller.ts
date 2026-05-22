import { Body, Controller, Get, Patch } from "@nestjs/common";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("profile")
  getProfile() {
    return this.usersService.getProfile();
  }

  @Patch("preferences")
  updatePreferences(
    @Body()
    body: Partial<{
      defaultPlatform: string;
      writingStyles: string[];
      domains: string[];
      blockedWords: string[];
    }>
  ) {
    return this.usersService.updatePreferences(body);
  }
}
