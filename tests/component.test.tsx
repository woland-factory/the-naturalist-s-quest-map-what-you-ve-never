import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MeltedList } from "../web/src/components/MeltedList.js";
import { MyQuestsScreen } from "../web/src/components/MyQuestsScreen.js";
import { Seasonality } from "../web/src/components/Seasonality.js";
import { TargetList } from "../web/src/components/TargetList.js";
import { resolveQuestStatus } from "../web/src/questStatus.js";
import { monthOfWeek, weekOfYear } from "../web/src/months.js";
import type { MeltedTarget, QuestResponse, QuestSummary, Target, TargetsResponse } from "../web/src/types.js";

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

describe("week helpers", () => {
  it("weekOfYear maps UTC dates into 1..53", () => {
    expect(weekOfYear(Date.UTC(2026, 0, 1))).toBe(1);
    expect(weekOfYear(Date.UTC(2026, 5, 15))).toBe(24);
    expect(weekOfYear(Date.UTC(2026, 11, 31))).toBe(53);
  });

  it("monthOfWeek maps a week to the month of its representative date", () => {
    expect(monthOfWeek(1)).toBe(1);
    expect(monthOfWeek(28)).toBe(7);
    expect(monthOfWeek(53)).toBe(12);
  });
});

describe("Seasonality", () => {
  // Peak at week 28 (July), a shoulder at week 29, a trickle in week 1.
  const weeks = Array.from({ length: 53 }, () => 0);
  weeks[27] = 100;
  weeks[28] = 60;
  weeks[0] = 10;
  const inWeek29 = Date.UTC(2026, 6, 16); // count 60: at least half the peak
  const inWeek1 = Date.UTC(2026, 0, 3); // count 10: quiet

  it("renders 53 bar cells with the current week highlighted and a Peak caption", () => {
    const html = renderToStaticMarkup(<Seasonality weeks={weeks} nowMs={inWeek29} />);
    expect((html.match(/class="season-bar"/g) ?? []).length).toBe(52);
    expect((html.match(/class="season-bar now"/g) ?? []).length).toBe(1);
    expect(html).toContain("Peak July");
  });

  it("describes a good week vs a quiet week in the aria-label", () => {
    const good = renderToStaticMarkup(<Seasonality weeks={weeks} nowMs={inWeek29} />);
    expect(good).toContain('aria-label="Seen most often in July here. This is a good week to look."');
    const quiet = renderToStaticMarkup(<Seasonality weeks={weeks} nowMs={inWeek1} />);
    expect(quiet).toContain('aria-label="Seen most often in July here. Quieter this week."');
  });

  it("holds layout with a skeleton while the batch is loading", () => {
    const html = renderToStaticMarkup(<Seasonality nowMs={inWeek29} loading />);
    expect(html).toContain("seasonality-skeleton");
    expect(html).toContain("aria-hidden");
  });

  it("renders nothing when weeks is null or all zeros", () => {
    expect(renderToStaticMarkup(<Seasonality weeks={null} nowMs={inWeek29} />)).toBe("");
    expect(renderToStaticMarkup(<Seasonality weeks={Array.from({ length: 53 }, () => 0)} nowMs={inWeek29} />)).toBe("");
  });
});

describe("TargetList seasonality gating", () => {
  function targetFixture(taxonId: number): Target {
    return {
      taxonId,
      scientificName: `Genus s${taxonId}`,
      commonName: `Creature ${taxonId}`,
      photoUrl: null,
      obsCount: 100,
      distinctObservers: null,
      rankScore: 0.5,
    };
  }

  const weeks = Array.from({ length: 53 }, () => 1);

  function listFixture(): TargetsResponse {
    return {
      page: 1,
      perPage: 5,
      totalTargets: 5,
      totalAvailable: 5,
      rankBasis: "frequency+observers",
      note: "note",
      results: [1, 2, 3, 4, 5].map(targetFixture),
    };
  }

  it("shows the indicator only on open targets ranked within seasonalityTopN", () => {
    const seasonality = new Map<number, number[] | null>([1, 2, 3, 4, 5].map((id) => [id, weeks]));
    const html = renderToStaticMarkup(
      <TargetList
        data={listFixture()}
        page={1}
        onPageChange={() => {}}
        seasonality={seasonality}
        seasonalityLoading={false}
        seasonalityTopN={2}
        nowMs={Date.UTC(2026, 6, 16)}
      />,
    );
    expect((html.match(/class="seasonality"/g) ?? []).length).toBe(2);
  });

  it("keeps the list fully usable when the seasonality fetch came back empty", () => {
    const html = renderToStaticMarkup(
      <TargetList
        data={listFixture()}
        page={1}
        onPageChange={() => {}}
        seasonality={new Map()}
        seasonalityLoading={false}
        seasonalityTopN={2}
        nowMs={Date.UTC(2026, 6, 16)}
      />,
    );
    expect((html.match(/class="seasonality"/g) ?? []).length).toBe(0);
    expect((html.match(/class="target-card/g) ?? []).length).toBe(5);
    expect(html).toContain("Creature 1");
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
