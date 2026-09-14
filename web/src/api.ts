import type { AppConfig, QuestResponse, QuestSummary, Place } from "./types.js";

// Every network error is normalized to a typed kind so the UI can pick the
// right designed state instead of guessing from a raw exception.
export type ApiErrorKind = "unknown_user" | "quest_limit" | "not_found" | "upstream" | "generic";

export class ApiError extends Error {
  constructor(public readonly kind: ApiErrorKind, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let error = "";
  try {
    const body = (await res.json()) as { error?: string };
    error = body.error ?? "";
  } catch {
    /* ignore unreadable body */
  }
  if (error === "unknown_user") return new ApiError("unknown_user", "unknown user");
  if (error === "quest_limit") return new ApiError("quest_limit", "quest limit");
  if (error === "not_found") return new ApiError("not_found", "not found");
  if (error === "upstream" || res.status === 502) return new ApiError("upstream", "upstream");
  return new ApiError("generic", "generic");
}

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) return {};
  return (await res.json()) as AppConfig;
}

export async function autocompletePlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { results: Place[] };
  return body.results ?? [];
}

export async function createQuest(input: {
  login: string;
  placeId: number;
  placeName: string;
}): Promise<QuestResponse> {
  const res = await fetch("/api/quests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as QuestResponse;
}

export async function listQuests(login: string): Promise<QuestSummary[]> {
  const res = await fetch(`/api/quests?login=${encodeURIComponent(login)}`);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { quests: QuestSummary[] };
  return body.quests ?? [];
}

export async function getQuest(id: string, page = 1, perPage?: number): Promise<QuestResponse> {
  const params = new URLSearchParams({ page: String(page) });
  if (perPage) params.set("perPage", String(perPage));
  const res = await fetch(`/api/quests/${id}?${params.toString()}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as QuestResponse;
}

export async function deleteQuest(id: string, login: string): Promise<void> {
  const res = await fetch(`/api/quests/${id}?login=${encodeURIComponent(login)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw await parseError(res);
}
