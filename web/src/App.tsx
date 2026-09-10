import { useCallback, useEffect, useRef, useState } from "react";
import { StartScreen, type QuestInput } from "./components/StartScreen.js";
import { ResultsScreen, type ResultsStatus } from "./components/ResultsScreen.js";
import { fetchTargets, getConfig, ApiError } from "./api.js";
import type { AppConfig, Place, TargetsResponse } from "./types.js";

type View = "start" | "results";

export function App() {
  const [view, setView] = useState<View>("start");
  const [status, setStatus] = useState<ResultsStatus>("loading");
  const [slow, setSlow] = useState(false);
  const [data, setData] = useState<TargetsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState<QuestInput | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>({});
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  const run = useCallback(async (input: QuestInput, nextPage: number) => {
    const seq = ++reqSeq.current;
    setView("results");
    setStatus("loading");
    setSlow(false);
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => {
      if (reqSeq.current === seq) setSlow(true);
    }, 1500);

    try {
      const res = await fetchTargets({
        login: input.login,
        placeId: input.place.id,
        month: input.month,
        page: nextPage,
      });
      if (reqSeq.current !== seq) return;
      setData(res);
      setPage(res.page);
      setStatus(res.totalTargets === 0 ? "empty" : "loaded");
    } catch (err) {
      if (reqSeq.current !== seq) return;
      if (err instanceof ApiError && err.kind === "unknown_user") setStatus("error_user");
      else if (err instanceof ApiError && err.kind === "upstream") setStatus("error_upstream");
      else setStatus("error_generic");
    } finally {
      if (reqSeq.current === seq && slowTimer.current) {
        clearTimeout(slowTimer.current);
        setSlow(false);
      }
    }
  }, []);

  function onSubmit(input: QuestInput) {
    setQuery(input);
    setPage(1);
    void run(input, 1);
  }

  function onPageChange(next: number) {
    if (!query) return;
    setPage(next);
    void run(query, next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onBack() {
    reqSeq.current++;
    if (slowTimer.current) clearTimeout(slowTimer.current);
    setView("start");
  }

  function onRetry() {
    if (query) void run(query, page);
  }

  // Load public config, wire Umami, and on a first visit with a demo
  // descriptor, pre-fill and run the demo quest so a fresh visitor sees a
  // populated list immediately.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await getConfig();
      if (cancelled) return;
      setAppConfig(cfg);
      injectUmami(cfg);
      if (cfg.demo) {
        const place: Place = {
          id: cfg.demo.placeId,
          name: cfg.demo.placeName,
          displayName: cfg.demo.placeName,
        };
        void run({ login: cfg.demo.login, place, month: cfg.demo.month }, 1);
        setQuery({ login: cfg.demo.login, place, month: cfg.demo.month });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  const demoPlace = appConfig.demo
    ? { id: appConfig.demo.placeId, name: appConfig.demo.placeName, displayName: appConfig.demo.placeName }
    : null;

  return view === "start" ? (
    <StartScreen
      initialLogin={query?.login ?? appConfig.demo?.login}
      initialPlace={query?.place ?? demoPlace}
      initialMonth={query?.month ?? appConfig.demo?.month}
      onSubmit={onSubmit}
    />
  ) : (
    <ResultsScreen
      status={status}
      slow={slow}
      data={data}
      placeName={query?.place.displayName ?? ""}
      month={query?.month ?? 1}
      page={page}
      onBack={onBack}
      onRetry={onRetry}
      onPageChange={onPageChange}
    />
  );
}

function injectUmami(cfg: AppConfig) {
  if (!cfg.umamiWebsiteId || !cfg.umamiUrl) return;
  if (document.querySelector("script[data-website-id]")) return;
  const s = document.createElement("script");
  s.async = true;
  s.defer = true;
  s.src = cfg.umamiUrl;
  s.setAttribute("data-website-id", cfg.umamiWebsiteId);
  document.head.appendChild(s);
}
