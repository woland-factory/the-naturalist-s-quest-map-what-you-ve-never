import { useState, type ReactNode } from "react";
import { Seasonality } from "./Seasonality.js";
import type { Target, TargetsResponse } from "../types.js";

// The ranked list, shared by any screen that shows targets. A row can be
// selectable: tapping it picks that species for the map above the list.
// The top-ranked open targets additionally carry the week-of-year
// seasonality indicator once the quest's batch arrives.

export function TargetList({
  data,
  page,
  onPageChange,
  selectedTaxonId,
  onSelect,
  seasonality,
  seasonalityLoading,
  seasonalityTopN,
  nowMs,
}: {
  data: TargetsResponse;
  page: number;
  onPageChange: (page: number) => void;
  selectedTaxonId?: number;
  onSelect?: (target: Target) => void;
  seasonality?: Map<number, number[] | null>;
  seasonalityLoading?: boolean;
  seasonalityTopN?: number;
  nowMs?: number;
}) {
  const totalPages = Math.max(1, Math.ceil(data.totalTargets / data.perPage));
  const start = (page - 1) * data.perPage + 1;
  const end = Math.min(page * data.perPage, data.totalTargets);

  return (
    <section aria-label="Your targets">
      <p className="showing">
        Showing {start} to {end} of {data.totalTargets} targets.
      </p>
      <ul className="target-list">
        {data.results.map((t, i) => {
          const rank = start + i;
          const topTarget = seasonality !== undefined && rank <= (seasonalityTopN ?? 0);
          return (
            <TargetCard
              key={t.taxonId}
              target={t}
              rank={rank}
              selected={t.taxonId === selectedTaxonId}
              onSelect={onSelect}
              seasonality={
                topTarget ? (
                  <Seasonality weeks={seasonality.get(t.taxonId)} nowMs={nowMs ?? 0} loading={seasonalityLoading} />
                ) : null
              }
            />
          );
        })}
      </ul>
      {totalPages > 1 && (
        <nav className="pager" aria-label="Pagination">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </button>
          <span className="pager-count" aria-live="polite">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

function TargetCard({
  target,
  rank,
  selected,
  onSelect,
  seasonality,
}: {
  target: Target;
  rank: number;
  selected: boolean;
  onSelect?: (target: Target) => void;
  seasonality?: ReactNode;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = target.photoUrl && !photoFailed;
  const thumb = showPhoto ? (
    <img
      className="thumb"
      src={target.photoUrl ?? undefined}
      alt={target.commonName}
      loading="lazy"
      width={64}
      height={64}
      onError={() => setPhotoFailed(true)}
    />
  ) : (
    <div className="thumb thumb-empty" aria-hidden="true">
      {target.commonName.slice(0, 1)}
    </div>
  );

  const body = (
    <>
      <span className="rank" aria-hidden="true">
        {rank}
      </span>
      {thumb}
      <div className="target-body">
        <p className="common-name">{target.commonName}</p>
        <p className="sci-name">{target.scientificName}</p>
        <p className="signal">
          {target.obsCount.toLocaleString()} sightings
          {target.distinctObservers !== null ? ` by ${target.distinctObservers.toLocaleString()} people` : ""}
        </p>
        {seasonality}
      </div>
    </>
  );

  if (onSelect) {
    return (
      <li>
        <button
          type="button"
          className={selected ? "target-card selectable selected" : "target-card selectable"}
          aria-pressed={selected}
          onClick={() => onSelect(target)}
        >
          {body}
        </button>
      </li>
    );
  }

  return <li className="target-card">{body}</li>;
}

export function LoadingState({ slow, onBack }: { slow: boolean; onBack?: () => void }) {
  return (
    <section aria-busy="true" aria-label="Loading your targets">
      {slow && (
        <div className="cold-status" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Checking iNaturalist for your targets.</span>
          {onBack && (
            <button type="button" className="btn-text" onClick={onBack}>
              Back
            </button>
          )}
        </div>
      )}
      <ul className="target-list">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="target-card skeleton" aria-hidden="true">
            <div className="thumb skeleton-box" />
            <div className="target-body">
              <div className="skeleton-line wide" />
              <div className="skeleton-line" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Notice({
  tone,
  title,
  actionLabel,
  onAction,
}: {
  tone: "warn" | "calm";
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className={`notice ${tone}`} role="status">
      <p className="notice-title">{title}</p>
      <button type="button" className="btn-primary" onClick={onAction}>
        {actionLabel}
      </button>
    </section>
  );
}
