import type { AiJobType, AiSkillKey, DirectGenerateRequest } from "@aicp/shared";

export type SkillRouterAction = "chat" | "run_skill" | "edit_current_content" | "ask_clarification";

export type SkillRouterDecision = {
  action: SkillRouterAction;
  skillKey?: AiSkillKey;
  confidence: number;
  message?: string;
  input?: Record<string, unknown>;
};

export type SkillResourceIndex = {
  prompts: string[];
  references: string[];
  scripts: string[];
  assets: string[];
};

export type SkillTrustedContext = {
  skillKey: AiSkillKey;
  skillName: string;
  instructions: string;
  resources: SkillResourceIndex;
  resourceText: string;
};

export type SkillExecutionContext = {
  userId: string;
  contentId?: string | null;
  conversationId?: string;
  source?: "button" | "conversation";
};

export type SkillJobRequest = {
  type: `${AiJobType}`;
  payload: Record<string, unknown>;
  contentId?: string;
};

export type ContentProductionLineInput = Partial<DirectGenerateRequest> & {
  source?: "button" | "conversation";
  conversationId?: string;
  message?: string;
  currentTitle?: string;
  currentBody?: string;
  historyText?: string;
  operationId?: string;
};

export type SkillProgressHooks = {
  progress?: (progress: number, currentStep: string, message: string) => Promise<void>;
  partial?: (kind: string, value: unknown) => Promise<void>;
  warning?: (message: string) => Promise<void>;
  assertNotCancelled?: () => Promise<void>;
  signal?: AbortSignal;
  loadCheckpoint?: (stepKey: string) => Promise<unknown | undefined>;
  saveCheckpoint?: (stepKey: string, data: unknown) => Promise<boolean>;
};
