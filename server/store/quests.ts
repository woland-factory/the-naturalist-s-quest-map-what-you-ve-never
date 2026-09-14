import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BBox } from "../inat/types.js";

// The persistence layer, kept deliberately small like the Cache interface.
// A quest is durable across process restarts: the file-backed store loads
// the whole file into memory once, indexes it by normalized login, and
// rewrites the file atomically on every mutation. Data volume is tiny
// (capped per user), so a full rewrite per mutation is correct and simple,
// and every read stays an in-memory indexed lookup with no hot-path query.

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
}

export interface QuestStore {
  create(rec: QuestRecord): QuestRecord;
  listByLogin(loginLower: string): QuestRecord[]; // newest first
  get(id: string): QuestRecord | undefined;
  delete(id: string, loginLower: string): boolean; // only if login matches
  countByLogin(loginLower: string): number;
  update(id: string, patch: Partial<QuestRecord>): QuestRecord | undefined;
}

interface FileShape {
  version: number;
  quests: QuestRecord[];
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
  if (shape.version === 1) {
    return Array.isArray(shape.quests) ? shape.quests : [];
  }
  // Unknown/absent version: start empty rather than trust an unrecognized
  // layout. A real future migration adds its own version branch above.
  return Array.isArray(shape.quests) ? shape.quests : [];
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
    const data: FileShape = { version: 1, quests: all };
    const tmp = `${filePath}.tmp`;
    // Write to a temp file in the same directory, then rename: on the same
    // filesystem rename is atomic, so a reader never sees a half-written file.
    writeFileSync(tmp, JSON.stringify(data), "utf8");
    renameSync(tmp, filePath);
  }

  return engine(seed, persist);
}
