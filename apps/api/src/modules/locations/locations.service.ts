import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { LocationCandidate, LocationSearchResponse, NearbyLocationsResponse } from "@aicp/shared";
import { RedisService } from "../../infra/redis/redis.service";

type AmapRegeoResponse = {
  status?: string;
  info?: string;
  infocode?: string;
  regeocode?: {
    formatted_address?: string;
    addressComponent?: {
      city?: string | string[];
      district?: string;
    };
  };
};

type AmapPoi = {
  id?: string;
  name?: string;
  address?: string | string[];
  type?: string;
  distance?: string | number;
  location?: string;
};

type AmapPoiResponse = {
  status?: string;
  info?: string;
  infocode?: string;
  pois?: AmapPoi[];
};

@Injectable()
export class LocationsService {
  constructor(
    private readonly config: ConfigService,
    private readonly redisService: RedisService
  ) {}

  // 前端只提交用户授权后的坐标；第三方地图调用统一由后端代理，避免泄露高德 key。
  async nearby(latitude: number, longitude: number): Promise<NearbyLocationsResponse> {
    this.assertCoordinate(latitude, longitude);
    
    const cacheKey = `locations:v2:nearby:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached);
    }

    const [regeo, around] = await Promise.all([
      this.fetchAmap<AmapRegeoResponse>("/v3/geocode/regeo", {
        location: `${longitude},${latitude}`,
        extensions: "all",
        radius: "1000",
      }),
      this.fetchAmap<AmapPoiResponse>("/v3/place/around", {
        location: `${longitude},${latitude}`,
        radius: "3000",
        offset: "12",
        page: "1",
        extensions: "base",
        sortrule: "distance",
      }),
    ]);

    const addressComponent = regeo.regeocode?.addressComponent;
    const city = this.normalizeMaybeArray(addressComponent?.city);
    const district = addressComponent?.district;
    const formattedAddress = regeo.regeocode?.formatted_address ?? "";
    const candidates = this.dedupeCandidates([
      ...(formattedAddress
        ? [
            {
              id: "amap-current-location",
              name: district || city || "当前位置",
              address: formattedAddress,
              type: "当前位置",
              distance: 0,
              latitude,
              longitude,
              source: "amap" as const,
            },
          ]
        : []),
      ...this.mapPois(around.pois ?? []),
    ]);

    const result = {
      formattedAddress,
      city,
      district,
      candidates,
    };
    
    await this.redisService.getClient().setex(cacheKey, 300, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  async search(keyword: string): Promise<LocationSearchResponse> {
    const query = keyword.trim();
    if (!query) {
      throw new BadRequestException("keyword is required");
    }

    const cacheKey = `locations:v2:search:${Buffer.from(query).toString("base64")}`;
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached);
    }

    const response = await this.fetchAmap<AmapPoiResponse>("/v3/place/text", {
      keywords: query,
      offset: "12",
      page: "1",
      extensions: "base",
    });

    const result = { candidates: this.dedupeCandidates(this.mapPois(response.pois ?? [])) };
    await this.redisService.getClient().setex(cacheKey, 300, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  private async fetchAmap<T extends { status?: string; info?: string; infocode?: string }>(path: string, params: Record<string, string>) {
    const key = this.config.get<string>("AMAP_API_KEY")?.trim();
    if (!key) {
      throw new ServiceUnavailableException("AMAP_API_KEY is not configured");
    }

    const url = new URL(`https://restapi.amap.com${path}`);
    url.searchParams.set("key", key);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }

    let payload: T;
    try {
      const response = await fetch(url);
      payload = (await response.json()) as T;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new ServiceUnavailableException(`AMap request failed: ${message}`);
    }

    if (payload.status !== "1") {
      const detail = [payload.info, payload.infocode].filter(Boolean).join(" / ");
      throw new ServiceUnavailableException(`AMap request failed: ${detail || "unknown error"}`);
    }

    return payload;
  }

  private mapPois(pois: AmapPoi[]): LocationCandidate[] {
    return pois
      .map((poi, index) => {
        const [longitude, latitude] = this.parsePoiLocation(poi.location);
        return {
          id: poi.id || `amap-poi-${index}-${poi.name ?? "unknown"}`,
          name: poi.name ?? "未命名地点",
          address: this.normalizeMaybeArray(poi.address),
          type: poi.type ?? "地点",
          distance: this.normalizeDistance(poi.distance),
          latitude,
          longitude,
          source: "amap" as const,
        };
      })
      .filter((poi) => poi.name.trim().length > 0);
  }

  private dedupeCandidates(candidates: LocationCandidate[]) {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = `${candidate.name}|${candidate.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private normalizeMaybeArray(value?: string | string[]) {
    return Array.isArray(value) ? value.filter(Boolean).join("") : value ?? "";
  }

  private normalizeDistance(value?: string | number) {
    const distance = typeof value === "number" ? value : Number(value);
    return Number.isFinite(distance) ? distance : undefined;
  }

  private parsePoiLocation(location?: string): [number | undefined, number | undefined] {
    if (!location) return [undefined, undefined];
    const [longitude, latitude] = location.split(",").map(Number);
    return [
      Number.isFinite(longitude) ? longitude : undefined,
      Number.isFinite(latitude) ? latitude : undefined,
    ];
  }

  private assertCoordinate(latitude: number, longitude: number) {
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestException("invalid coordinate");
    }
  }
}
