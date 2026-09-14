import { useRef, useState } from "react";
import { PlacePicker } from "./PlacePicker.js";
import type { Place } from "../types.js";

export interface QuestInput {
  login: string;
  place: Place;
}

interface Props {
  initialLogin?: string;
  initialPlace?: Place | null;
  busy?: boolean;
  error?: string | null;
  onSubmit: (input: QuestInput) => void;
  onCancel?: () => void;
}

const LOGIN_RE = /^[A-Za-z0-9._-]{1,50}$/;

export function StartScreen({ initialLogin, initialPlace, busy, error, onSubmit, onCancel }: Props) {
  const [login, setLogin] = useState(initialLogin ?? "");
  const [place, setPlace] = useState<Place | null>(initialPlace ?? null);
  const [errors, setErrors] = useState<{ login?: string; place?: string }>({});
  const loginRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!LOGIN_RE.test(login.trim())) next.login = "Enter a valid iNaturalist username.";
    if (!place) next.place = "Pick a place.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (next.login) loginRef.current?.focus();
      return;
    }
    onSubmit({ login: login.trim(), place: place as Place });
  }

  return (
    <main className="screen start" aria-labelledby="start-heading">
      <div className="start-inner">
        {onCancel && (
          <button type="button" className="btn-back" onClick={onCancel}>
            Back
          </button>
        )}
        <h1 id="start-heading">Map what you've never seen</h1>
        <p className="subline">Paste your iNaturalist name and pick a place. See what to hunt for this month.</p>

        <form className="quest-form" onSubmit={submit} noValidate>
          <div className="field-group">
            <label htmlFor="login-input">iNaturalist username</label>
            <input
              id="login-input"
              ref={loginRef}
              className={errors.login ? "field invalid" : "field"}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. kueda"
              value={login}
              aria-describedby={errors.login ? "login-error" : undefined}
              aria-invalid={errors.login ? true : undefined}
              onChange={(e) => setLogin(e.target.value)}
            />
            {errors.login && (
              <p className="field-error" id="login-error" role="alert">
                {errors.login}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="place-input">Place</label>
            <PlacePicker
              value={place}
              onSelect={setPlace}
              invalid={!!errors.place}
              describedBy={errors.place ? "place-error" : undefined}
            />
            {errors.place && (
              <p className="field-error" id="place-error" role="alert">
                {errors.place}
              </p>
            )}
          </div>

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Starting your quest" : "Start quest"}
          </button>
        </form>
      </div>
    </main>
  );
}
