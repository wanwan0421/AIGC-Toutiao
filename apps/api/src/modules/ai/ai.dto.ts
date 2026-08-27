import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional,
  IsString, MaxLength, Min, ValidateNested,
} from "class-validator";
import { AiJobType } from "@aicp/shared";

export class StartAiJobDto {
  @IsEnum(AiJobType)
  type!: AiJobType;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  assistantMessageId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CreativeImageJobDto {
  @IsOptional() @IsString() @MaxLength(128) contentId?: string;
  @IsOptional() @IsString() @MaxLength(100) position?: string;
  @IsString() @IsNotEmpty() @MaxLength(20_000) prompt!: string;
  @IsOptional() @IsString() @MaxLength(128) conversationId?: string;
  @IsOptional() @IsString() @MaxLength(128) assistantMessageId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) idempotencyKey?: string;
}

export class AttachConversationDto {
  @IsString() @IsNotEmpty() @MaxLength(128) contentId!: string;
}

export class RecoverJobsQueryDto {
  @IsOptional() @IsString() @MaxLength(128) conversationId?: string;
  @IsOptional() @IsString() @MaxLength(128) contentId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export class CommitContentDto {
  @IsOptional() @IsString() @MaxLength(128) contentId?: string;
  @IsString() @MaxLength(100) title!: string;
  @IsString() @MaxLength(20_000) body!: string;
  @IsOptional() @IsString() @MaxLength(20_000) bodyHtml?: string | null;
  @IsOptional() @IsObject() bodyJson?: Record<string, unknown> | null;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags!: string[];
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) assetIds!: string[];
  @IsObject() payload!: Record<string, unknown>;
}

export class CommitJobResultDto {
  @IsString() @IsNotEmpty() resultEventId!: string;
  @ValidateNested() @Type(() => CommitContentDto) content!: CommitContentDto;
}
