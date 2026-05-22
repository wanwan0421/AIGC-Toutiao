import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(@Body() body: { account: string; password: string; nickname?: string }) {
    return this.authService.register(body);
  }

  @Post("login")
  login(@Body() body: { account: string; password: string }) {
    return this.authService.login(body);
  }

  @Post("logout")
  logout(@Headers("authorization") authorization?: string) {
    return this.authService.logout(authorization);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.me(authorization);
  }
}
