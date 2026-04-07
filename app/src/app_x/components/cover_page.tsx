/* eslint-disable react-refresh/only-export-components */
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "../generators/cinenerdle2";
import { createPersonRootCard } from "../generators/cinenerdle2/cards";
import { getCinenerdleFooterTooltipContent } from "../generators/cinenerdle2/entity_card/footer_tooltip";
import { getPersonRecordById } from "../generators/cinenerdle2/indexed_db";
import type { PersonRecord, TmdbPersonCredit } from "../generators/cinenerdle2/types";
import { formatMoviePathLabel, getValidTmdbEntityId } from "../generators/cinenerdle2/utils";
import { createCardViewModel } from "../generators/cinenerdle2/view_model";
import {
  getBestPersonTmdbIdsForMovieIds,
  resolveMovieCoverRecordsForLabels,
  type ResolvedMovieCoverRecord,
} from "../movie_person_cover";

export const COVER_INPUT_DEBOUNCE_MS = 300;

export type CoverPageLookupResult = {
  cards: RenderableCinenerdleEntityCard[];
  personTmdbIds: number[];
  resolvedMovies: ResolvedMovieCoverRecord[];
};

type CoverPageViewProps = {
  cards: RenderableCinenerdleEntityCard[];
  inputValue: string;
  isLoading: boolean;
  message: string;
  messageTone: "error" | "muted";
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

function getMatchedCreditsForPerson(
  personTmdbId: number,
  resolvedMovie: ResolvedMovieCoverRecord,
): TmdbPersonCredit[] {
  const creditsResponse = resolvedMovie.movieRecord.rawTmdbMovieCreditsResponse;
  const matchedCredits = [...(creditsResponse.cast ?? []), ...(creditsResponse.crew ?? [])]
    .filter((credit) => getValidTmdbEntityId(credit.id) === personTmdbId);
  const seenCredits = new Set<string>();

  return matchedCredits.filter((credit) => {
    const detail = credit.creditType === "cast"
      ? credit.character?.trim() ?? ""
      : credit.job?.trim() || credit.department?.trim() || "";
    const fingerprint = [
      credit.creditType ?? "",
      detail,
      typeof credit.order === "number" ? String(credit.order) : "",
    ].join(":");

    if (seenCredits.has(fingerprint)) {
      return false;
    }

    seenCredits.add(fingerprint);
    return true;
  });
}

export function formatCoverCreditDetail(matchedCredits: TmdbPersonCredit[]): string {
  const detailParts = Array.from(
    new Set(matchedCredits.flatMap((credit) => {
      const detail = credit.creditType === "cast"
        ? credit.character?.trim() ?? ""
        : credit.job?.trim() || credit.department?.trim() || "";
      return detail ? [detail] : [];
    })),
  );

  return detailParts.join(" | ");
}

export function createCoverPersonCardViewModel(
  personRecord: PersonRecord,
  resolvedMovies: ResolvedMovieCoverRecord[],
): RenderableCinenerdleEntityCard {
  const personTmdbId = getValidTmdbEntityId(personRecord.tmdbId ?? personRecord.id);
  const basePersonCard = createPersonRootCard(personRecord, personRecord.name);
  const creditLines = personTmdbId === null
    ? []
    : resolvedMovies.flatMap((resolvedMovie) => {
      const matchedCredits = getMatchedCreditsForPerson(personTmdbId, resolvedMovie);
      if (matchedCredits.length === 0) {
        return [];
      }

      return [{
        subtitle: formatMoviePathLabel(
          resolvedMovie.movieRecord.title,
          resolvedMovie.movieRecord.year,
        ),
        subtitleDetail: formatCoverCreditDetail(matchedCredits),
      }];
    });

  return createCardViewModel(
    {
      ...basePersonCard,
      creditLines,
      subtitle: creditLines[0]?.subtitle ?? "",
      subtitleDetail: creditLines[0]?.subtitleDetail ?? "",
    },
    {
      isSelected: false,
    },
  ) as RenderableCinenerdleEntityCard;
}

export async function resolveCoverPageLookupResult(
  movieLabels: string[],
): Promise<CoverPageLookupResult> {
  const resolvedMovies = await resolveMovieCoverRecordsForLabels(movieLabels);
  const personTmdbIds = await getBestPersonTmdbIdsForMovieIds(
    resolvedMovies.map((resolvedMovie) => resolvedMovie.tmdbId),
  );
  const personRecords = await Promise.all(
    personTmdbIds.map((personTmdbId) => getPersonRecordById(personTmdbId)),
  );
  const missingPersonTmdbIds = personTmdbIds.filter((_personTmdbId, index) =>
    !personRecords[index]);

  if (missingPersonTmdbIds.length > 0) {
    throw new Error(`Unable to load person TMDB ids: ${missingPersonTmdbIds.join(", ")}`);
  }

  return {
    cards: personRecords.map((personRecord) =>
      createCoverPersonCardViewModel(personRecord!, resolvedMovies)),
    personTmdbIds,
    resolvedMovies,
  };
}

export function CoverPageView({
  cards,
  inputValue,
  isLoading,
  message,
  messageTone,
  onInputChange,
}: CoverPageViewProps) {
  return (
    <section className="bacon-cover-page">
      <div className="bacon-cover-panel">
        <div className="bacon-cover-panel-header">
          <h2 className="bacon-cover-panel-title">Movie Cover</h2>
          <p className="bacon-cover-panel-copy">
            Paste one movie per line using `Title (Year)`.
          </p>
        </div>
        <textarea
          aria-label="Movie cover input"
          className="bacon-cover-textarea"
          onChange={onInputChange}
          placeholder={"Oppenheimer (2023)\nTitanic (1997)\nDune (2021)"}
          spellCheck={false}
          value={inputValue}
        />
        {message ? (
          <p className={`bacon-cover-status bacon-cover-status-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>
            {message}
          </p>
        ) : null}
        {isLoading ? (
          <p className="bacon-cover-status bacon-cover-status-muted" role="status">
            Finding the smallest person cover...
          </p>
        ) : null}
      </div>

      {cards.length > 0 ? (
        <div className="bacon-cover-card-grid">
          {cards.map((card) => (
            <div className="bacon-cover-card-shell" key={card.key}>
              <CinenerdleEntityCard
                card={card}
                footerTooltip={getCinenerdleFooterTooltipContent(card, {
                  includeActionHint: false,
                })}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function CoverPage() {
  const [cards, setCards] = useState<RenderableCinenerdleEntityCard[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("Paste movies to build a person cover.");
  const [messageTone, setMessageTone] = useState<"error" | "muted">("muted");
  const requestVersionRef = useRef(0);

  const runLookup = useEffectEvent(async (nextInputValue: string, requestVersion: number) => {
    try {
      const lookupResult = await resolveCoverPageLookupResult(nextInputValue.split("\n"));
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      setCards(lookupResult.cards);
      setMessage(
        lookupResult.cards.length > 0
          ? `Found ${lookupResult.cards.length} people covering ${lookupResult.resolvedMovies.length} movies.`
          : "No people found.",
      );
      setMessageTone("muted");
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      setCards([]);
      setMessage(error instanceof Error ? error.message : "Unable to build movie cover.");
      setMessageTone("error");
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setIsLoading(false);
      }
    }
  });

  useEffect(() => {
    const nextRequestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = nextRequestVersion;

    if (!inputValue.trim()) {
      setCards([]);
      setIsLoading(false);
      setMessage("Paste movies to build a person cover.");
      setMessageTone("muted");
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (requestVersionRef.current !== nextRequestVersion) {
        return;
      }

      setIsLoading(true);
      setMessage("");
      setMessageTone("muted");
      void runLookup(inputValue, nextRequestVersion);
    }, COVER_INPUT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [inputValue]);

  return (
    <CoverPageView
      cards={cards}
      inputValue={inputValue}
      isLoading={isLoading}
      message={message}
      messageTone={messageTone}
      onInputChange={(event) => {
        const nextValue = event.target.value;
        startTransition(() => {
          setInputValue(nextValue);
        });
      }}
    />
  );
}
