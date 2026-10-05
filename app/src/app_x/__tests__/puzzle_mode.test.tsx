import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ConnectionBar from "../components/connection_bar";
import ConnectionEntityCard from "../components/connection_entity_card";
import ConnectionResults from "../components/connection_results";
import PuzzleEntityCard from "../components/puzzle_entity_card";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import { makeFilmRecord } from "../generators/cinenerdle2/__tests__/factories";
import { createConnectionEntityFromMovieRecord } from "../generators/cinenerdle2/connection_graph";

const fastBreak = createConnectionEntityFromMovieRecord(makeFilmRecord({ title: "Fast Break", year: "1979", tmdbId: 100 }));
const matrix = createConnectionEntityFromMovieRecord(makeFilmRecord({ title: "The Matrix", year: "1999", tmdbId: 603 }));
const otherFilm = createConnectionEntityFromMovieRecord(makeFilmRecord({ title: "Heat", year: "1995", tmdbId: 949 }));
const fishburne: ConnectionEntity = {
  key: "person:2975", kind: "person", name: "Laurence Fishburne", year: "", tmdbId: 2975,
  label: "Laurence Fishburne", connectionCount: 10, hasCachedTmdbSource: true,
};
const otherPerson: ConnectionEntity = { ...fishburne, key: "person:other", name: "Other Person", tmdbId: 9 };

function renderResult(submitted: ConnectionEntity, path: ConnectionEntity[], isPuzzleMode = true) {
  return renderToStaticMarkup(<ConnectionResults
    appendConnectionPathToTree={vi.fn()}
    navigateToConnectionEntity={vi.fn()}
    openConnectionEntityInNewTab={vi.fn()}
    spawnAlternativeConnectionRow={vi.fn()}
    isPuzzleMode={isPuzzleMode}
    connectionSession={{
      id: "guess", left: submitted, right: fastBreak,
      rows: [{ id: "route", parentRowId: null, sourceExclusion: null, excludedNodeKeys: [],
        excludedEdgeKeys: [], childDisallowedNodeKeys: [], childDisallowedEdgeKeys: [], status: "found", path }],
    }}
  />);
}

describe("puzzle row colors", () => {
  it.each([
    ["green", matrix, [matrix, fishburne, fastBreak]],
    ["green", matrix, [matrix, otherPerson, fastBreak]],
    ["green", { ...matrix, name: "Localized title", year: "" }, [matrix, otherPerson, fastBreak]],
    ["green", { ...matrix, name: "  THE MATRIX  ", tmdbId: null }, [matrix, otherPerson, fastBreak]],
    ["gold", otherFilm, [otherFilm, fishburne, fastBreak]],
    ["red", otherFilm, [otherFilm, fishburne, matrix, otherPerson, fastBreak]],
    ["red", otherFilm, [otherFilm, fishburne, matrix]],
    ["red", { ...matrix, name: "The Matrix Reloaded", year: "2003", tmdbId: 604 }, [matrix, otherPerson, fastBreak]],
    ["red", { ...matrix, year: "2021", tmdbId: null }, [matrix, otherPerson, fastBreak]],
    ["red", { ...matrix, kind: "person", tmdbId: 603 }, [matrix, otherPerson, fastBreak]],
  ] as const)("uses %s for submitted identity and actual final adjacency", (color, submitted, path) => {
    const html = renderResult(submitted, [...path]);
    expect(html).toContain(`bacon-connection-row-puzzle-${color}`);
    for (const otherColor of ["green", "gold", "red"].filter((value) => value !== color)) {
      expect(html).not.toContain(`bacon-connection-row-puzzle-${otherColor}`);
    }
  });

  it.each(["searching", "not_found", "timeout"] as const)("keeps Matrix guesses green when %s", (status) => {
    const html = renderToStaticMarkup(<ConnectionResults
      appendConnectionPathToTree={vi.fn()} navigateToConnectionEntity={vi.fn()}
      openConnectionEntityInNewTab={vi.fn()} spawnAlternativeConnectionRow={vi.fn()} isPuzzleMode
      connectionSession={{ id: "guess", left: matrix, right: fastBreak, rows: [{
        id: "row", parentRowId: null, sourceExclusion: null, excludedNodeKeys: [], excludedEdgeKeys: [],
        childDisallowedNodeKeys: [], childDisallowedEdgeKeys: [], status, path: [],
      }] }}
    />);
    expect(html.match(/bacon-connection-row-puzzle-green/g)).toHaveLength(2);
    expect(html).not.toContain("bacon-connection-row-puzzle-red");
  });

  it("does not make an ordinary guess green when The Matrix occurs inside its route", () => {
    expect(renderResult(otherFilm, [otherFilm, otherPerson, matrix, fishburne, fastBreak]))
      .toContain("bacon-connection-row-puzzle-gold");
  });
});

describe("puzzle interaction boundaries", () => {
  it("renders only accessible edge exclusion buttons in result rows", () => {
    const html = renderResult(matrix, [matrix, fishburne, fastBreak]);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html.match(/aria-label="Exclude connection between/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<a\b|tabindex=|role="button"|bacon-connection-node-clickable/);
    expect(html).not.toContain("cinenerdle-card-extra");
    expect(html).toContain("cinenerdle-card-footer");
    expect(html).toContain("Popularity");
  });

  it("keeps normal result cards, node exclusion, and metadata controls interactive", () => {
    const html = renderResult(matrix, [matrix, fishburne, fastBreak], false);
    expect(html).toContain("bacon-connection-node-clickable");
    expect(html).toContain("Toggle attrs for");
    expect(html).toContain("cinenerdle-card-title");
    expect(html).not.toContain("bacon-connection-row-puzzle");
    expect((html.match(/<button\b/g) ?? []).length).toBeGreaterThan(2);
  });

  it("ignores supplied card handlers in puzzle mode, including metadata and image actions", () => {
    const html = renderToStaticMarkup(<ConnectionEntityCard
      entity={{ ...matrix, imageUrl: "https://example.com/poster.jpg" }}
      isPuzzleMode onCardClick={vi.fn()} onNameClick={vi.fn()}
    />);
    expect(html).toContain("<img");
    expect(html).not.toMatch(/<button|<a\b|tabindex=|role="button"/);
  });

  it("shows connection roles and popularity without making their metadata interactive", () => {
    const html = renderToStaticMarkup(<ConnectionEntityCard
      entity={{ ...fishburne, popularity: 42,
        associationCreditLines: [{ subtitle: "Actor", subtitleDetail: "Morpheus" }] }}
      previousEntity={matrix} isPuzzleMode
    />);
    expect(html).toContain("Actor");
    expect(html).toContain("Morpheus");
    expect(html).toContain("Popularity 42");
    expect(html).toContain("cinenerdle-card-footer");
    expect(html).not.toMatch(/<button|<a\b|tabindex=|role="button"/);
  });

  it("renders the root poster without controls or hidden metadata", () => {
    const html = renderToStaticMarkup(<PuzzleEntityCard name="Fast Break" imageUrl="/poster.jpg" hideCopy />);
    expect(html).toContain("<img");
    expect(html).not.toMatch(/<button|<a\b|tabindex=|role="button"|cinenerdle-card-copy/);
  });

  it("keeps suggestions available while hiding connection badges and connected styling", () => {
    const html = renderToStaticMarkup(<ConnectionBar
      connectionQuery="Matrix" connectionSuggestions={[{
        ...matrix, kind: "movie", popularity: 30, sortScore: 30, label: "The Matrix (1999)", isConnectedToYoungestSelection: true,
        connectionOrderToYoungestSelection: 1,
      }]}
      highestGenerationSelectedLabel="Fast Break (1979)" isPuzzleMode
      isConnectionInputDisabled={false} isSearchablePersistencePending={false}
      onConnectionQueryChange={vi.fn()} onInputKeyDown={vi.fn()} onSubmit={vi.fn()}
      onSuggestionClick={vi.fn()} onSuggestionHover={vi.fn()}
      selectedPathTooltipEntries={[]} selectedSuggestionIndex={0}
    />);
    expect(html).toContain("bacon-connection-option-label");
    expect(html).not.toMatch(/bacon-connection-option-badge|bacon-connection-option-connected|tabindex=/);
  });
});
