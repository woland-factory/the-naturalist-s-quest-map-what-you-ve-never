import { useState } from "react";
import { monthLabel } from "../months.js";
import type { QuestSummary } from "../types.js";

interface Props {
  quests: QuestSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onStart: () => void;
}

export function MyQuestsScreen({ quests, loading, onOpen, onDelete, onStart }: Props) {
  return (
    <main className="screen my-quests" aria-labelledby="quests-heading">
      <header className="quests-head">
        <h1 id="quests-heading">Your quests</h1>
        <p className="subline">Open one to see this month's targets on the map.</p>
      </header>

      {loading ? (
        <QuestsSkeleton />
      ) : quests.length === 0 ? (
        <EmptyState onStart={onStart} />
      ) : (
        <>
          <ul className="quest-list">
            {quests.map((q) => (
              <QuestCard key={q.id} quest={q} onOpen={onOpen} onDelete={onDelete} />
            ))}
          </ul>
          <button type="button" className="btn-primary block" onClick={onStart}>
            Start a quest
          </button>
        </>
      )}
    </main>
  );
}

function QuestCard({
  quest,
  onOpen,
  onDelete,
}: {
  quest: QuestSummary;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="quest-card">
      <div className="quest-card-main">
        <h2 className="quest-place">{quest.placeName}</h2>
        <p className="quest-meta">
          {monthLabel(quest.seasonMonth)} · {quest.targetCount} {quest.targetCount === 1 ? "target" : "targets"}
          {quest.meltedCount > 0 ? ` · ${quest.meltedCount} found` : ""}
        </p>
      </div>
      {confirming ? (
        <div className="quest-confirm" role="group" aria-label="Remove this quest?">
          <span className="quest-confirm-q">Remove this quest?</span>
          <div className="quest-confirm-actions">
            <button type="button" className="btn-danger" onClick={() => onDelete(quest.id)}>
              Remove
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="quest-card-actions">
          <button type="button" className="btn-primary" onClick={() => onOpen(quest.id)}>
            Open
          </button>
          <button
            type="button"
            className="btn-text danger"
            aria-label={`Remove the ${quest.placeName} quest`}
            onClick={() => setConfirming(true)}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <section className="empty-state" role="status">
      <h2 className="empty-title">Start your first quest</h2>
      <p className="empty-line">Pick a place and see the species you have never seen that others find there this month.</p>
      <button type="button" className="btn-primary" onClick={onStart}>
        Start a quest
      </button>
    </section>
  );
}

function QuestsSkeleton() {
  return (
    <ul className="quest-list" aria-busy="true" aria-label="Loading your quests">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="quest-card skeleton" aria-hidden="true">
          <div className="quest-card-main">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}
