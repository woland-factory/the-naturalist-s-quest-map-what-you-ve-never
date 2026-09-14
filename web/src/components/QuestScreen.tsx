import { useEffect, useState } from "react";
import { monthLabel } from "../months.js";
import { QuestMap } from "./QuestMap.js";
import { TargetList, LoadingState, Notice } from "./TargetList.js";
import type { QuestResponse, Target } from "../types.js";

export type QuestStatus = "loading" | "loaded" | "empty" | "error_upstream" | "error_generic";

interface Props {
  status: QuestStatus;
  slow: boolean;
  data: QuestResponse | null;
  tileBase: string;
  placeName: string;
  seasonMonth: number;
  page: number;
  onBack: () => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

export function QuestScreen(props: Props) {
  const { status, slow, data, tileBase, placeName, seasonMonth, page, onBack, onRetry, onPageChange } = props;
  const [selected, setSelected] = useState<Target | null>(null);
  const questId = data?.quest.id;

  // Reset the map selection when a different quest opens.
  useEffect(() => {
    setSelected(null);
  }, [questId]);

  // Default the map to the top-ranked target once results arrive.
  useEffect(() => {
    if (data && data.results.length > 0) {
      setSelected((prev) => prev ?? data.results[0]);
    }
  }, [data]);

  return (
    <main className="screen results" aria-labelledby="quest-heading">
      <header className="results-head">
        <button type="button" className="btn-back" onClick={onBack}>
          Back
        </button>
        <div className="results-title">
          <h1 id="quest-heading">
            {placeName} in {monthLabel(seasonMonth)}
          </h1>
          <p className="rank-note">
            Ranked by how often people record each species here this month, and by how many different people find it.
            It's a guide, not a guarantee.
          </p>
        </div>
      </header>

      {status === "loading" && <LoadingState slow={slow} onBack={onBack} />}
      {status === "error_upstream" && (
        <Notice
          tone="warn"
          title="iNaturalist is slow right now. Try again in a moment."
          actionLabel="Try again"
          onAction={onRetry}
        />
      )}
      {status === "error_generic" && (
        <Notice tone="warn" title="Try again in a moment." actionLabel="Try again" onAction={onRetry} />
      )}
      {status === "empty" && (
        <Notice
          tone="calm"
          title="You've recorded every species reported here this month. Try another place."
          actionLabel="Back to my quests"
          onAction={onBack}
        />
      )}
      {status === "loaded" && data && (
        <>
          {selected && (
            <section className="map-section" aria-label="Where to find this species">
              <h2 className="map-heading">Where to find {selected.commonName}</h2>
              <QuestMap
                tileBase={tileBase}
                taxonId={selected.taxonId}
                placeId={data.quest.placeId}
                month={data.quest.seasonMonth}
                commonName={selected.commonName}
                bbox={data.quest.placeBbox}
              />
              <p className="map-hint">Tap a species below to see where to find it.</p>
            </section>
          )}
          <TargetList
            data={data}
            page={page}
            onPageChange={onPageChange}
            selectedTaxonId={selected?.taxonId}
            onSelect={setSelected}
          />
        </>
      )}
    </main>
  );
}
