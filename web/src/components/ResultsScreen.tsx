import { monthLabel } from "../months.js";
import type { Target, TargetsResponse } from "../types.js";

export type ResultsStatus = "loading" | "loaded" | "empty" | "error_user" | "error_upstream" | "error_generic";

interface Props {
  status: ResultsStatus;
  slow: boolean;
  data: TargetsResponse | null;
  placeName: string;
  month: number;
  page: number;
  onBack: () => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

export function ResultsScreen(props: Props) {
  const { status, slow, data, placeName, month, page, onBack, onRetry, onPageChange } = props;

  return (
    <main className="screen results" aria-labelledby="results-heading">
      <header className="results-head">
        <button type="button" className="btn-back" onClick={onBack}>
          Back
        </button>
        <div className="results-title">
          <h1 id="results-heading">
            {placeName} in {monthLabel(month)}
          </h1>
          <p className="rank-note">
            Ranked by how often people record each species here this month, and by how many different people find it.
            It's a guide, not a guarantee.
          </p>
        </div>
      </header>

      {status === "loading" && <LoadingState slow={slow} onBack={onBack} />}
      {status === "error_user" && (
        <Notice tone="warn" title="Check the username and try again." actionLabel="Back" onAction={onBack} />
      )}
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
          title="You've already recorded every species reported here this month."
          actionLabel="Try another place or month"
          onAction={onBack}
        />
      )}
      {status === "loaded" && data && <TargetList data={data} page={page} onPageChange={onPageChange} />}
    </main>
  );
}

function LoadingState({ slow, onBack }: { slow: boolean; onBack: () => void }) {
  return (
    <section aria-busy="true" aria-label="Loading your targets">
      {slow && (
        <div className="cold-status" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Checking iNaturalist for your targets.</span>
          <button type="button" className="btn-text" onClick={onBack}>
            Back
          </button>
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

function TargetList({
  data,
  page,
  onPageChange,
}: {
  data: TargetsResponse;
  page: number;
  onPageChange: (page: number) => void;
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
        {data.results.map((t, i) => (
          <TargetCard key={t.taxonId} target={t} rank={start + i} />
        ))}
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

function TargetCard({ target, rank }: { target: Target; rank: number }) {
  return (
    <li className="target-card">
      <span className="rank" aria-hidden="true">
        {rank}
      </span>
      {target.photoUrl ? (
        <img className="thumb" src={target.photoUrl} alt={target.commonName} loading="lazy" width={64} height={64} />
      ) : (
        <div className="thumb thumb-empty" aria-hidden="true">
          {target.commonName.slice(0, 1)}
        </div>
      )}
      <div className="target-body">
        <p className="common-name">{target.commonName}</p>
        <p className="sci-name">{target.scientificName}</p>
        <p className="signal">
          {target.obsCount.toLocaleString()} sightings
          {target.distinctObservers !== null ? ` by ${target.distinctObservers.toLocaleString()} people` : ""}
        </p>
      </div>
    </li>
  );
}

function Notice({
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
