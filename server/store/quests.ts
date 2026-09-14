import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BBox } from "../inat/types.js";

// The persistence layer, kept deliberately small like the Cache interface.
// A quest is durable across process restarts: the file-backed store loads
// the whole file into memory once, indexes it by normalized login, and
// rewrites the file atomically on every mutation. Data volume is tiny
// (capped per user), so a full rewrite per mutation is correct and simple,
// and every read stays an in-memory indexed lookup with no hot-path query.

// One target the user has already photographed and the community confirmed,
// so it has crossed itself off the quest. Persisted with provenance so the
// completion survives restarts and is shown in the product's own voice.
export interface MeltedTarget {
  taxonId: number; // intersection key; also idempotency key
  scientificName: string;
  commonName: string; // preferred_common_name || scientificName
  photoUrl: string | null; // the user's own observation photo when present, else null
  observationId: number; // iNat observation id
  observationUrl: string; // https://www.inaturalist.org/observations/<id>
  observedOn: string | null; // ISO date (YYYY-MM-DD) the obs was made; may be null
  meltedAt: number; // Date.now() when first recorded as melted (server time)
}

export interface QuestRecord {
  id: string; // crypto.randomUUID()
  loginLower: string; // normalization/index key
  loginDisplay: string; // original casing as entered
  inatUserId: number; // from the validated profile (public)
  placeId: number;
  placeName: string; // display name
  placeBbox: BBox | null; // for map framing
  taxonRootId: number | null; // always null in this EPIC ("all life")
  createdAt: number; // Date.now()
  lastRefreshedAt: number;
  lastSeasonMonth: number; // month used at last build (1..12)
  lastTargetCount: number; // capped count from last build, for the list
  lastTotalAvailable: number; // iNat total_results, for "N of many"
  targetTaxonIds: number[]; // snapshot of open-target taxon ids from the most
  // recent successful build; the "is this a target of this quest?" set the
  // melt poll intersects.
  melted: MeltedTarget[]; // persisted melted targets; append-only by taxonId.
  lastMeltPolledAt: number; // Date.now() of the last melt poll (0 if never).
}

export interface QuestStore {
  create(rec: QuestRecord): QuestRecord;
  listByLogin(loginLower: string): QuestRecord[]; // newest first
  get(id: string): QuestRecord | undefined;
  delete(id: string, loginLower: string): boolean; // only if login matches
  countByLogin(loginLower: string): number;
  update(id: string, patch: Partial<QuestRecord>): QuestRecord | undefined;
}

const CURRENT_VERSION = 2;

interface FileShape {
  version: number;
  quests: QuestRecord[];
}

// Default the melt fields on a record that predates them (a v1 file). A v1
// quest self-heals: it melts nothing until its first successful build
// re-populates targetTaxonIds, and no existing data is lost.
function backfillMelt(rec: QuestRecord): QuestRecord {
  return {
    ...rec,
    targetTaxonIds: Array.isArray(rec.targetTaxonIds) ? rec.targetTaxonIds : [],
    melted: Array.isArray(rec.melted) ? rec.melted : [],
    lastMeltPolledAt: typeof rec.lastMeltPolledAt === "number" ? rec.lastMeltPolledAt : 0,
  };
}

// Forward-only loader: branch on version from day one so later schema
// changes add a case here and never edit an applied migration.
function loadQuests(raw: string): QuestRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const shape = parsed as Partial<FileShape>;
  const quests = Array.isArray(shape.quests) ? shape.quests : [];
  if (shape.version === 2) {
    // Already the current shape; read as-is (fields are present).
    return quests;
  }
  if (shape.version === 1) {
    // v1 records lack the melt fields. Backfill them; the next persist
    // rewrites the file as version 2.
    return quests.map(backfillMelt);
  }
  // Unknown/absent version: start empty rather than trust an unrecognized
  // layout. A real future migration adds its own version branch above.
  return quests.map(backfillMelt);
}

// The in-memory engine shared by both implementations. `persist` is called
// after every mutation; the memory store makes it a no-op.
function engine(seed: QuestRecord[], persist: (all: QuestRecord[]) => void): QuestStore {
  const byId = new Map<string, QuestRecord>();
  const byLogin = new Map<string, Set<string>>();

  function index(rec: QuestRecord): void {
    byId.set(rec.id, rec);
    let set = byLogin.get(rec.loginLower);
    if (!set) {
      set = new Set();
      byLogin.set(rec.loginLower, set);
    }
    set.add(rec.id);
  }

  for (const rec of seed) index(rec);

  function all(): QuestRecord[] {
    return [...byId.values()];
  }

  return {
    create(rec: QuestRecord): QuestRecord {
      index(rec);
      persist(all());
      return rec;
    },
    listByLogin(loginLower: string): QuestRecord[] {
      const set = byLogin.get(loginLower);
      if (!set) return [];
      return [...set]
        .map((id) => byId.get(id))
        .filter((r): r is QuestRecord => r !== undefined)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    get(id: string): QuestRecord | undefined {
      return byId.get(id);
    },
    delete(id: string, loginLower: string): boolean {
      const rec = byId.get(id);
      if (!rec || rec.loginLower !== loginLower) return false;
      byId.delete(id);
      byLogin.get(loginLower)?.delete(id);
      persist(all());
      return true;
    },
    countByLogin(loginLower: string): number {
      return byLogin.get(loginLower)?.size ?? 0;
    },
    update(id: string, patch: Partial<QuestRecord>): QuestRecord | undefined {
      const rec = byId.get(id);
      if (!rec) return undefined;
      const next = { ...rec, ...patch, id: rec.id, loginLower: rec.loginLower };
      byId.set(id, next);
      persist(all());
      return next;
    },
  };
}

export function createMemoryQuestStore(seed: QuestRecord[] = []): QuestStore {
  return engine(seed, () => {});
}

export function createFileQuestStore(filePath: string): QuestStore {
  mkdirSync(dirname(filePath), { recursive: true });
  const seed = existsSync(filePath) ? loadQuests(readFileSync(filePath, "utf8")) : [];

  function persist(all: QuestRecord[]): void {
    const data: FileShape = { version: CURRENT_VERSION, quests: all };
    const tmp = `${filePath}.tmp`;
    // Write to a temp file in the same directory, then rename: on the same
    // filesystem rename is atomic, so a reader never sees a half-written file.
    writeFileSync(tmp, JSON.stringify(data), "utf8");
    renameSync(tmp, filePath);
  }

  return engine(seed, persist);
}
