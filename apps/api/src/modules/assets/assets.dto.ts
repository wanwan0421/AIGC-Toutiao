import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class CreateAssetDto {
  @IsString() @IsNotEmpty() @MaxLength(255) fileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) mimeType!: string;
  @IsUrl({ require_protocol: true, protocols: ["https"] }) @MaxLength(2_048) url!: string;
  @IsOptional() @IsString() @MaxLength(128) contentId?: string;
}

export class UploadAssetDto {
  @IsOptional() @IsString() @MaxLength(128) contentId?: string;
}
