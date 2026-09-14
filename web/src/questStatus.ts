import type { QuestResponse } from "./types.js";

// A quest is "empty" only when it has no open targets AND nothing found. A
// quest with zero open targets but some melted ones is a real, designed screen
// (the Found list), not the "recorded every species" dead-end.
export function resolveQuestStatus(res: QuestResponse): "empty" | "loaded" {
  return res.totalTargets === 0 && res.melted.length === 0 ? "empty" : "loaded";
}
