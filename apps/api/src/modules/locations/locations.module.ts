import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller";
import { LocationsService } from "./locations.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  imports: [AuthModule],
})
export class LocationsModule {}
