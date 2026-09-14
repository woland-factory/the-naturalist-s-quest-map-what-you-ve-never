import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileQuestStore, createMemoryQuestStore, type QuestRecord } from "../server/store/quests.js";

function record(overrides: Partial<QuestRecord> = {}): QuestRecord {
  const ts = 1_700_000_000_000;
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    loginLower: "kueda",
    loginDisplay: "Kueda",
    inatUserId: 1,
    placeId: 14,
    placeName: "California",
    placeBbox: { swLat: 32.5, swLng: -124.5, neLat: 42, neLng: -114 },
    taxonRootId: null,
    createdAt: ts,
    lastRefreshedAt: ts,
    lastSeasonMonth: 9,
    lastTargetCount: 30,
    lastTotalAvailable: 4210,
    ...overrides,
  };
}

describe("createMemoryQuestStore", () => {
  it("lists newest first and counts per login", () => {
    const store = createMemoryQuestStore();
    store.create(record({ id: "a1111111-1111-4111-8111-111111111111", createdAt: 100 }));
    store.create(record({ id: "b1111111-1111-4111-8111-111111111111", createdAt: 300 }));
    store.create(record({ id: "c1111111-1111-4111-8111-111111111111", createdAt: 200 }));

    const list = store.listByLogin("kueda");
    expect(list.map((r) => r.id)).toEqual([
      "b1111111-1111-4111-8111-111111111111",
      "c1111111-1111-4111-8111-111111111111",
      "a1111111-1111-4111-8111-111111111111",
    ]);
    expect(store.countByLogin("kueda")).toBe(3);
  });

  it("looks up login case-insensitively", () => {
    const store = createMemoryQuestStore();
    store.create(record({ loginLower: "kueda", loginDisplay: "KuEdA" }));
    expect(store.countByLogin("kueda")).toBe(1);
    expect(store.listByLogin("kueda")).toHaveLength(1);
  });

  it("deletes only when the login matches", () => {
    const store = createMemoryQuestStore();
    store.create(record({ id: "d1111111-1111-4111-8111-111111111111" }));
    expect(store.delete("d1111111-1111-4111-8111-111111111111", "someoneelse")).toBe(false);
    expect(store.countByLogin("kueda")).toBe(1);
    expect(store.delete("d1111111-1111-4111-8111-111111111111", "kueda")).toBe(true);
    expect(store.countByLogin("kueda")).toBe(0);
  });
});

describe("createFileQuestStore", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "quest-store-"));
    file = join(dir, "quests.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("survives a process restart: a new store over the same file sees the quests", () => {
    const first = createFileQuestStore(file);
    first.create(record({ id: "e1111111-1111-4111-8111-111111111111" }));
    first.create(record({ id: "f1111111-1111-4111-8111-111111111111", createdAt: 200 }));

    // A brand-new instance, as if the process had restarted.
    const second = createFileQuestStore(file);
    expect(second.countByLogin("kueda")).toBe(2);
    expect(second.get("e1111111-1111-4111-8111-111111111111")?.placeName).toBe("California");
  });

  it("creates the data directory when it does not exist yet", () => {
    const nested = join(dir, "deeper", "quests.json");
    const store = createFileQuestStore(nested);
    store.create(record());
    const reopened = createFileQuestStore(nested);
    expect(reopened.countByLogin("kueda")).toBe(1);
  });

  it("starts empty when the file is missing", () => {
    const store = createFileQuestStore(file);
    expect(store.listByLogin("kueda")).toEqual([]);
  });
});
