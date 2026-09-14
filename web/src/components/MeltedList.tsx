import { useState } from "react";
import { formatIsoDate, formatTimestamp } from "../months.js";
import type { MeltedTarget } from "../types.js";

// The Found surface: targets that have crossed themselves off the quest from
// the user's own confirmed photos. Each card shows the photo that completed
// it, the name, and the provenance line linking to the real observation.

export function MeltedList({ melted, newlyMelted }: { melted: MeltedTarget[]; newlyMelted: number[] }) {
  if (melted.length === 0) return null;
  const fresh = new Set(newlyMelted);
  return (
    <section className="found-section" aria-label="Found">
      <h2 className="found-heading">Found</h2>
      <ul className="target-list">
        {melted.map((m) => (
          <MeltedCard key={m.taxonId} melted={m} justFound={fresh.has(m.taxonId)} />
        ))}
      </ul>
    </section>
  );
}

function MeltedCard({ melted, justFound }: { melted: MeltedTarget; justFound: boolean }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = melted.photoUrl && !photoFailed;
  const when = melted.observedOn ? formatIsoDate(melted.observedOn) : formatTimestamp(melted.meltedAt);

  const thumb = showPhoto ? (
    <img
      className="thumb"
      src={melted.photoUrl ?? undefined}
      alt={`Your photo of ${melted.commonName}`}
      loading="lazy"
      width={64}
      height={64}
      onError={() => setPhotoFailed(true)}
    />
  ) : (
    <div className="thumb thumb-empty" aria-hidden="true">
      {melted.commonName.slice(0, 1)}
    </div>
  );

  return (
    <li className="target-card found-card">
      <a
        className="found-link"
        href={melted.observationUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="found-check" aria-hidden="true">
          ✓
        </span>
        {thumb}
        <div className="target-body">
          <p className="common-name">
            {melted.commonName}
            {justFound && <span className="just-found-tag">Just found</span>}
          </p>
          <p className="sci-name">{melted.scientificName}</p>
          <p className="signal">Confirmed by your photo on {when}</p>
        </div>
      </a>
    </li>
  );
}
