import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type MutableRefObject,
} from "react";
import { flushSync } from "react-dom";
import { isPerfLoggingEnabled, logPerf, logPerfSinceMark, markPerf } from "../perf";
import {
  applyGeneratorUpdate,
  getDataKey,
  isDisabledNode,
  resolveGeneratorTree,
} from "../generators/generator_runtime";
import "../styles/abstract_generator.css";
import {
  getGeneratorRowScrollCardIndex,
  getGeneratorRowScrollLeft,
  getUnselectedRowScrollCardIndex,
} from "./abstract_generator_row_scroll";
import { getFullyVisibleViewportScrollTop } from "./abstract_generator_scroll";
import {
  areGeneratorCardRowOrderMetadataEqual,
  getSortedGeneratorRowEntries,
} from "./abstract_generator_row_order";
import type {
  GeneratorCardRowOrderMetadata,
  GeneratorController,
  GeneratorNode,
  GeneratorState,
  GeneratorTree,
  GeneratorUpdate,
} from "../types/generator";

export type AbstractGeneratorTreeRefreshRequest<T, TMeta = undefined> = {
  requestKey: string;
  run: (state: GeneratorState<T, TMeta>) => Promise<GeneratorUpdate<T, TMeta> | null>;
};

export type AbstractGeneratorHandle = {
  alignTreeLikeRootBubble: () => void;
  revealGeneration: (
    generationIndex: number,
    options?: {
      alignRowHorizontally?: boolean;
    },
  ) => Promise<void>;
  scrollToCard: (
    generationIndex: number,
    cardIndex: number,
    options?: {
      alignment?: "center" | "start";
      behavior?: ScrollBehavior;
    },
  ) => void;
  selectCard: (generationIndex: number, cardIndex: number) => void;
};

export type AbstractGeneratorProps<T, TMeta = undefined, TEffect = never> =
  GeneratorController<T, TMeta, TEffect> & {
    debugLog?: ((event: string, details?: unknown) => void) | null;
    generatorHandleRef?: MutableRefObject<AbstractGeneratorHandle | null>;
    getRowPresentation?: (
      row: GeneratorNode<T>[],
      generationIndex: number,
    ) => {
      cardButtonClassName?: string;
      className?: string;
      hideBubble?: boolean;
      trackClassName?: string;
    };
    shouldAutoScrollMountedGeneration?: (info: {
      generationIndex: number;
      row: GeneratorNode<T>[];
      tree: GeneratorTree<T>;
    }) => boolean;
    onInitialTreePainted?: (tree: GeneratorTree<T>) => void;
    onTreeChange?: (tree: GeneratorTree<T>) => void;
    resetKey?: number | string;
    treeRefreshRequest?: AbstractGeneratorTreeRefreshRequest<T, TMeta> | null;
  };

type GeneratorRowRenderSample = {
  cardCount: number;
  elapsedMs: number;
  generationIndex: number;
  metadataCallbackCount: number;
  metadataChangedCount: number;
  metadataDeletedCount: number;
  metadataNoopCount: number;
  reorderedItemCount: number;
  reorderedItems: Array<{
    dataKey: string;
    itemLabel: string | null;
    nextIndex: number;
    previousIndex: number;
  }>;
  rowOrderChanged: boolean;
  phase: "mount" | "update";
  selectedAncestorCount: number;
};

type GeneratorRowOrderState = {
  metadataByDataKey: Map<string, GeneratorCardRowOrderMetadata>;
  seededMetadataByDataKey: Map<string, GeneratorCardRowOrderMetadata>;
  rowDataKeysSignature: string;
};

type GeneratorRowOrderTelemetry = {
  callbackCount: number;
  changedCount: number;
  deletedCount: number;
  noopCount: number;
};

type GeneratorRowOrderDebugEntry = {
  dataKey: string;
  itemLabel: string | null;
};

let nextGeneratorRowTelemetryId = 1;
const generatorRowTelemetryById = new Map<number, GeneratorRowOrderTelemetry>();
const MAX_REORDERED_ITEMS_TO_LOG = 32;

function getGeneratorRowOrderTelemetry(telemetryId: number): GeneratorRowOrderTelemetry {
  const existingTelemetry = generatorRowTelemetryById.get(telemetryId);
  if (existingTelemetry) {
    return existingTelemetry;
  }

  const nextTelemetry: GeneratorRowOrderTelemetry = {
    callbackCount: 0,
    changedCount: 0,
    deletedCount: 0,
    noopCount: 0,
  };
  generatorRowTelemetryById.set(telemetryId, nextTelemetry);
  return nextTelemetry;
}

function getSeededRowOrderMetadataByDataKey<T>(
  row: GeneratorNode<T>[],
): Map<string, GeneratorCardRowOrderMetadata> {
  return row.reduce<Map<string, GeneratorCardRowOrderMetadata>>((metadataByDataKey, node, index) => {
    if (!node.rowOrderMetadata) {
      return metadataByDataKey;
    }

    metadataByDataKey.set(getDataKey(node.data, index), node.rowOrderMetadata);
    return metadataByDataKey;
  }, new Map<string, GeneratorCardRowOrderMetadata>());
}

function areGeneratorRowOrderMetadataMapsEqual(
  left: Map<string, GeneratorCardRowOrderMetadata>,
  right: Map<string, GeneratorCardRowOrderMetadata>,
): boolean {
  if (left === right) {
    return true;
  }

  if (left.size !== right.size) {
    return false;
  }

  for (const [dataKey, leftMetadata] of left.entries()) {
    if (!areGeneratorCardRowOrderMetadataEqual(leftMetadata, right.get(dataKey))) {
      return false;
    }
  }

  return true;
}

function getGeneratorDebugItemLabel(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (typeof record.name === "string" && typeof record.year === "string" && record.year) {
    return `${record.name} (${record.year})`;
  }

  if (typeof record.name === "string" && record.name) {
    return record.name;
  }

  if (typeof record.label === "string" && record.label) {
    return record.label;
  }

  if (typeof record.key === "string" && record.key) {
    return record.key;
  }

  return null;
}

function getReorderedItems({
  nextEntries,
  previousEntries,
}: {
  nextEntries: GeneratorRowOrderDebugEntry[];
  previousEntries: GeneratorRowOrderDebugEntry[] | null;
}): Array<{
  dataKey: string;
  itemLabel: string | null;
  nextIndex: number;
  previousIndex: number;
}> {
  if (!previousEntries || previousEntries.length === 0) {
    return [];
  }

  const previousIndexByDataKey = new Map(
    previousEntries.map((entry, index) => [entry.dataKey, index] as const),
  );

  return nextEntries
    .map((entry, nextIndex) => ({
      dataKey: entry.dataKey,
      itemLabel: entry.itemLabel,
      nextIndex,
      previousIndex: previousIndexByDataKey.get(entry.dataKey) ?? -1,
    }))
    .filter((entry) => entry.previousIndex >= 0 && entry.previousIndex !== entry.nextIndex)
    .slice(0, MAX_REORDERED_ITEMS_TO_LOG);
}

type GenerationRenderWaitResult = {
  framesWaited: number;
  generationIndex: number;
  hasGeneration: boolean;
  hasRowElement: boolean;
  hasTargetCard: boolean;
  renderedOriginalCols: number[];
  rowLength: number;
  selectedIndex: number;
  targetCardIndex: number | null;
  targetDataKey: string | null;
};

function isGenerationRenderReady(result: GenerationRenderWaitResult): boolean {
  return result.hasGeneration && result.hasRowElement && result.hasTargetCard;
}

type GeneratorRowViewProps<T> = {
  cardButtonClassName: string;
  generationIndex: number;
  handleBubbleClickRef: MutableRefObject<((generationIndex: number) => void) | null>;
  handleCardSelect: (row: number, col: number) => void;
  hideBubble: boolean;
  immediateSelectedOriginalCol: number | null;
  onRowRendered: (sample: GeneratorRowRenderSample) => void;
  renderCard: GeneratorController<T>["renderCard"];
  reportRenderedRowOrder: (
    generationIndex: number,
    entries: Array<{
      dataKey: string;
      originalCol: number;
      selected: boolean;
    }>,
  ) => void;
  isViewportPriorityRow: boolean;
  row: GeneratorNode<T>[];
  rowClassName: string;
  selectedAncestorData: T[];
  selectedChildData: T | null;
  selectedDescendantData: T[];
  selectedParentData: T | null;
  setCardRef: (refKey: string, element: HTMLDivElement | null) => void;
  setRowRef: (generationIndex: number, element: HTMLDivElement | null) => void;
  trackClassName: string;
};

const SLOW_GENERATOR_COMMIT_THRESHOLD_MS = 24;
const SLOW_GENERATOR_DERIVATION_THRESHOLD_MS = 8;
const SLOW_GENERATOR_ROW_THRESHOLD_MS = 8;

function getGeneratorPerfNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function roundGeneratorPerfElapsedMs(value: number): number {
  return Number(value.toFixed(2));
}

function shallowReferenceArrayEqual<T>(left: T[], right: T[]): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

function getGeneratorTreeCardCount<T>(tree: GeneratorTree<T>): number {
  return tree.reduce((count, row) => count + row.length, 0);
}

function GeneratorRowViewInner<T>({
  cardButtonClassName,
  generationIndex,
  handleBubbleClickRef,
  handleCardSelect,
  hideBubble,
  immediateSelectedOriginalCol,
  onRowRendered,
  renderCard,
  reportRenderedRowOrder,
  isViewportPriorityRow,
  row,
  rowClassName,
  selectedAncestorData,
  selectedChildData,
  selectedDescendantData,
  selectedParentData,
  setCardRef,
  setRowRef,
  trackClassName,
}: GeneratorRowViewProps<T>) {
  const didMountRef = useRef(false);
  const previousSortedEntriesRef = useRef<GeneratorRowOrderDebugEntry[] | null>(null);
  const previousSortedOrderSignatureRef = useRef<string | null>(null);
  const rowOrderTelemetryId = useMemo(() => nextGeneratorRowTelemetryId++, []);
  const renderStartedAt = getGeneratorPerfNow();
  const rowDataKeysSignature = useMemo(
    () => row.map((node, index) => getDataKey(node.data, index)).join("|"),
    [row],
  );
  const seededRowOrderMetadataByDataKey = useMemo(
    () => getSeededRowOrderMetadataByDataKey(row),
    [row],
  );
  const [rowOrderState, setRowOrderState] = useState<GeneratorRowOrderState>(() => ({
    metadataByDataKey: seededRowOrderMetadataByDataKey,
    seededMetadataByDataKey: seededRowOrderMetadataByDataKey,
    rowDataKeysSignature,
  }));
  const hasSyncedSeededRowOrderState = useMemo(
    () => (
      rowOrderState.rowDataKeysSignature === rowDataKeysSignature &&
      areGeneratorRowOrderMetadataMapsEqual(
        rowOrderState.seededMetadataByDataKey,
        seededRowOrderMetadataByDataKey,
      )
    ),
    [rowDataKeysSignature, rowOrderState, seededRowOrderMetadataByDataKey],
  );

  const handleRowOrderMetadataChange = useCallback(
    (dataKey: string, metadata: GeneratorCardRowOrderMetadata | null) => {
      const rowOrderTelemetry = getGeneratorRowOrderTelemetry(rowOrderTelemetryId);
      rowOrderTelemetry.callbackCount += 1;
      setRowOrderState((currentState) => {
        const shouldUseCurrentState =
          currentState.rowDataKeysSignature === rowDataKeysSignature &&
          areGeneratorRowOrderMetadataMapsEqual(
            currentState.seededMetadataByDataKey,
            seededRowOrderMetadataByDataKey,
          );
        const currentMetadataByDataKey = shouldUseCurrentState
          ? currentState.metadataByDataKey
          : seededRowOrderMetadataByDataKey;
        const currentSeededMetadataByDataKey = shouldUseCurrentState
          ? currentState.seededMetadataByDataKey
          : seededRowOrderMetadataByDataKey;
        const currentMetadata = currentMetadataByDataKey.get(dataKey);

        if (metadata === null) {
          if (!currentMetadata) {
            rowOrderTelemetry.noopCount += 1;
            return shouldUseCurrentState
              ? currentState
              : {
                metadataByDataKey: currentMetadataByDataKey,
                seededMetadataByDataKey: currentSeededMetadataByDataKey,
                rowDataKeysSignature,
              };
          }

          const nextMetadataByDataKey = new Map(currentMetadataByDataKey);
          nextMetadataByDataKey.delete(dataKey);
          rowOrderTelemetry.changedCount += 1;
          rowOrderTelemetry.deletedCount += 1;
          return {
            metadataByDataKey: nextMetadataByDataKey,
            seededMetadataByDataKey: currentSeededMetadataByDataKey,
            rowDataKeysSignature,
          };
        }

        if (areGeneratorCardRowOrderMetadataEqual(currentMetadata, metadata)) {
          rowOrderTelemetry.noopCount += 1;
          return shouldUseCurrentState
            ? currentState
            : {
              metadataByDataKey: currentMetadataByDataKey,
              seededMetadataByDataKey: currentSeededMetadataByDataKey,
              rowDataKeysSignature,
            };
        }

        const nextMetadataByDataKey = new Map(currentMetadataByDataKey);
        nextMetadataByDataKey.set(dataKey, metadata);
        rowOrderTelemetry.changedCount += 1;
        return {
          metadataByDataKey: nextMetadataByDataKey,
          seededMetadataByDataKey: currentSeededMetadataByDataKey,
          rowDataKeysSignature,
        };
      });
    },
    [rowDataKeysSignature, rowOrderTelemetryId, seededRowOrderMetadataByDataKey],
  );
  useLayoutEffect(() => {
    if (hasSyncedSeededRowOrderState) {
      return;
    }

    setRowOrderState({
      metadataByDataKey: seededRowOrderMetadataByDataKey,
      seededMetadataByDataKey: seededRowOrderMetadataByDataKey,
      rowDataKeysSignature,
    });
  }, [
    hasSyncedSeededRowOrderState,
    rowDataKeysSignature,
    seededRowOrderMetadataByDataKey,
  ]);
  const sortedRowEntries = useMemo(
    () => getSortedGeneratorRowEntries(
      row,
      hasSyncedSeededRowOrderState
        ? rowOrderState.metadataByDataKey
        : seededRowOrderMetadataByDataKey,
      ),
    [
      hasSyncedSeededRowOrderState,
      row,
      rowOrderState.metadataByDataKey,
      seededRowOrderMetadataByDataKey,
    ],
  );
  const sortedOrderSignature = useMemo(
    () => sortedRowEntries.map(({ dataKey }) => dataKey).join("|"),
    [sortedRowEntries],
  );
  const sortedOrderDebugEntries = useMemo<GeneratorRowOrderDebugEntry[]>(
    () => sortedRowEntries.map(({ dataKey, node }) => ({
      dataKey,
      itemLabel: getGeneratorDebugItemLabel(node.data),
    })),
    [sortedRowEntries],
  );
  const rowOrderMetadataReporters = useMemo(
    () => row.reduce<Map<string, (metadata: GeneratorCardRowOrderMetadata | null) => void>>(
      (reporters, node, index) => {
        const dataKey = getDataKey(node.data, index);
        reporters.set(dataKey, (metadata) => {
          handleRowOrderMetadataChange(dataKey, metadata);
        });
        return reporters;
      },
      new Map<string, (metadata: GeneratorCardRowOrderMetadata | null) => void>(),
    ),
    [handleRowOrderMetadataChange, row],
  );

  const renderedCards = sortedRowEntries.map(({ dataKey, node, originalCol }) => {
    const refKey = `${generationIndex}:${dataKey}`;
    const isVisuallySelected =
      immediateSelectedOriginalCol === null
        ? node.selected
        : originalCol === immediateSelectedOriginalCol;
    const renderNode =
      isVisuallySelected === node.selected
        ? node
        : {
          ...node,
          selected: isVisuallySelected,
        };

    return (
      <div
        aria-disabled={isDisabledNode(node)}
        className={[
          "generator-card-button",
          isDisabledNode(node) ? "generator-card-button-disabled" : "",
          cardButtonClassName,
        ].filter(Boolean).join(" ")}
        key={refKey}
        onClick={() => handleCardSelect(generationIndex, originalCol)}
        ref={(element) => {
          setCardRef(refKey, element);
        }}
      >
        {renderCard({
          row: generationIndex,
          col: originalCol,
          isViewportPriorityRow,
          node: renderNode,
          selectedAncestorData,
          selectedChildData,
          selectedDescendantData,
          selectedParentData,
          reportRowOrderMetadata: rowOrderMetadataReporters.get(dataKey),
        })}
      </div>
    );
  });

  const renderElapsedMs = roundGeneratorPerfElapsedMs(getGeneratorPerfNow() - renderStartedAt);

  useLayoutEffect(() => {
    reportRenderedRowOrder(
      generationIndex,
      sortedRowEntries.map(({ dataKey, node, originalCol }) => ({
        dataKey,
        originalCol,
        selected: node.selected,
      })),
    );
  }, [generationIndex, reportRenderedRowOrder, sortedRowEntries]);

  useEffect(() => () => {
    generatorRowTelemetryById.delete(rowOrderTelemetryId);
  }, [rowOrderTelemetryId]);

  useLayoutEffect(() => {
    const rowOrderTelemetry = getGeneratorRowOrderTelemetry(rowOrderTelemetryId);
    const metadataCallbackCount = rowOrderTelemetry.callbackCount;
    const metadataChangedCount = rowOrderTelemetry.changedCount;
    const metadataDeletedCount = rowOrderTelemetry.deletedCount;
    const metadataNoopCount = rowOrderTelemetry.noopCount;
    const reorderedItems = getReorderedItems({
      nextEntries: sortedOrderDebugEntries,
      previousEntries: previousSortedEntriesRef.current,
    });
    const rowOrderChanged =
      previousSortedOrderSignatureRef.current !== null &&
      previousSortedOrderSignatureRef.current !== sortedOrderSignature;
    onRowRendered({
      cardCount: row.length,
      elapsedMs: renderElapsedMs,
      generationIndex,
      metadataCallbackCount,
      metadataChangedCount,
      metadataDeletedCount,
      metadataNoopCount,
      reorderedItemCount: reorderedItems.length,
      reorderedItems,
      rowOrderChanged,
      phase: didMountRef.current ? "update" : "mount",
      selectedAncestorCount: selectedAncestorData.length,
    });
    previousSortedEntriesRef.current = sortedOrderDebugEntries;
    previousSortedOrderSignatureRef.current = sortedOrderSignature;
    rowOrderTelemetry.callbackCount = 0;
    rowOrderTelemetry.changedCount = 0;
    rowOrderTelemetry.deletedCount = 0;
    rowOrderTelemetry.noopCount = 0;
    didMountRef.current = true;
  }, [
    generationIndex,
    onRowRendered,
    renderElapsedMs,
    rowOrderTelemetryId,
    row.length,
    selectedAncestorData.length,
    sortedOrderDebugEntries,
    sortedOrderSignature,
  ]);

  return (
    <div className={rowClassName}>
      {hideBubble ? null : (
        <button
          className="generator-row-bubble"
          onClick={() => handleBubbleClickRef.current?.(generationIndex)}
          type="button"
        >
          {`GEN ${generationIndex}`}
        </button>
      )}

      <div
        className={trackClassName}
        ref={(element) => {
          setRowRef(generationIndex, element);
        }}
      >
        {renderedCards}
      </div>
    </div>
  );
}

const MemoizedGeneratorRowView = memo(
  GeneratorRowViewInner,
  // Descendant-only selection changes are reconciled by later tree updates, so
  // unchanged ancestor rows do not need to rerender before the first paint.
  <T,>(prevProps: GeneratorRowViewProps<T>, nextProps: GeneratorRowViewProps<T>) =>
    prevProps.cardButtonClassName === nextProps.cardButtonClassName &&
    prevProps.generationIndex === nextProps.generationIndex &&
    prevProps.handleBubbleClickRef === nextProps.handleBubbleClickRef &&
    prevProps.handleCardSelect === nextProps.handleCardSelect &&
    prevProps.hideBubble === nextProps.hideBubble &&
    prevProps.immediateSelectedOriginalCol === nextProps.immediateSelectedOriginalCol &&
    prevProps.onRowRendered === nextProps.onRowRendered &&
    prevProps.renderCard === nextProps.renderCard &&
    prevProps.reportRenderedRowOrder === nextProps.reportRenderedRowOrder &&
    prevProps.row === nextProps.row &&
    prevProps.rowClassName === nextProps.rowClassName &&
    prevProps.setCardRef === nextProps.setCardRef &&
    prevProps.setRowRef === nextProps.setRowRef &&
    prevProps.trackClassName === nextProps.trackClassName &&
    prevProps.selectedChildData === nextProps.selectedChildData &&
    prevProps.selectedParentData === nextProps.selectedParentData &&
    shallowReferenceArrayEqual(prevProps.selectedAncestorData, nextProps.selectedAncestorData),
) as <T>(props: GeneratorRowViewProps<T>) => ReactElement;

function schedulePostSelectionWork(work: () => void) {
  if (typeof window === "undefined") {
    work();
    return;
  }

  window.requestAnimationFrame(() => {
    work();
  });
}

function initializeGeneratorState<T, TMeta, TEffect>(
  createInitialState: () => GeneratorState<T, TMeta>,
  reduce: GeneratorController<T, TMeta, TEffect>["reduce"],
): {
  effects: TEffect[];
  state: GeneratorState<T, TMeta>;
} {
  const initialState = createInitialState();
  const transition = reduce(initialState, { type: "initialize" });

  return {
    effects: transition.effects,
    state: transition.state,
  };
}

function scrollElementToLeft(
  element: HTMLDivElement,
  left: number,
  behavior: ScrollBehavior,
) {
  if (behavior === "smooth") {
    element.scrollTo({
      left,
      behavior,
    });
    return;
  }

  const previousInlineScrollBehavior = element.style.scrollBehavior;
  element.style.scrollBehavior = "auto";
  element.scrollTo({
    left,
    behavior: "auto",
  });
  element.style.scrollBehavior = previousInlineScrollBehavior;
}

function getElementLeftWithinTrack(
  track: HTMLDivElement,
  element: HTMLDivElement,
): number {
  const trackRect = track.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  return elementRect.left - trackRect.left + track.scrollLeft;
}

function getElementVisibleCenterWithinTrack(
  track: HTMLDivElement,
  element: HTMLDivElement,
): number {
  const trackRect = track.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  return elementRect.left - trackRect.left + (elementRect.width / 2);
}

function scrollElementIntoVerticalView(
  element: HTMLDivElement,
  behavior: ScrollBehavior,
) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
  const currentScrollTop =
    window.scrollY ??
    window.pageYOffset ??
    document.documentElement?.scrollTop ??
    document.body?.scrollTop ??
    0;
  const nextScrollTop = getFullyVisibleViewportScrollTop(
    element.getBoundingClientRect(),
    viewportHeight,
    currentScrollTop,
  );

  if (nextScrollTop === null || Math.abs(nextScrollTop - currentScrollTop) < 1) {
    return;
  }

  window.scrollTo({
    top: nextScrollTop,
    behavior,
  });
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    schedulePostSelectionWork(() => {
      resolve();
    });
  });
}

async function waitForGenerationToRender<T, TMeta>(
  generationIndex: number,
  options: {
    getCardElement: (generationIndex: number, cardIndex: number, data: T) => HTMLDivElement | null | undefined;
    getRenderedRowOrder: (generationIndex: number) => Array<{
      dataKey: string;
      originalCol: number;
      selected: boolean;
    }>;
    getState: () => GeneratorState<T, TMeta>;
    getRowElement: (index: number) => HTMLDivElement | null | undefined;
  },
): Promise<GenerationRenderWaitResult> {
  const maxFrames = 8;
  let lastResult: GenerationRenderWaitResult = {
    framesWaited: 0,
    generationIndex,
    hasGeneration: false,
    hasRowElement: false,
    hasTargetCard: false,
    renderedOriginalCols: [],
    rowLength: 0,
    selectedIndex: -1,
    targetCardIndex: null,
    targetDataKey: null,
  };

  for (let frame = 0; frame < maxFrames; frame += 1) {
    const tree = resolveGeneratorTree(options.getState());
    const generation = tree[generationIndex] ?? [];
    const renderedRowOrder = options.getRenderedRowOrder(generationIndex);
    const selectedIndex = generation.findIndex((node) => node.selected);
    const targetCardIndex = getGeneratorRowScrollCardIndex({
      renderedOriginalCols: renderedRowOrder.map((entry) => entry.originalCol),
      rowLength: generation.length,
      selectedIndex,
    });
    const targetNode = targetCardIndex === null ? null : generation[targetCardIndex] ?? null;
    const hasGeneration = generation.length > 0;
    const hasRowElement = Boolean(options.getRowElement(generationIndex));
    const hasTargetCard = Boolean(
      targetCardIndex !== null &&
      targetNode &&
      options.getCardElement(generationIndex, targetCardIndex, targetNode.data),
    );
    lastResult = {
      framesWaited: frame,
      generationIndex,
      hasGeneration,
      hasRowElement,
      hasTargetCard,
      renderedOriginalCols: renderedRowOrder.map((entry) => entry.originalCol),
      rowLength: generation.length,
      selectedIndex,
      targetCardIndex,
      targetDataKey:
        targetCardIndex !== null && targetNode
          ? getDataKey(targetNode.data, targetCardIndex)
          : null,
    };

    if (hasGeneration && hasRowElement && hasTargetCard) {
      return lastResult;
    }

    await waitForNextFrame();
  }

  return {
    ...lastResult,
    framesWaited: maxFrames,
  };
}

export function AbstractGenerator<T, TMeta = undefined, TEffect = never>({
  createInitialState,
  debugLog = null,
  generatorHandleRef,
  getRowPresentation,
  onInitialTreePainted,
  onTreeChange,
  reduce,
  renderCard,
  runEffect,
  shouldAutoScrollMountedGeneration,
  treeRefreshRequest = null,
}: AbstractGeneratorProps<T, TMeta, TEffect>) {
  const [immediateSelection, setImmediateSelection] = useState<null | {
    col: number;
    row: number;
    selectionId: number;
  }>(null);
  const [initialTransition] = useState<{
    effects: TEffect[];
    state: GeneratorState<T, TMeta>;
  }>(() => initializeGeneratorState(createInitialState, reduce));

  const [state, setState] = useState<GeneratorState<T, TMeta>>(
    () => initialTransition.state,
  );
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const renderedRowOrderRef = useRef<Record<number, Array<{
    dataKey: string;
    originalCol: number;
    selected: boolean;
  }>>>({});
  const mountedRef = useRef(true);
  const activeLifecycleRef = useRef(0);
  const activeSelectionRef = useRef(0);
  const lastHandledTreeRefreshRequestKeyRef = useRef<string | null>(null);
  const mountedGenerationIndexesRef = useRef<Set<number>>(new Set());
  const committedTreeRef = useRef<GeneratorTree<T>>([]);
  const rowRenderSamplesRef = useRef<GeneratorRowRenderSample[]>([]);
  const stateRef = useRef(state);
  const handleBubbleClickRef = useRef<((generationIndex: number) => void) | null>(null);
  const lastHorizontalAlignmentRef = useRef<{
    generationIndex: number;
    targetDataKey: string | null;
  } | null>(null);
  const pendingSelectionPerfRef = useRef<null | {
    col: number;
    markName: string;
    row: number;
    selectionId: number;
  }>(null);
  const selectionClickTelemetryRef = useRef<Map<number, {
    clickAtEpochMs: number;
    clickAtIso: string;
    clickStartedAt: number;
  }>>(new Map());
  const pendingInitialTreeRenderRef = useRef<null | {
    acceptedAt: number;
    lifecycleId: number;
    requestedAt: number;
    rowCount: number;
    totalCardCount: number;
  }>(null);
  const committedInitialTreeRenderRef = useRef<null | {
    acceptedAt: number;
    committedAt: number;
    lifecycleId: number;
    requestedAt: number;
    rowCount: number;
    totalCardCount: number;
  }>(null);
  const runEffectsRef = useRef<null | ((
    effects: TEffect[],
    lifecycleId: number,
    selectionId: number,
  ) => Promise<void>)>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const createGuardedApplyUpdate = useCallback(
    (
      lifecycleId: number,
      selectionId: number,
      options?: {
        urgent?: boolean;
      },
    ) =>
      (
        nextUpdate:
          | GeneratorUpdate<T, TMeta>
          | null
          | undefined
          | ((prevState: GeneratorState<T, TMeta>) => GeneratorUpdate<T, TMeta> | null | undefined),
      ) => {
        if (
          !mountedRef.current ||
          activeLifecycleRef.current !== lifecycleId ||
          activeSelectionRef.current !== selectionId
        ) {
          return;
        }

        const requestedTree =
          selectionId === 0 &&
          nextUpdate &&
          typeof nextUpdate !== "function" &&
          "tree" in nextUpdate
            ? nextUpdate.tree ?? null
            : null;
        const requestedAt =
          requestedTree && pendingInitialTreeRenderRef.current === null
            ? getGeneratorPerfNow()
            : null;
        if (requestedTree && requestedAt !== null) {
          debugLog?.("generator:init-tree-update-requested", {
            lifecycleId,
            rowCount: requestedTree.length,
            selectionId,
            totalCardCount: getGeneratorTreeCardCount(requestedTree),
          });
        }

        const applyStateUpdate = () => {
          setState((prevState) => {
            if (
              !mountedRef.current ||
              activeLifecycleRef.current !== lifecycleId ||
              activeSelectionRef.current !== selectionId
            ) {
              return prevState;
            }

            const resolvedUpdate = typeof nextUpdate === "function"
              ? nextUpdate(prevState)
              : nextUpdate;
            const nextState = applyGeneratorUpdate(prevState, resolvedUpdate);
            const previousTree = resolveGeneratorTree(prevState);
            const nextTree = resolveGeneratorTree(nextState);
            if (
              selectionId === 0 &&
              previousTree.length === 0 &&
              nextTree.length > 0 &&
              pendingInitialTreeRenderRef.current === null
            ) {
              const acceptedAt = getGeneratorPerfNow();
              pendingInitialTreeRenderRef.current = {
                acceptedAt,
                lifecycleId,
                requestedAt: requestedAt ?? acceptedAt,
                rowCount: nextTree.length,
                totalCardCount: getGeneratorTreeCardCount(nextTree),
              };
              debugLog?.("generator:init-tree-state-derived", {
                acceptedElapsedMs: roundGeneratorPerfElapsedMs(
                  acceptedAt - (requestedAt ?? acceptedAt),
                ),
                lifecycleId,
                rowCount: nextTree.length,
                totalCardCount: getGeneratorTreeCardCount(nextTree),
              });
            }
            stateRef.current = nextState;
            return nextState;
          });
        };

        if (options?.urgent) {
          flushSync(() => {
            applyStateUpdate();
          });
          return;
        }

        startTransition(() => {
          applyStateUpdate();
        });
      },
    [debugLog],
  );

  useEffect(() => {
    if (
      treeRefreshRequest === null ||
      treeRefreshRequest.requestKey === lastHandledTreeRefreshRequestKeyRef.current
    ) {
      return;
    }

    lastHandledTreeRefreshRequestKeyRef.current = treeRefreshRequest.requestKey;

    const lifecycleId = activeLifecycleRef.current;
    const selectionId = activeSelectionRef.current;
    const applyUpdate = createGuardedApplyUpdate(lifecycleId, selectionId);
    void treeRefreshRequest.run(stateRef.current)
      .then((nextUpdate) => {
        if (!nextUpdate) {
          return;
        }

        applyUpdate(nextUpdate);
      })
      .catch(() => { });
  }, [createGuardedApplyUpdate, treeRefreshRequest]);

  const resolvedTree = useMemo(
    () => resolveGeneratorTree(state),
    [state],
  );

  const renderStartedAt = getGeneratorPerfNow();
  const {
    derivationElapsedMs,
    maxSelectedAncestorCount,
    renderedGenerations,
    totalCardCount,
  } = useMemo(() => {
    const derivationStartedAt = getGeneratorPerfNow();
    const nextRenderedGenerations: Array<{
      generationIndex: number;
      row: GeneratorNode<T>[];
      selectedAncestorData: T[];
      selectedChildData: T | null;
      selectedDescendantData: T[];
      selectedParentData: T | null;
    }> = [];
    const selectedAncestorData: T[] = [];
    const selectedDescendantDataByGeneration: T[][] = resolvedTree.map(() => []);
    const selectedDescendantData: T[] = [];
    let nextMaxSelectedAncestorCount = 0;
    let nextTotalCardCount = 0;

    for (let generationIndex = resolvedTree.length - 1; generationIndex >= 0; generationIndex -= 1) {
      selectedDescendantDataByGeneration[generationIndex] = [...selectedDescendantData];
      const selectedNode = resolvedTree[generationIndex]?.find((node) => node.selected);
      if (selectedNode) {
        selectedDescendantData.unshift(selectedNode.data);
      }
    }

    resolvedTree.forEach((row, generationIndex) => {
      nextTotalCardCount += row.length;
      const selectedParentData =
        generationIndex > 0
          ? resolvedTree[generationIndex - 1]?.find((node) => node.selected)?.data ?? null
          : null;
      const selectedChildData =
        resolvedTree[generationIndex + 1]?.find((node) => node.selected)?.data ?? null;
      nextRenderedGenerations.push({
        generationIndex,
        row,
        selectedAncestorData: [...selectedAncestorData],
        selectedChildData,
        selectedDescendantData: selectedDescendantDataByGeneration[generationIndex] ?? [],
        selectedParentData,
      });
      nextMaxSelectedAncestorCount = Math.max(
        nextMaxSelectedAncestorCount,
        selectedAncestorData.length,
      );

      const selectedNode = row.find((node) => node.selected);
      if (selectedNode) {
        selectedAncestorData.push(selectedNode.data);
      }
    });

    return {
      derivationElapsedMs: roundGeneratorPerfElapsedMs(
        getGeneratorPerfNow() - derivationStartedAt,
      ),
      maxSelectedAncestorCount: nextMaxSelectedAncestorCount,
      renderedGenerations: [...nextRenderedGenerations].reverse(),
      totalCardCount: nextTotalCardCount,
    };
  }, [resolvedTree]);

  useEffect(() => {
    onTreeChange?.(resolvedTree);
  }, [onTreeChange, resolvedTree]);

  const scrollToCardIndexInTree = useCallback((
    tree: GeneratorTree<T>,
    generationIndex: number,
    cardIndex: number,
    options?: {
      alignment?: "center" | "start";
      behavior?: ScrollBehavior;
    },
  ) => {
    const alignment = options?.alignment ?? "center";
    const behavior = options?.behavior ?? "smooth";
    const targetNode = tree[generationIndex]?.[cardIndex];

    if (!targetNode) {
      return;
    }

    const rowTrack = rowRefs.current[generationIndex];
    const targetCard = cardRefs.current[
      `${generationIndex}:${getDataKey(targetNode.data, cardIndex)}`
    ];

    if (targetCard && rowTrack) {
      const rowTrackStyles = window.getComputedStyle(rowTrack);
      const trackPaddingLeft = Number.parseFloat(rowTrackStyles.paddingLeft) || 0;
      const maxScrollLeft = rowTrack.scrollWidth - rowTrack.clientWidth;
      const targetLeft = getElementLeftWithinTrack(rowTrack, targetCard);
      const targetWidth = targetCard.getBoundingClientRect().width;
      const referenceIndex = tree[0]?.findIndex((node) => node.selected) ?? -1;
      const referenceTrack = rowRefs.current[0] ?? null;
      const referenceCard = referenceIndex >= 0
        ? cardRefs.current[
          `0:${getDataKey(tree[0][referenceIndex].data, referenceIndex)}`
        ]
        : null;
      const visibleAnchorX = referenceTrack && referenceCard
        ? getElementVisibleCenterWithinTrack(referenceTrack, referenceCard)
        : rowTrack.clientWidth / 2;
      const targetScrollLeft = getGeneratorRowScrollLeft({
        alignment,
        maxScrollLeft,
        targetLeft,
        targetWidth,
        trackPaddingLeft,
        visibleAnchorX,
      });

      scrollElementToLeft(rowTrack, targetScrollLeft, behavior);
      return;
    }

    if (targetCard) {
      targetCard.scrollIntoView({
        behavior,
        block: "nearest",
        inline: alignment,
      });
    }
  }, []);

  const scrollCardElementIntoViewInTree = useCallback((
    tree: GeneratorTree<T>,
    generationIndex: number,
    targetCard: HTMLDivElement,
    options?: {
      alignment?: "center" | "start";
      behavior?: ScrollBehavior;
      includeVerticalScroll?: boolean;
    },
  ) => {
    const alignment = options?.alignment ?? "center";
    const behavior = options?.behavior ?? "smooth";
    const rowTrack = rowRefs.current[generationIndex];

    if (targetCard && rowTrack) {
      const rowTrackStyles = window.getComputedStyle(rowTrack);
      const trackPaddingLeft = Number.parseFloat(rowTrackStyles.paddingLeft) || 0;
      const maxScrollLeft = rowTrack.scrollWidth - rowTrack.clientWidth;
      const targetLeft = getElementLeftWithinTrack(rowTrack, targetCard);
      const targetWidth = targetCard.getBoundingClientRect().width;
      const referenceIndex = tree[0]?.findIndex((node) => node.selected) ?? -1;
      const referenceTrack = rowRefs.current[0] ?? null;
      const referenceCard = referenceIndex >= 0
        ? cardRefs.current[
          `0:${getDataKey(tree[0][referenceIndex].data, referenceIndex)}`
        ]
        : null;
      const visibleAnchorX = referenceTrack && referenceCard
        ? getElementVisibleCenterWithinTrack(referenceTrack, referenceCard)
        : rowTrack.clientWidth / 2;
      const targetScrollLeft = getGeneratorRowScrollLeft({
        alignment,
        maxScrollLeft,
        targetLeft,
        targetWidth,
        trackPaddingLeft,
        visibleAnchorX,
      });

      scrollElementToLeft(rowTrack, targetScrollLeft, behavior);
      if (options?.includeVerticalScroll) {
        scrollElementIntoVerticalView(rowTrack, behavior);
      }
      return;
    }

    targetCard.scrollIntoView({
      behavior,
      block: "nearest",
      inline: alignment,
    });
  }, []);

  const scrollToCardIndex = useCallback((
    generationIndex: number,
    cardIndex: number,
    options?: {
      alignment?: "center" | "start";
      behavior?: ScrollBehavior;
    },
  ) => {
    scrollToCardIndexInTree(resolvedTree, generationIndex, cardIndex, options);
  }, [resolvedTree, scrollToCardIndexInTree]);

  const handleScrollToSelected = useCallback((generationIndex: number) => {
    const selectedRow = resolvedTree[generationIndex];
    const selectedIndex = selectedRow?.findIndex((node) => node.selected) ?? -1;

    if (selectedIndex < 0) {
      if (!selectedRow || selectedRow.length === 0) {
        return;
      }

      const originalOrder = selectedRow.map((node, index) => ({
        dataKey: getDataKey(node.data, index),
        originalCol: index,
        selected: node.selected,
      }));
      const renderedOrder = renderedRowOrderRef.current[generationIndex] ?? [];
      const targetOriginalCol = getUnselectedRowScrollCardIndex(
        renderedOrder.map((entry) => entry.originalCol),
        0,
      );
      debugLog?.("generator:scroll-unselected-row", {
        generationIndex,
        requestedOriginalCol: targetOriginalCol,
        requestedDataKey: originalOrder[targetOriginalCol]?.dataKey ?? null,
        renderedFirstOriginalCol: renderedOrder[0]?.originalCol ?? null,
        renderedFirstDataKey: renderedOrder[0]?.dataKey ?? null,
        originalOrder,
        renderedOrder,
      });

      scrollToCardIndexInTree(resolvedTree, generationIndex, targetOriginalCol, {
        alignment: "start",
        behavior: "smooth",
      });
      return;
    }

    scrollToCardIndexInTree(resolvedTree, generationIndex, selectedIndex, {
      behavior: "smooth",
    });
  }, [debugLog, resolvedTree, scrollToCardIndexInTree]);

  const handleBubbleClick = useCallback((generationIndex: number) => {
    if (generationIndex === 0) {
      resolvedTree.forEach((_, rowIndex) => {
        handleScrollToSelected(rowIndex);
      });
      return;
    }

    handleScrollToSelected(generationIndex);
  }, [handleScrollToSelected, resolvedTree]);

  useLayoutEffect(() => {
    handleBubbleClickRef.current = handleBubbleClick;
  }, [handleBubbleClick]);

  const scrollGenerationLikeBubble = useCallback(async (generationIndex: number) => {
    const getWaitResult = () => waitForGenerationToRender(generationIndex, {
      getCardElement: (rowIndex, cardIndex, data) =>
        cardRefs.current[`${rowIndex}:${getDataKey(data, cardIndex)}`],
      getRenderedRowOrder: (index) => renderedRowOrderRef.current[index] ?? [],
      getState: () => stateRef.current,
      getRowElement: (index) => rowRefs.current[index],
    });
    let waitResult = await getWaitResult();
    debugLog?.(
      isGenerationRenderReady(waitResult)
        ? "generator:scroll-like-bubble-ready"
        : "generator:scroll-like-bubble-timeout",
      waitResult,
    );

    if (
      mountedRef.current &&
      !isGenerationRenderReady(waitResult) &&
      waitResult.hasGeneration
    ) {
      waitResult = await getWaitResult();
      debugLog?.(
        isGenerationRenderReady(waitResult)
          ? "generator:scroll-like-bubble-retry-ready"
          : "generator:scroll-like-bubble-retry-timeout",
        waitResult,
      );
    }

    if (!mountedRef.current) {
      debugLog?.("generator:scroll-like-bubble-aborted", {
        generationIndex,
        reason: "unmounted",
      });
      return;
    }

    if (!isGenerationRenderReady(waitResult)) {
      debugLog?.("generator:scroll-like-bubble-aborted", {
        generationIndex,
        reason: "row-not-ready",
        waitResult,
      });
      return;
    }

    debugLog?.("generator:scroll-like-bubble-execute", {
      generationIndex,
      targetRowExists: Boolean(rowRefs.current[generationIndex]),
    });
    lastHorizontalAlignmentRef.current = {
      generationIndex,
      targetDataKey: waitResult.targetDataKey,
    };
    handleBubbleClickRef.current?.(generationIndex);
  }, [debugLog]);

  const scrollGenerationIntoVerticalView = useCallback(async (
    generationIndex: number,
    options?: {
      alignRowHorizontally?: boolean;
    },
  ) => {
    const alignRowHorizontally = options?.alignRowHorizontally ?? true;
    const waitResult = await waitForGenerationToRender(generationIndex, {
      getCardElement: (rowIndex, cardIndex, data) =>
        cardRefs.current[`${rowIndex}:${getDataKey(data, cardIndex)}`],
      getRenderedRowOrder: (index) => renderedRowOrderRef.current[index] ?? [],
      getState: () => stateRef.current,
      getRowElement: (index) => rowRefs.current[index],
    });
    debugLog?.(
      waitResult.hasGeneration && waitResult.hasRowElement && waitResult.hasTargetCard
        ? "generator:scroll-vertical-ready"
        : "generator:scroll-vertical-timeout",
      waitResult,
    );

    if (!mountedRef.current) {
      debugLog?.("generator:scroll-vertical-aborted", {
        generationIndex,
        reason: "unmounted",
      });
      return;
    }

    const rowTrack = rowRefs.current[generationIndex];
    if (!rowTrack) {
      debugLog?.("generator:scroll-vertical-aborted", {
        generationIndex,
        reason: "missing-row-element",
      });
      return;
    }

    if (
      alignRowHorizontally &&
      (
        lastHorizontalAlignmentRef.current?.generationIndex !== generationIndex ||
        lastHorizontalAlignmentRef.current?.targetDataKey !== waitResult.targetDataKey
      )
    ) {
      debugLog?.("generator:scroll-vertical-align-row", {
        generationIndex,
        targetDataKey: waitResult.targetDataKey,
      });
      lastHorizontalAlignmentRef.current = {
        generationIndex,
        targetDataKey: waitResult.targetDataKey,
      };
      handleBubbleClickRef.current?.(generationIndex);
    }

    debugLog?.("generator:scroll-vertical-execute", {
      alignRowHorizontally,
      generationIndex,
    });
    scrollElementIntoVerticalView(rowTrack, "smooth");
  }, [debugLog]);

  const runEffects = useCallback(async (
    effects: TEffect[],
    lifecycleId: number,
    selectionId: number,
  ) => {
    const applyUpdate = createGuardedApplyUpdate(lifecycleId, selectionId);
    const applyUrgentUpdate = createGuardedApplyUpdate(lifecycleId, selectionId, {
      urgent: true,
    });

    for (const effect of effects) {
      if (
        !mountedRef.current ||
        activeLifecycleRef.current !== lifecycleId ||
        activeSelectionRef.current !== selectionId
      ) {
        return;
      }

      await runEffect(effect, {
        applyUpdate,
        applyUrgentUpdate,
        getState: () => stateRef.current,
        lifecycleId,
        selectionId,
        scrollGenerationIntoVerticalView,
        scrollGenerationLikeBubble,
      });
    }
  }, [createGuardedApplyUpdate, runEffect, scrollGenerationIntoVerticalView, scrollGenerationLikeBubble]);

  useEffect(() => {
    runEffectsRef.current = runEffects;
  }, [runEffects]);

  useEffect(() => {
    const lifecycleId = activeLifecycleRef.current + 1;
    activeLifecycleRef.current = lifecycleId;
    activeSelectionRef.current = 0;
    stateRef.current = initialTransition.state;
    // Initialization should only run on mount/reset. Re-running it on tree changes
    // cancels queued selection effects by resetting the active selection id.
    void runEffectsRef.current?.(
      initialTransition.effects,
      lifecycleId,
      activeSelectionRef.current,
    );
  }, [initialTransition]);

  useLayoutEffect(() => {
    const previouslyMountedGenerationIndexes = mountedGenerationIndexesRef.current;
    const nextMountedGenerationIndexes = new Set<number>();

    resolvedTree.forEach((row, generationIndex) => {
      nextMountedGenerationIndexes.add(generationIndex);

      if (
        previouslyMountedGenerationIndexes.has(generationIndex) ||
        !shouldAutoScrollMountedGeneration?.({
          generationIndex,
          row,
          tree: resolvedTree,
        })
      ) {
        return;
      }

      schedulePostSelectionWork(() => {
        handleBubbleClick(generationIndex);
      });
    });

    mountedGenerationIndexesRef.current = nextMountedGenerationIndexes;
  }, [handleBubbleClick, resolvedTree, shouldAutoScrollMountedGeneration]);

  const handleRowRendered = useCallback((sample: GeneratorRowRenderSample) => {
    rowRenderSamplesRef.current.push(sample);
  }, []);
  const reportRenderedRowOrder = useCallback((
    generationIndex: number,
    entries: Array<{
      dataKey: string;
      originalCol: number;
      selected: boolean;
    }>,
  ) => {
    renderedRowOrderRef.current[generationIndex] = entries;
  }, []);
  const setRowRef = useCallback((generationIndex: number, element: HTMLDivElement | null) => {
    rowRefs.current[generationIndex] = element;
  }, []);
  const setCardRef = useCallback((refKey: string, element: HTMLDivElement | null) => {
    cardRefs.current[refKey] = element;
  }, []);

  useLayoutEffect(() => {
    const previousCommittedTree = committedTreeRef.current;
    const rowRenderSamples = rowRenderSamplesRef.current.splice(0);
    const changedGenerationIndexes = resolvedTree.reduce<number[]>(
      (indexes, row, generationIndex) => {
        if (previousCommittedTree[generationIndex] !== row) {
          indexes.push(generationIndex);
        }

        return indexes;
      },
      [],
    );
    const appendedGenerationIndexes = changedGenerationIndexes.filter((generationIndex) =>
      generationIndex >= previousCommittedTree.length,
    );
    const changedGenerationIndexSet = new Set(changedGenerationIndexes);

    if (isPerfLoggingEnabled()) {
      const elapsedMs = roundGeneratorPerfElapsedMs(getGeneratorPerfNow() - renderStartedAt);
      const rerenderedUnchangedGenerationIndexes = rowRenderSamples
        .filter((sample) => !changedGenerationIndexSet.has(sample.generationIndex))
        .map((sample) => sample.generationIndex);
      const rerenderedUnchangedGenerationSamples = rowRenderSamples
        .filter((sample) => !changedGenerationIndexSet.has(sample.generationIndex))
        .map((sample) => ({
          elapsedMs: sample.elapsedMs,
          generationIndex: sample.generationIndex,
          metadataCallbackCount: sample.metadataCallbackCount,
          metadataChangedCount: sample.metadataChangedCount,
          metadataDeletedCount: sample.metadataDeletedCount,
          metadataNoopCount: sample.metadataNoopCount,
          reorderedItemCount: sample.reorderedItemCount,
          reorderedItems: sample.reorderedItems,
          rowOrderChanged: sample.rowOrderChanged,
        }));
      const slowRowSamples = rowRenderSamples.filter((sample) =>
        sample.elapsedMs >= SLOW_GENERATOR_ROW_THRESHOLD_MS);

      if (
        derivationElapsedMs >= SLOW_GENERATOR_DERIVATION_THRESHOLD_MS ||
        resolvedTree.length >= 20
      ) {
        logPerf("abstractGenerator.deriveRenderedGenerations", {
          elapsedMs: derivationElapsedMs,
          maxSelectedAncestorCount,
          rowCount: resolvedTree.length,
          totalCardCount,
        });
      }

      if (
        appendedGenerationIndexes.length > 0 ||
        elapsedMs >= SLOW_GENERATOR_COMMIT_THRESHOLD_MS ||
        rerenderedUnchangedGenerationIndexes.length > 0
      ) {
        logPerf("abstractGenerator.commitTree", {
          appendedGenerationIndexes,
          changedGenerationCount: changedGenerationIndexes.length,
          changedGenerationIndexes,
          elapsedMs,
          rerenderedUnchangedGenerationDetails: rerenderedUnchangedGenerationSamples,
          renderedGenerationCount: rowRenderSamples.length,
          renderedGenerationIndexes: rowRenderSamples.map((sample) => sample.generationIndex),
          rerenderedUnchangedGenerationIndexes,
          rowCount: resolvedTree.length,
          slowGenerationIndexes: slowRowSamples.map((sample) => sample.generationIndex),
          totalCardCount,
        });
      }

      if (
        pendingSelectionPerfRef.current &&
        rowRenderSamples.length > 0 &&
        changedGenerationIndexes.length > 0
      ) {
        const selectionPerf = pendingSelectionPerfRef.current;
        logPerfSinceMark(
          "abstractGenerator.commitAfterSelection",
          selectionPerf.markName,
          {
            changedGenerationCount: changedGenerationIndexes.length,
            changedGenerationIndexes,
            col: selectionPerf.col,
            renderedGenerationCount: rowRenderSamples.length,
            row: selectionPerf.row,
            rowCount: resolvedTree.length,
            selectionId: selectionPerf.selectionId,
            totalCardCount,
          },
        );
        pendingSelectionPerfRef.current = null;
      }

      slowRowSamples.forEach((sample) => {
        logPerf("abstractGenerator.renderRow", sample);
      });
    }

    if (
      (debugLog || onInitialTreePainted) &&
      previousCommittedTree.length === 0 &&
      resolvedTree.length > 0 &&
      pendingInitialTreeRenderRef.current !== null &&
      committedInitialTreeRenderRef.current === null
    ) {
      const committedAt = getGeneratorPerfNow();
      const pendingInitialTreeRender = pendingInitialTreeRenderRef.current;
      const slowestRowSamples = [...rowRenderSamples]
        .sort((left, right) => right.elapsedMs - left.elapsedMs)
        .slice(0, 5)
        .map((sample) => ({
          cardCount: sample.cardCount,
          elapsedMs: sample.elapsedMs,
          generationIndex: sample.generationIndex,
          phase: sample.phase,
          selectedAncestorCount: sample.selectedAncestorCount,
        }));
      committedInitialTreeRenderRef.current = {
        ...pendingInitialTreeRender,
        committedAt,
      };
      debugLog?.("generator:init-tree-committed", {
        changedGenerationCount: changedGenerationIndexes.length,
        changedGenerationIndexes,
        commitElapsedMs: roundGeneratorPerfElapsedMs(
          committedAt - pendingInitialTreeRender.acceptedAt,
        ),
        derivationElapsedMs,
        requestedElapsedMs: roundGeneratorPerfElapsedMs(
          committedAt - pendingInitialTreeRender.requestedAt,
        ),
        renderedGenerationCount: rowRenderSamples.length,
        renderedGenerationIndexes: rowRenderSamples.map((sample) => sample.generationIndex),
        rowRenderElapsedMsTotal: roundGeneratorPerfElapsedMs(
          rowRenderSamples.reduce((total, sample) => total + sample.elapsedMs, 0),
        ),
        rowCount: resolvedTree.length,
        slowRowCount: rowRenderSamples.filter((sample) =>
          sample.elapsedMs >= SLOW_GENERATOR_ROW_THRESHOLD_MS
        ).length,
        slowestRowSamples,
        totalCardCount,
      });
    }

    committedTreeRef.current = resolvedTree;
  }, [debugLog, derivationElapsedMs, maxSelectedAncestorCount, onInitialTreePainted, renderStartedAt, resolvedTree, totalCardCount]);

  useEffect(() => {
    if (
      committedInitialTreeRenderRef.current === null ||
      (!debugLog && !onInitialTreePainted)
    ) {
      return;
    }

    const committedInitialTreeRender = committedInitialTreeRenderRef.current;
    const frameId = window.requestAnimationFrame(() => {
      const paintedAt = getGeneratorPerfNow();
      const mountedRowCount = resolvedTree.reduce((count, _, generationIndex) =>
        count + (rowRefs.current[generationIndex] ? 1 : 0),
      0);
      debugLog?.("generator:init-tree-painted", {
        committedElapsedMs: roundGeneratorPerfElapsedMs(
          paintedAt - committedInitialTreeRender.committedAt,
        ),
        firstRowMounted: Boolean(rowRefs.current[0]),
        lastRowMounted: Boolean(rowRefs.current[resolvedTree.length - 1]),
        mountedRowCount,
        requestedElapsedMs: roundGeneratorPerfElapsedMs(
          paintedAt - committedInitialTreeRender.requestedAt,
        ),
        rowCount: committedInitialTreeRender.rowCount,
        totalCardCount: committedInitialTreeRender.totalCardCount,
      });
      onInitialTreePainted?.(resolvedTree);
      committedInitialTreeRenderRef.current = null;
      pendingInitialTreeRenderRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [debugLog, onInitialTreePainted, resolvedTree]);

  const handleCardSelect = useCallback((row: number, col: number) => {
    const currentTree = stateRef.current.tree ?? [];
    const selectedRow = currentTree?.[row];
    const selectedNode = selectedRow?.[col] ?? null;

    if (!selectedRow || !selectedNode || isDisabledNode(selectedNode)) {
      return;
    }

    const nextSelectionId = activeSelectionRef.current + 1;
    activeSelectionRef.current = nextSelectionId;
    const selectionMarkName = `abstractGenerator.selectCard.${nextSelectionId}`;
    const clickStartedAt = getGeneratorPerfNow();
    const clickDate = new Date();
    selectionClickTelemetryRef.current.set(nextSelectionId, {
      clickAtEpochMs: clickDate.getTime(),
      clickAtIso: clickDate.toISOString(),
      clickStartedAt,
    });
    if (selectionClickTelemetryRef.current.size > 20) {
      const oldestSelectionId = selectionClickTelemetryRef.current.keys().next().value;
      if (typeof oldestSelectionId === "number") {
        selectionClickTelemetryRef.current.delete(oldestSelectionId);
      }
    }
    if (isPerfLoggingEnabled()) {
      pendingSelectionPerfRef.current = {
        col,
        markName: selectionMarkName,
        row,
        selectionId: nextSelectionId,
      };
      markPerf(selectionMarkName);
      logPerf("abstractGenerator.selectCard", {
        col,
        row,
        rowCount: currentTree.length,
        selectionId: nextSelectionId,
        totalCardCount: currentTree.reduce((count, generation) => count + generation.length, 0),
      });
    }

    const currentCardElement = cardRefs.current[
      `${row}:${getDataKey(selectedNode.data, col)}`
    ];
    if (typeof document !== "undefined") {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        !(currentCardElement?.contains(activeElement) ?? false)
      ) {
        activeElement.blur();
      }
    }

    flushSync(() => {
      setImmediateSelection({
        col,
        row,
        selectionId: nextSelectionId,
      });
    });
    if (isPerfLoggingEnabled()) {
      logPerfSinceMark("abstractGenerator.selectCard.localStateApplied", selectionMarkName, {
        col,
        effectCount: 0,
        row,
        rowCount: currentTree.length,
        selectionId: nextSelectionId,
      });
    }

    schedulePostSelectionWork(() => {
      if (
        !mountedRef.current ||
        activeSelectionRef.current !== nextSelectionId
      ) {
        return;
      }

      if (isPerfLoggingEnabled()) {
        logPerfSinceMark("abstractGenerator.selectCard.scrollRequested", selectionMarkName, {
          col,
          row,
          selectionId: nextSelectionId,
        });
      }
      if (currentCardElement) {
        scrollCardElementIntoViewInTree(currentTree, row, currentCardElement, {
          behavior: "smooth",
          includeVerticalScroll: true,
        });
      } else {
        scrollToCardIndexInTree(currentTree, row, col, {
          behavior: "smooth",
        });
        const rowTrack = rowRefs.current[row];
        if (rowTrack) {
          scrollElementIntoVerticalView(rowTrack, "smooth");
        }
      }
      if (isPerfLoggingEnabled()) {
        logPerfSinceMark("abstractGenerator.selectCard.scrollIssued", selectionMarkName, {
          col,
          row,
          selectionId: nextSelectionId,
        });
      }

      const transition = reduce(stateRef.current, {
        type: "select",
        row,
        col,
      });

      stateRef.current = transition.state;
      flushSync(() => {
        setState(transition.state);
      });

      void (async () => {
        if (
          !mountedRef.current ||
          activeSelectionRef.current !== nextSelectionId
        ) {
          if (isPerfLoggingEnabled()) {
            logPerfSinceMark("abstractGenerator.selectCard.effectsAborted", selectionMarkName, {
              col,
              reason: !mountedRef.current ? "unmounted" : "superseded",
              row,
              selectionId: nextSelectionId,
            });
          }
          return;
        }

        if (isPerfLoggingEnabled()) {
          logPerfSinceMark("abstractGenerator.selectCard.effectsStarted", selectionMarkName, {
            col,
            effectCount: transition.effects.length,
            row,
            selectionId: nextSelectionId,
          });
        }
        await runEffects(
          transition.effects,
          activeLifecycleRef.current,
          nextSelectionId,
        );
      })();
    });
  }, [reduce, runEffects, scrollCardElementIntoViewInTree, scrollToCardIndexInTree]);

  useLayoutEffect(() => {
    if (!generatorHandleRef) {
      return;
    }

    generatorHandleRef.current = {
      alignTreeLikeRootBubble: () => {
        handleBubbleClickRef.current?.(0);
      },
      revealGeneration: (generationIndex, options) =>
        scrollGenerationIntoVerticalView(generationIndex, options)
          .then(() => scrollGenerationLikeBubble(generationIndex))
          .catch(() => { }),
      scrollToCard: scrollToCardIndex,
      selectCard: handleCardSelect,
    };

    return () => {
      generatorHandleRef.current = null;
    };
  }, [
    generatorHandleRef,
    handleCardSelect,
    scrollGenerationIntoVerticalView,
    scrollGenerationLikeBubble,
    scrollToCardIndex,
  ]);

  return (
    <section
      aria-busy={state.tree === null}
      aria-label="Generator"
      className="abstract-generator"
    >
      {renderedGenerations.map(({
        generationIndex,
        row,
        selectedAncestorData,
        selectedChildData,
        selectedDescendantData,
        selectedParentData,
      }) => {
        const rowPresentation = getRowPresentation?.(row, generationIndex) ?? {};
        const rowClassName = [
          "generator-row",
          rowPresentation.className ?? "",
        ].filter(Boolean).join(" ");
        const trackClassName = [
          "generator-row-track",
          generationIndex === 0 ? "generator-row-track-root" : "",
          rowPresentation.trackClassName ?? "",
        ].filter(Boolean).join(" ");

        return (
          <MemoizedGeneratorRowView
            cardButtonClassName={rowPresentation.cardButtonClassName ?? ""}
            key={generationIndex}
            generationIndex={generationIndex}
            handleBubbleClickRef={handleBubbleClickRef}
            handleCardSelect={handleCardSelect}
            hideBubble={rowPresentation.hideBubble === true}
            immediateSelectedOriginalCol={
              immediateSelection?.row === generationIndex &&
              !resolvedTree[immediateSelection.row]?.[immediateSelection.col]?.selected
                ? immediateSelection.col
                : null
            }
            isViewportPriorityRow={generationIndex >= Math.max(0, resolvedTree.length - 2)}
            onRowRendered={handleRowRendered}
            renderCard={renderCard}
            reportRenderedRowOrder={reportRenderedRowOrder}
            row={row}
            rowClassName={rowClassName}
            selectedAncestorData={selectedAncestorData}
            selectedChildData={selectedChildData}
            selectedDescendantData={selectedDescendantData}
            selectedParentData={selectedParentData}
            setCardRef={setCardRef}
            setRowRef={setRowRef}
            trackClassName={trackClassName}
          />
        );
      })}
    </section>
  );
}
