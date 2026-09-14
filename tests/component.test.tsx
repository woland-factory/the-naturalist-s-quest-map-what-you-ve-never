import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MeltedList } from "../web/src/components/MeltedList.js";
import { MyQuestsScreen } from "../web/src/components/MyQuestsScreen.js";
import { resolveQuestStatus } from "../web/src/questStatus.js";
import type { MeltedTarget, QuestResponse, QuestSummary } from "../web/src/types.js";

function melted(over: Partial<MeltedTarget> = {}): MeltedTarget {
  return {
    taxonId: 4981,
    scientificName: "Nycticorax nycticorax",
    commonName: "Black-crowned Night Heron",
    photoUrl: "https://x/720002534/medium.jpg",
    observationId: 392852733,
    observationUrl: "https://www.inaturalist.org/observations/392852733",
    observedOn: "2026-09-03",
    meltedAt: 1_700_000_000_000,
    ...over,
  };
}

function summary(over: Partial<QuestSummary> = {}): QuestSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    login: "kueda",
    placeId: 14,
    placeName: "California",
    placeBbox: null,
    taxonRootId: null,
    seasonMonth: 9,
    targetCount: 30,
    totalAvailable: 4210,
    createdAt: 1,
    lastRefreshedAt: 1,
    openCount: 30,
    meltedCount: 0,
    ...over,
  };
}

describe("MeltedList", () => {
  it("renders a Found card with photo, names, provenance line and observation link", () => {
    const html = renderToStaticMarkup(<MeltedList melted={[melted()]} newlyMelted={[]} />);
    expect(html).toContain(">Found</h2>");
    expect(html).toContain("Black-crowned Night Heron");
    expect(html).toContain("Nycticorax nycticorax");
    expect(html).toContain("Confirmed by your photo on September 3, 2026");
    expect(html).toContain('href="https://www.inaturalist.org/observations/392852733"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('alt="Your photo of Black-crowned Night Heron"');
  });

  it("tags a newly-melted taxon with Just found", () => {
    const html = renderToStaticMarkup(<MeltedList melted={[melted()]} newlyMelted={[4981]} />);
    expect(html).toContain("Just found");
    const notFresh = renderToStaticMarkup(<MeltedList melted={[melted()]} newlyMelted={[]} />);
    expect(notFresh).not.toContain("Just found");
  });

  it("falls back to the melted date when observedOn is null", () => {
    const html = renderToStaticMarkup(
      <MeltedList melted={[melted({ observedOn: null, meltedAt: Date.UTC(2026, 8, 3) })]} newlyMelted={[]} />,
    );
    expect(html).toContain("Confirmed by your photo on September 3, 2026");
  });

  it("renders nothing when there are no melted targets", () => {
    expect(renderToStaticMarkup(<MeltedList melted={[]} newlyMelted={[]} />)).toBe("");
  });
});

describe("MyQuestsScreen", () => {
  const noop = () => {};

  it("shows the found count in the meta line when meltedCount > 0", () => {
    const html = renderToStaticMarkup(
      <MyQuestsScreen quests={[summary({ meltedCount: 2 })]} loading={false} onOpen={noop} onDelete={noop} onStart={noop} />,
    );
    expect(html).toContain("2 found");
  });

  it("omits the found count when meltedCount is 0", () => {
    const html = renderToStaticMarkup(
      <MyQuestsScreen quests={[summary({ meltedCount: 0 })]} loading={false} onOpen={noop} onDelete={noop} onStart={noop} />,
    );
    expect(html).not.toContain("found");
  });
});

describe("resolveQuestStatus", () => {
  const base = (over: Partial<QuestResponse>): QuestResponse =>
    ({
      quest: summary(),
      page: 1,
      perPage: 20,
      totalTargets: 0,
      totalAvailable: 0,
      rankBasis: "frequency+observers",
      note: "note",
      results: [],
      melted: [],
      newlyMelted: [],
      ...over,
    }) as QuestResponse;

  it("is empty only when there are no open targets and nothing found", () => {
    expect(resolveQuestStatus(base({ totalTargets: 0, melted: [] }))).toBe("empty");
  });

  it("is loaded when zero open targets but something is found", () => {
    expect(resolveQuestStatus(base({ totalTargets: 0, melted: [melted()] }))).toBe("loaded");
  });

  it("is loaded when there are open targets", () => {
    expect(resolveQuestStatus(base({ totalTargets: 5, melted: [] }))).toBe("loaded");
  });
});
