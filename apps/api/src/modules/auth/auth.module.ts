import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { VerificationDeliveryService } from "./verification-delivery.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, VerificationDeliveryService],
  exports: [AuthService, AuthGuard]
})
export class AuthModule {}
