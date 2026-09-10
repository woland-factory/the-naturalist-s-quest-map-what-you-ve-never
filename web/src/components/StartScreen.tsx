import { useRef, useState } from "react";
import { PlacePicker } from "./PlacePicker.js";
import { MONTHS } from "../months.js";
import type { Place } from "../types.js";

export interface QuestInput {
  login: string;
  place: Place;
  month: number;
}

interface Props {
  initialLogin?: string;
  initialPlace?: Place | null;
  initialMonth?: number;
  onSubmit: (input: QuestInput) => void;
}

const LOGIN_RE = /^[A-Za-z0-9._-]{1,50}$/;

export function StartScreen({ initialLogin, initialPlace, initialMonth, onSubmit }: Props) {
  const [login, setLogin] = useState(initialLogin ?? "");
  const [place, setPlace] = useState<Place | null>(initialPlace ?? null);
  const [month, setMonth] = useState<number | "">(initialMonth ?? "");
  const [errors, setErrors] = useState<{ login?: string; place?: string; month?: string }>({});
  const loginRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!LOGIN_RE.test(login.trim())) next.login = "Enter a valid iNaturalist username.";
    if (!place) next.place = "Pick a place.";
    if (month === "") next.month = "Pick a month.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (next.login) loginRef.current?.focus();
      return;
    }
    onSubmit({ login: login.trim(), place: place as Place, month: month as number });
  }

  return (
    <main className="screen start" aria-labelledby="start-heading">
      <div className="start-inner">
        <h1 id="start-heading">Map what you've never seen</h1>
        <p className="subline">Paste your iNaturalist name, pick a place and a month, and see what to hunt for.</p>

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

          <div className="field-group">
            <label htmlFor="month-input">Month</label>
            <select
              id="month-input"
              className={errors.month ? "field invalid" : "field"}
              value={month}
              aria-describedby={errors.month ? "month-error" : undefined}
              aria-invalid={errors.month ? true : undefined}
              onChange={(e) => setMonth(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Pick a month</option>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {errors.month && (
              <p className="field-error" id="month-error" role="alert">
                {errors.month}
              </p>
            )}
          </div>

          <button type="submit" className="btn-primary">
            Build my quest
          </button>
        </form>
      </div>
    </main>
  );
}
