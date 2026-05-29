export const AI_PROMPT_NAMES = {
  directGenerate: "direct_generate",
  creativeChat: "creative_chat",
  titleGenerate: "title_generate",
  selectionPolish: "selection_polish",
  selectionExpand: "selection_expand",
  selectionTone: "selection_tone",
} as const;

type SelectionAction = "polish" | "expand" | "tone";

export function selectionPromptName(action: SelectionAction) {
  const names: Record<SelectionAction, string> = {
    polish: AI_PROMPT_NAMES.selectionPolish,
    expand: AI_PROMPT_NAMES.selectionExpand,
    tone: AI_PROMPT_NAMES.selectionTone,
  };

  return names[action];
}
