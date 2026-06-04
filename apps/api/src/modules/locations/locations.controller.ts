import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { LocationsService } from "./locations.service";

type NearbyLocationsBody = {
  latitude: number;
  longitude: number;
};

@UseGuards(AuthGuard)
@Controller("locations")
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post("nearby")
  nearby(@Body() body: NearbyLocationsBody) {
    return this.locations.nearby(Number(body.latitude), Number(body.longitude));
  }

  @Get("search")
  search(@Query("keyword") keyword = "") {
    return this.locations.search(keyword);
  }
}
