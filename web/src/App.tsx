import { useCallback, useEffect, useRef, useState } from "react";
import { StartScreen, type QuestInput } from "./components/StartScreen.js";
import { MyQuestsScreen } from "./components/MyQuestsScreen.js";
import { QuestScreen, type QuestStatus } from "./components/QuestScreen.js";
import { createQuest, deleteQuest, getQuest, getSeasonality, listQuests, getConfig, ApiError } from "./api.js";
import { resolveQuestStatus } from "./questStatus.js";
import type { AppConfig, QuestResponse, QuestSummary } from "./types.js";

type View = "loading" | "my-quests" | "start" | "quest";

const LOGIN_KEY = "nqm.login";
const DEFAULT_TILE_BASE = "https://api.inaturalist.org/v1";

export function App() {
  const [view, setView] = useState<View>("loading");
  const [appConfig, setAppConfig] = useState<AppConfig>({});
  const [activeLogin, setActiveLogin] = useState<string | null>(null);

  const [quests, setQuests] = useState<QuestSummary[]>([]);
  const [questsLoading, setQuestsLoading] = useState(true);

  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [questData, setQuestData] = useState<QuestResponse | null>(null);
  const [questStatus, setQuestStatus] = useState<QuestStatus>("loading");
  const [questPage, setQuestPage] = useState(1);
  const [slow, setSlow] = useState(false);
  const [seasonality, setSeasonality] = useState<Map<number, number[] | null>>(new Map());
  const [seasonalityLoading, setSeasonalityLoading] = useState(false);
  const openIdRef = useRef<string | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  const tileBase = appConfig.inatTileBase || DEFAULT_TILE_BASE;

  const refreshQuests = useCallback(async (login: string) => {
    try {
      const list = await listQuests(login);
      setQuests(list);
      return list;
    } catch {
      return [] as QuestSummary[];
    }
  }, []);

  // Boot: read the active username, then land on My quests if it has quests,
  // otherwise on Start. The quests themselves are never stored client-side;
  // only the active username is remembered so a returning visitor sees their
  // server-persisted quests. A fresh visitor on a demo build gets the seeded
  // login so the differentiator shows with no input.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await getConfig();
      if (cancelled) return;
      setAppConfig(cfg);
      injectUmami(cfg);
      const stored = safeGet(LOGIN_KEY);
      const login = stored || cfg.demo?.login || null;
      if (!login) {
        setQuestsLoading(false);
        setView("start");
        return;
      }
      setActiveLogin(login);
      const list = await listQuests(login).catch(() => [] as QuestSummary[]);
      if (cancelled) return;
      setQuests(list);
      setQuestsLoading(false);
      setView(list.length > 0 ? "my-quests" : "start");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One seasonality fetch per opened quest, fired after the quest loads so
  // the indicator fills in without ever blocking the list. Keyed on the
  // quest id: page changes keep the batch, a different quest resets it.
  const openedQuestId = questData?.quest.id;
  useEffect(() => {
    if (!openedQuestId) return;
    let cancelled = false;
    setSeasonality(new Map());
    setSeasonalityLoading(true);
    void getSeasonality(openedQuestId).then((map) => {
      if (cancelled) return;
      setSeasonality(map);
      setSeasonalityLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [openedQuestId]);

  const runQuest = useCallback(
    async (id: string, page: number) => {
      const seq = ++reqSeq.current;
      openIdRef.current = id;
      setView("quest");
      setQuestStatus("loading");
      setSlow(false);
      if (slowTimer.current) clearTimeout(slowTimer.current);
      slowTimer.current = setTimeout(() => {
        if (reqSeq.current === seq) setSlow(true);
      }, 1500);

      try {
        const res = await getQuest(id, page);
        if (reqSeq.current !== seq) return;
        setQuestData(res);
        setQuestPage(res.page);
        setQuestStatus(resolveQuestStatus(res));
      } catch (err) {
        if (reqSeq.current !== seq) return;
        if (err instanceof ApiError && err.kind === "not_found") {
          setView("my-quests");
          if (activeLogin) void refreshQuests(activeLogin);
        } else if (err instanceof ApiError && err.kind === "upstream") {
          setQuestStatus("error_upstream");
        } else {
          setQuestStatus("error_generic");
        }
      } finally {
        if (reqSeq.current === seq && slowTimer.current) {
          clearTimeout(slowTimer.current);
          setSlow(false);
        }
      }
    },
    [activeLogin, refreshQuests],
  );

  async function onStartSubmit(input: QuestInput) {
    setStartBusy(true);
    setStartError(null);
    try {
      const res = await createQuest({ login: input.login, placeId: input.place.id, placeName: input.place.displayName });
      safeSet(LOGIN_KEY, input.login);
      setActiveLogin(input.login);
      openIdRef.current = res.quest.id;
      reqSeq.current++;
      setQuestData(res);
      setQuestPage(res.page);
      setQuestStatus(resolveQuestStatus(res));
      setView("quest");
      void refreshQuests(input.login);
    } catch (err) {
      setStartError(startErrorMessage(err));
    } finally {
      setStartBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!activeLogin) return;
    setQuests((prev) => prev.filter((q) => q.id !== id));
    try {
      await deleteQuest(id, activeLogin);
    } catch {
      // Re-sync from the server if the delete did not take.
      void refreshQuests(activeLogin);
    }
  }

  function onQuestBack() {
    reqSeq.current++;
    if (slowTimer.current) clearTimeout(slowTimer.current);
    setView("my-quests");
    if (activeLogin) void refreshQuests(activeLogin);
  }

  function onQuestPageChange(next: number) {
    if (!openIdRef.current) return;
    void runQuest(openIdRef.current, next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onQuestRetry() {
    if (openIdRef.current) void runQuest(openIdRef.current, questPage);
  }

  function goStart() {
    setStartError(null);
    setView("start");
  }

  if (view === "loading") {
    return (
      <main className="screen" aria-busy="true" aria-label="Loading">
        <div className="boot-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Loading your quests.</span>
        </div>
      </main>
    );
  }

  if (view === "start") {
    return (
      <StartScreen
        initialLogin={activeLogin ?? appConfig.demo?.login}
        busy={startBusy}
        error={startError}
        onSubmit={onStartSubmit}
        onCancel={quests.length > 0 ? () => setView("my-quests") : undefined}
      />
    );
  }

  if (view === "my-quests") {
    return (
      <MyQuestsScreen
        quests={quests}
        loading={questsLoading}
        onOpen={(id) => void runQuest(id, 1)}
        onDelete={onDelete}
        onStart={goStart}
      />
    );
  }

  return (
    <QuestScreen
      status={questStatus}
      slow={slow}
      data={questData}
      tileBase={tileBase}
      placeName={questData?.quest.placeName ?? ""}
      seasonMonth={questData?.quest.seasonMonth ?? 1}
      page={questPage}
      seasonality={seasonality}
      seasonalityLoading={seasonalityLoading}
      seasonalityTopN={appConfig.seasonalityTopN ?? 12}
      nowMs={Date.now()}
      onBack={onQuestBack}
      onRetry={onQuestRetry}
      onPageChange={onQuestPageChange}
    />
  );
}

function startErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "unknown_user") return "Check the username and try again.";
    if (err.kind === "quest_limit") return "You've saved the most quests we keep. Open one you have, or remove one to add another.";
    if (err.kind === "upstream") return "iNaturalist is slow right now. Try again in a moment.";
  }
  return "Try again in a moment.";
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the session still works, it just won't be remembered */
  }
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
