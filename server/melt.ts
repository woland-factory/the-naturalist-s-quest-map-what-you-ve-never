import type { AppConfig } from "./config.js";
import type { Cache } from "./cache.js";
import type { INatClient } from "./inat/client.js";
import { INatError, type ObservedTaxon } from "./inat/types.js";
import type { MeltedTarget, QuestRecord } from "./store/quests.js";

// The signature mechanic: a quest completes itself from the user's own
// confirmed uploads. When a user records a target research-grade, iNaturalist
// stops returning it from species_counts, so it silently drops off the open
// list. This module catches that transition and makes it visible: it reads the
// user's recent confirmed observations at the place, intersects them with the
// quest's persisted target set, and records the matches as melted targets with
// provenance. Kept pure-ish (a route calls it) so it is testable without HTTP.

export interface MeltDeps {
  client: INatClient;
  cache: Cache;
  config: AppConfig;
  now: () => number;
  logger?: { warn: (msg: string) => void };
}

export interface MeltResult {
  melted: MeltedTarget[]; // full, persisted set after this poll (newest meltedAt first not required here)
  newlyMelted: MeltedTarget[]; // subset first recorded in THIS poll (for the UI celebration)
}

export async function pollMelt(deps: MeltDeps, quest: QuestRecord): Promise<MeltResult> {
  const target = new Set(quest.targetTaxonIds);
  const already = new Set(quest.melted.map((m) => m.taxonId));

  // Nothing to match against yet (a freshly migrated v1 quest, or one whose
  // build never ran): skip the upstream call entirely.
  if (target.size === 0) {
    return { melted: quest.melted, newlyMelted: [] };
  }

  let observations: ObservedTaxon[];
  try {
    observations = await deps.client.recentConfirmedObservations({
      login: quest.loginDisplay,
      placeId: quest.placeId,
      perPage: deps.config.meltPollPerPage,
      // A lower bound shrinks the payload; correctness never depends on it.
      sinceIso: isoDate(quest.createdAt),
    });
  } catch (err) {
    // Best-effort: a melt-poll failure must never fail the open. Mirrors the
    // best-effort observer enrichment in buildTargets.
    if (err instanceof INatError) {
      deps.logger?.warn(`melt poll skipped: ${err.kind}`);
      return { melted: quest.melted, newlyMelted: [] };
    }
    throw err;
  }

  const newlyMelted: MeltedTarget[] = [];
  const meltedAt = deps.now();
  for (const o of observations) {
    if (!target.has(o.taxonId) || already.has(o.taxonId)) continue;
    already.add(o.taxonId); // a duplicate obs of the same taxon melts it once
    newlyMelted.push({
      taxonId: o.taxonId,
      scientificName: o.scientificName,
      commonName: o.commonName,
      photoUrl: o.photoUrl,
      observationId: o.observationId,
      observationUrl: o.observationUrl,
      observedOn: o.observedOn,
      meltedAt,
    });
  }

  // Append-only: existing entries are never rewritten, so meltedAt is stable
  // and a target never un-melts.
  return { melted: [...quest.melted, ...newlyMelted], newlyMelted };
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
