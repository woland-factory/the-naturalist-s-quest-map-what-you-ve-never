import type { AppConfig, Place, TargetsResponse } from "./types.js";

// Every network error is normalized to a typed kind so the UI can pick the
// right designed state instead of guessing from a raw exception.
export type ApiErrorKind = "unknown_user" | "upstream" | "generic";

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

export async function fetchTargets(input: {
  login: string;
  placeId: number;
  month: number;
  page?: number;
  perPage?: number;
}): Promise<TargetsResponse> {
  const res = await fetch("/api/targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TargetsResponse;
}
