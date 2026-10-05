import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ConnectionResults from "../components/connection_results";
import ConnectionEntityCard from "../components/connection_entity_card";
import { createConnectionEntityFromMovieRecord, createConnectionEntityFromPersonRecord, getConnectionEdgeKey } from "../generators/cinenerdle2/connection_graph";
import { makeFilmRecord, makePersonRecord } from "../generators/cinenerdle2/__tests__/factories";

// Inspect the rendered control callbacks without needing a browser or running scroll effects.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: () => undefined,
  useRef: () => ({ current: null }),
}));

function getElements(node: ReactNode): ReturnType<typeof collectElement>[] {
  if (Array.isArray(node)) return node.flatMap(getElements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [collectElement(node), ...getElements(node.props.children)];
}
function collectElement(element: ReturnType<typeof ConnectionResults>) {
  return element!;
}

function renderControls(isPuzzleMode: boolean, found = true) {
  const left = createConnectionEntityFromMovieRecord(makeFilmRecord());
  const middle = createConnectionEntityFromPersonRecord(makePersonRecord({ name: "Laurence Fishburne" }));
  const right = createConnectionEntityFromMovieRecord(makeFilmRecord({ title: "Fast Break", year: "1979" }));
  const spawnAlternativeConnectionRow = vi.fn();
  const appendConnectionPathToTree = vi.fn();
  const navigateToConnectionEntity = vi.fn();
  const openConnectionEntityInNewTab = vi.fn();
  const result = ConnectionResults({
    appendConnectionPathToTree, navigateToConnectionEntity, openConnectionEntityInNewTab,
    spawnAlternativeConnectionRow, isPuzzleMode,
    connectionSession: {
      id: "guess", left, right, rows: [{ id: "route", parentRowId: null, sourceExclusion: null,
        excludedNodeKeys: [], excludedEdgeKeys: [], childDisallowedNodeKeys: [], childDisallowedEdgeKeys: [],
        status: found ? "found" : "not_found", path: found ? [left, middle, right] : [] }],
    },
  });
  return { elements: getElements(result), left, middle, spawnAlternativeConnectionRow, appendConnectionPathToTree };
}

describe("puzzle control callbacks", () => {
  it.each([true, false])("omits card and name callbacks for puzzle results (found %s)", (found) => {
    const { elements } = renderControls(true, found);
    const cards = elements.filter((element) => element.type === ConnectionEntityCard);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.props.onCardClick).toBeUndefined();
      expect(card.props.onNameClick).toBeUndefined();
      expect(card.props.isPuzzleMode).toBe(true);
    }
  });

  it("keeps edge exclusion callbacks live in puzzle mode", () => {
    const { elements, left, middle, spawnAlternativeConnectionRow } = renderControls(true);
    const arrows = elements.filter((element) => element.type === "button");
    expect(arrows).toHaveLength(2);
    arrows[0].props.onClick();
    expect(spawnAlternativeConnectionRow).toHaveBeenCalledExactlyOnceWith("route", {
      kind: "edge", edgeKey: getConnectionEdgeKey(left.key, middle.key),
    });
  });

  it("preserves normal-mode node exclusions and name navigation", () => {
    const { elements, middle, spawnAlternativeConnectionRow, appendConnectionPathToTree } = renderControls(false);
    const cards = elements.filter((element) => element.type === ConnectionEntityCard);
    cards[1].props.onCardClick();
    expect(spawnAlternativeConnectionRow).toHaveBeenCalledExactlyOnceWith("route", {
      kind: "node", nodeKey: middle.key,
    });
    cards[1].props.onNameClick({ metaKey: false, ctrlKey: false, button: 0 });
    expect(appendConnectionPathToTree).toHaveBeenCalledTimes(1);
  });
});
