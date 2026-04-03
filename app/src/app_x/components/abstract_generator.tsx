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
import { isPerfLoggingEnabled, logPerf, logPerfSinceMark, markPerf } from "../perf";
import {
  applyGeneratorUpdate,
  getDataKey,
  isDisabledNode,
  resolveGeneratorTree,
} from "../generators/generator_runtime";
import "../styles/abstract_generator.css";
import {
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

export type AbstractGeneratorTreeRefreshRequest<T> = {
  requestKey: string;
  run: (tree: GeneratorTree<T>) => Promise<GeneratorTree<T> | null>;
};

export type AbstractGeneratorHandle = {
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
    onTreeChange?: (tree: GeneratorTree<T>) => void;
    resetKey?: number | string;
    treeRefreshRequest?: AbstractGeneratorTreeRefreshRequest<T> | null;
  };

type GeneratorRowRenderSample = {
  cardCount: number;
  elapsedMs: number;
  generationIndex: number;
  phase: "mount" | "update";
  selectedAncestorCount: number;
};

type GeneratorRowOrderState = {
  metadataByDataKey: Map<string, GeneratorCardRowOrderMetadata>;
  rowDataKeysSignature: string;
};

type GeneratorRowViewProps<T> = {
  cardButtonClassName: string;
  generationIndex: number;
  handleBubbleClickRef: MutableRefObject<((generationIndex: number) => void) | null>;
  handleCardSelect: (row: number, col: number) => void;
  hideBubble: boolean;
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

function GeneratorRowViewInner<T>({
  cardButtonClassName,
  generationIndex,
  handleBubbleClickRef,
  handleCardSelect,
  hideBubble,
  onRowRendered,
  renderCard,
  reportRenderedRowOrder,
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
  const renderStartedAt = getGeneratorPerfNow();
  const rowDataKeysSignature = useMemo(
    () => row.map((node, index) => getDataKey(node.data, index)).join("|"),
    [row],
  );
  const [rowOrderState, setRowOrderState] = useState<GeneratorRowOrderState>(() => ({
    metadataByDataKey: new Map(),
    rowDataKeysSignature,
  }));

  const handleRowOrderMetadataChange = useCallback(
    (dataKey: string, metadata: GeneratorCardRowOrderMetadata | null) => {
      setRowOrderState((currentState) => {
        const currentMetadataByDataKey =
          currentState.rowDataKeysSignature === rowDataKeysSignature
            ? currentState.metadataByDataKey
            : new Map<string, GeneratorCardRowOrderMetadata>();
        const currentMetadata = currentMetadataByDataKey.get(dataKey);

        if (metadata === null) {
          if (!currentMetadata) {
            return currentState.rowDataKeysSignature === rowDataKeysSignature
              ? currentState
              : {
                metadataByDataKey: currentMetadataByDataKey,
                rowDataKeysSignature,
              };
          }

          const nextMetadataByDataKey = new Map(currentMetadataByDataKey);
          nextMetadataByDataKey.delete(dataKey);
          return {
            metadataByDataKey: nextMetadataByDataKey,
            rowDataKeysSignature,
          };
        }

        if (areGeneratorCardRowOrderMetadataEqual(currentMetadata, metadata)) {
          return currentState.rowDataKeysSignature === rowDataKeysSignature
            ? currentState
            : {
              metadataByDataKey: currentMetadataByDataKey,
              rowDataKeysSignature,
            };
        }

        const nextMetadataByDataKey = new Map(currentMetadataByDataKey);
        nextMetadataByDataKey.set(dataKey, metadata);
        return {
          metadataByDataKey: nextMetadataByDataKey,
          rowDataKeysSignature,
        };
      });
    },
    [rowDataKeysSignature],
  );
  const sortedRowEntries = useMemo(
    () => getSortedGeneratorRowEntries(
      row,
      rowOrderState.rowDataKeysSignature === rowDataKeysSignature
        ? rowOrderState.metadataByDataKey
        : new Map<string, GeneratorCardRowOrderMetadata>(),
    ),
    [row, rowDataKeysSignature, rowOrderState],
  );

  const renderedCards = sortedRowEntries.map(({ dataKey, node, originalCol }) => {
    const refKey = `${generationIndex}:${dataKey}`;

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
          node,
          selectedAncestorData,
          selectedChildData,
          selectedDescendantData,
          selectedParentData,
          reportRowOrderMetadata: (metadata) => {
            handleRowOrderMetadataChange(dataKey, metadata);
          },
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

  useLayoutEffect(() => {
    onRowRendered({
      cardCount: row.length,
      elapsedMs: renderElapsedMs,
      generationIndex,
      phase: didMountRef.current ? "update" : "mount",
      selectedAncestorCount: selectedAncestorData.length,
    });
    didMountRef.current = true;
  }, [generationIndex, onRowRendered, renderElapsedMs, row.length, selectedAncestorData.length]);

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
  <T,>(prevProps: GeneratorRowViewProps<T>, nextProps: GeneratorRowViewProps<T>) =>
    prevProps.cardButtonClassName === nextProps.cardButtonClassName &&
    prevProps.generationIndex === nextProps.generationIndex &&
    prevProps.handleBubbleClickRef === nextProps.handleBubbleClickRef &&
    prevProps.handleCardSelect === nextProps.handleCardSelect &&
    prevProps.hideBubble === nextProps.hideBubble &&
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
    shallowReferenceArrayEqual(prevProps.selectedAncestorData, nextProps.selectedAncestorData) &&
    shallowReferenceArrayEqual(prevProps.selectedDescendantData, nextProps.selectedDescendantData),
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
    getState: () => GeneratorState<T, TMeta>;
    getRowElement: (index: number) => HTMLDivElement | null | undefined;
  },
): Promise<void> {
  const maxFrames = 5;

  for (let frame = 0; frame < maxFrames; frame += 1) {
    const tree = resolveGeneratorTree(options.getState());
    const hasGeneration = Boolean(tree[generationIndex]?.length);
    const hasRowElement = Boolean(options.getRowElement(generationIndex));

    if (hasGeneration && hasRowElement) {
      return;
    }

    await waitForNextFrame();
  }
}

export function AbstractGenerator<T, TMeta = undefined, TEffect = never>({
  createInitialState,
  debugLog = null,
  generatorHandleRef,
  getRowPresentation,
  onTreeChange,
  reduce,
  renderCard,
  runEffect,
  shouldAutoScrollMountedGeneration,
  treeRefreshRequest = null,
}: AbstractGeneratorProps<T, TMeta, TEffect>) {
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
  const pendingSelectionPerfRef = useRef<null | {
    col: number;
    markName: string;
    row: number;
    selectionId: number;
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
    (lifecycleId: number, selectionId: number) =>
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

        startTransition(() => {
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
            stateRef.current = nextState;
            return nextState;
          });
        });
      },
    [],
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
    const currentTree = resolveGeneratorTree(stateRef.current);

    void treeRefreshRequest.run(currentTree)
      .then((nextTree) => {
        if (!nextTree) {
          return;
        }

        applyUpdate({
          tree: nextTree,
        });
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

  const scrollToCardIndex = useCallback((
    generationIndex: number,
    cardIndex: number,
    options?: {
      alignment?: "center" | "start";
      behavior?: ScrollBehavior;
    },
  ) => {
    const alignment = options?.alignment ?? "center";
    const behavior = options?.behavior ?? "smooth";
    const targetNode = resolvedTree[generationIndex]?.[cardIndex];

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
      const referenceIndex = resolvedTree[0]?.findIndex((node) => node.selected) ?? -1;
      const referenceTrack = rowRefs.current[0] ?? null;
      const referenceCard = referenceIndex >= 0
        ? cardRefs.current[
        `0:${getDataKey(resolvedTree[0][referenceIndex].data, referenceIndex)}`
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
  }, [resolvedTree]);

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

      scrollToCardIndex(generationIndex, targetOriginalCol, {
        alignment: "start",
        behavior: "smooth",
      });
      return;
    }

    scrollToCardIndex(generationIndex, selectedIndex, {
      behavior: "smooth",
    });
  }, [debugLog, resolvedTree, scrollToCardIndex]);

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
    await waitForNextFrame();
    await waitForGenerationToRender(generationIndex, {
      getState: () => stateRef.current,
      getRowElement: (index) => rowRefs.current[index],
    });

    if (!mountedRef.current) {
      return;
    }

    handleBubbleClickRef.current?.(generationIndex);
  }, []);

  const scrollGenerationIntoVerticalView = useCallback(async (generationIndex: number) => {
    await waitForNextFrame();
    await waitForGenerationToRender(generationIndex, {
      getState: () => stateRef.current,
      getRowElement: (index) => rowRefs.current[index],
    });

    if (!mountedRef.current) {
      return;
    }

    const rowElement = rowRefs.current[generationIndex];
    if (!rowElement) {
      return;
    }

    scrollElementIntoVerticalView(rowElement, "smooth");
  }, []);

  const runEffects = useCallback(async (
    effects: TEffect[],
    lifecycleId: number,
    selectionId: number,
  ) => {
    const applyUpdate = createGuardedApplyUpdate(lifecycleId, selectionId);

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

    if (isPerfLoggingEnabled()) {
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
      const elapsedMs = roundGeneratorPerfElapsedMs(getGeneratorPerfNow() - renderStartedAt);
      const changedGenerationIndexSet = new Set(changedGenerationIndexes);
      const rerenderedUnchangedGenerationIndexes = rowRenderSamples
        .filter((sample) => !changedGenerationIndexSet.has(sample.generationIndex))
        .map((sample) => sample.generationIndex);
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
          renderedGenerationCount: rowRenderSamples.length,
          renderedGenerationIndexes: rowRenderSamples.map((sample) => sample.generationIndex),
          rerenderedUnchangedGenerationIndexes,
          rowCount: resolvedTree.length,
          slowGenerationIndexes: slowRowSamples.map((sample) => sample.generationIndex),
          totalCardCount,
        });
      }

      if (pendingSelectionPerfRef.current && rowRenderSamples.length > 0) {
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

    committedTreeRef.current = resolvedTree;
  }, [derivationElapsedMs, maxSelectedAncestorCount, renderStartedAt, resolvedTree, totalCardCount]);

  const handleCardSelect = useCallback((row: number, col: number) => {
    const currentTree = stateRef.current.tree ?? [];
    const selectedRow = currentTree?.[row];
    const selectedNode = selectedRow?.[col] ?? null;

    if (!selectedRow || !selectedNode || isDisabledNode(selectedNode)) {
      return;
    }

    const nextSelectionId = activeSelectionRef.current + 1;
    activeSelectionRef.current = nextSelectionId;
    if (isPerfLoggingEnabled()) {
      const markName = `abstractGenerator.selectCard.${nextSelectionId}`;
      pendingSelectionPerfRef.current = {
        col,
        markName,
        row,
        selectionId: nextSelectionId,
      };
      markPerf(markName);
      logPerf("abstractGenerator.selectCard", {
        col,
        row,
        rowCount: currentTree.length,
        selectionId: nextSelectionId,
        totalCardCount: currentTree.reduce((count, generation) => count + generation.length, 0),
      });
    }

    const transition = reduce(stateRef.current, {
      type: "select",
      row,
      col,
    });

    stateRef.current = transition.state;
    setState(transition.state);

    schedulePostSelectionWork(() => {
      void runEffects(
        transition.effects,
        activeLifecycleRef.current,
        nextSelectionId,
      );
    });
  }, [reduce, runEffects]);

  useLayoutEffect(() => {
    if (!generatorHandleRef) {
      return;
    }

    generatorHandleRef.current = {
      scrollToCard: scrollToCardIndex,
      selectCard: handleCardSelect,
    };

    return () => {
      generatorHandleRef.current = null;
    };
  }, [generatorHandleRef, handleCardSelect, scrollToCardIndex]);

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
