import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { CardTitle } from "../../components/card_ui";
import { handleIsolatedClick, joinClassNames } from "../../components/ui_utils";
import { FooterChips } from "./entity_card/chips";
import type { RenderableCinenerdleEntityCard } from "./entity_card/types";
import { formatRemovedItemAttrMessage, getAcceptedItemAttrInput } from "./entity_card_helpers";
import { getCinenerdleItemAttrCounts } from "./entity_card_ordering";
import {
  CINENERDLE_ITEM_ATTRS_UPDATED_EVENT,
  addItemAttrToTarget,
  getCinenerdleItemAttrTargetFromCard,
  getItemAttrsForTarget,
  removeItemAttrFromTarget,
} from "./item_attrs";
import type { GeneratorCardRowOrderMetadata } from "../../types/generator";

export type { RenderableCinenerdleEntityCard } from "./entity_card/types";

export function CinenerdleBreakBar({
  className,
  label = "ESCAPE",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      aria-label={label}
      className={joinClassNames(
        "cinenerdle-break-bar",
        className,
      )}
      role="separator"
    >
      <span className="cinenerdle-break-bar-label">{label}</span>
    </div>
  );
}

function CinenerdleExtraChip({
  itemAttr,
  itemName,
  onRemove,
  passive = false,
}: {
  itemAttr: string;
  itemName: string;
  onRemove?: (() => void) | null;
  passive?: boolean;
}) {
  return (
    <button
      aria-label={passive ? undefined : `Remove ${itemAttr} from ${itemName}`}
      className={joinClassNames(
        "cinenerdle-card-extra-chip",
        passive && "cinenerdle-card-extra-chip-passive",
      )}
      disabled={passive}
      onClick={onRemove
        ? (event) => {
          handleIsolatedClick(event, () => {
            onRemove();
          });
        }
        : undefined}
      type="button"
    >
      {itemAttr}
    </button>
  );
}

export function CinenerdleEntityCard({
  card,
  className,
  connectedItemAttrSources = [],
  imageFetchPriority = "auto",
  imageLoading = "lazy",
  onItemAttrCountsChange = null,
  onCardClick,
  onTitleClick,
  titleElement = "p",
}: {
  card: RenderableCinenerdleEntityCard;
  className?: string;
  connectedItemAttrSources?: Array<{
    key: string;
    kind: "movie" | "person";
    name: string;
  }>;
  imageFetchPriority?: "auto" | "high";
  imageLoading?: "eager" | "lazy";
  onItemAttrCountsChange?: ((counts: GeneratorCardRowOrderMetadata | null) => void) | null;
  onCardClick?: (event: MouseEvent<HTMLElement>) => void;
  onTitleClick?: (event: MouseEvent<HTMLElement>) => void;
  titleElement?: "button" | "p";
}) {
  function toggleExtraInputVisibility() {
    setIsExtraInputVisible((currentValue) => !currentValue);
  }

  function handleExtraButtonKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    toggleExtraInputVisibility();
  }

  const creditLines =
    card.creditLines && card.creditLines.length > 0
      ? card.creditLines
      : [{ subtitle: card.subtitle, subtitleDetail: card.subtitleDetail }];
  const isCinenerdleRootCard = card.kind === "cinenerdle";
  const [isExtraInputVisible, setIsExtraInputVisible] = useState(false);
  const [itemAttrsVersion, setItemAttrsVersion] = useState(0);
  const extraRowRef = useRef<HTMLDivElement | null>(null);
  const extraInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedConnectedItemAttrSources = useMemo(
    () => connectedItemAttrSources.filter((source, index, allSources) =>
      allSources.findIndex((candidate) => candidate.key === source.key) === index),
    [connectedItemAttrSources],
  );
  const itemAttrTarget = useMemo(
    () => (card.kind === "cinenerdle"
      ? null
      : getCinenerdleItemAttrTargetFromCard({
        key: card.key,
        kind: card.kind,
        name: card.name,
      })),
    [card.key, card.kind, card.name],
  );
  const connectedItemAttrSourceTargets = useMemo(
    () => resolvedConnectedItemAttrSources
      .map((source) => getCinenerdleItemAttrTargetFromCard(source))
      .filter((target): target is NonNullable<typeof target> => target !== null),
    [resolvedConnectedItemAttrSources],
  );
  const itemAttrs = useMemo(
    () => {
      void itemAttrsVersion;
      return itemAttrTarget ? getItemAttrsForTarget(itemAttrTarget) : [];
    },
    [itemAttrTarget, itemAttrsVersion],
  );
  const connectedItemAttrs = useMemo(
    () => {
      void itemAttrsVersion;
      return connectedItemAttrSourceTargets.reduce<string[]>((allItemAttrs, target) => {
        getItemAttrsForTarget(target).forEach((itemAttr) => {
          if (!allItemAttrs.includes(itemAttr)) {
            allItemAttrs.push(itemAttr);
          }
        });
        return allItemAttrs;
      }, []);
    },
    [connectedItemAttrSourceTargets, itemAttrsVersion],
  );
  const inheritedItemAttrs = useMemo(
    () => connectedItemAttrs.filter((itemAttr) => !itemAttrs.includes(itemAttr)),
    [connectedItemAttrs, itemAttrs],
  );
  const itemAttrCounts = useMemo(
    () => getCinenerdleItemAttrCounts(itemAttrs, inheritedItemAttrs),
    [inheritedItemAttrs, itemAttrs],
  );

  useEffect(() => {
    if (!isExtraInputVisible) {
      return;
    }

    function handleDocumentClick(event: Event) {
      if (extraRowRef.current?.contains(event.target as Node | null)) {
        return;
      }

      setIsExtraInputVisible(false);
    }

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [isExtraInputVisible]);

  useEffect(() => {
    function handleItemAttrsUpdated() {
      setItemAttrsVersion((version) => version + 1);
    }

    window.addEventListener(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, handleItemAttrsUpdated);
    return () => {
      window.removeEventListener(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, handleItemAttrsUpdated);
    };
  }, []);

  useEffect(() => {
    if (!isExtraInputVisible) {
      return;
    }

    extraInputRef.current?.focus();
  }, [isExtraInputVisible]);

  useEffect(() => {
    onItemAttrCountsChange?.(itemAttrCounts);
  }, [itemAttrCounts, onItemAttrCountsChange]);

  return (
    <article
      className={joinClassNames(
        "cinenerdle-card",
        isCinenerdleRootCard && "cinenerdle-card-root",
        card.isSelected && "cinenerdle-card-selected",
        card.isLocked && "cinenerdle-card-locked",
        card.isAncestorSelected && "cinenerdle-card-ancestor-selected",
        className,
      )}
      onClick={onCardClick}
    >
      <div className="cinenerdle-card-image-shell">
        {card.imageUrl ? (
          <img
            alt={card.name}
            className="cinenerdle-card-image"
            decoding="async"
            fetchPriority={imageFetchPriority}
            loading={imageLoading}
            src={card.imageUrl}
          />
        ) : (
          <div className="cinenerdle-card-image cinenerdle-card-image-fallback">
            {card.name}
          </div>
        )}
      </div>

      {isCinenerdleRootCard ? null : (
        <div className="cinenerdle-card-copy">
          <CardTitle
            as={onTitleClick && titleElement === "button" ? "button" : "p"}
            className="cinenerdle-card-title"
            onClick={onTitleClick
              ? (event) => {
                handleIsolatedClick(event, onTitleClick);
              }
              : undefined}
          >
            {card.name}
          </CardTitle>
          <div className="cinenerdle-card-secondary">
            {creditLines.map((line, index) => (
              <div
                className="cinenerdle-card-credit-line"
                key={`${line.subtitle}:${line.subtitleDetail}:${index}`}
              >
                <p className="cinenerdle-card-subtitle">{line.subtitle}</p>
                <p className="cinenerdle-card-detail">{line.subtitleDetail ?? ""}</p>
              </div>
            ))}
          </div>
          <FooterChips card={card} />
        </div>
      )}
      {!isCinenerdleRootCard ? (
        <div className="cinenerdle-card-extra-row" ref={extraRowRef}>
          <div
            aria-label={`Toggle attrs for ${card.name}`}
            className="cinenerdle-card-extra-button"
            onKeyDown={handleExtraButtonKeyDown}
            onClick={(event) => {
              handleIsolatedClick(event, toggleExtraInputVisibility);
            }}
            role="button"
            tabIndex={0}
          >
            +
          </div>
          {isExtraInputVisible ? (
            <input
              aria-label={`Add attr for ${card.name}`}
              className="cinenerdle-card-extra-input"
              onChange={(event) => {
                if (!itemAttrTarget) {
                  return;
                }

                const nextChar = getAcceptedItemAttrInput(event.target.value, itemAttrs);
                event.target.value = "";
                if (!nextChar) {
                  return;
                }

                addItemAttrToTarget(itemAttrTarget, nextChar);
                setIsExtraInputVisible(false);
              }}
              ref={extraInputRef}
              type="text"
            />
          ) : (
            <div className="cinenerdle-card-extra-copy">
              {itemAttrs.map((itemAttr) => (
                <CinenerdleExtraChip
                  key={itemAttr}
                  itemAttr={itemAttr}
                  itemName={card.name}
                  onRemove={() => {
                      if (!itemAttrTarget) {
                        return;
                      }

                      removeItemAttrFromTarget(itemAttrTarget, itemAttr);
                      if (typeof window !== "undefined" && typeof window.alert === "function") {
                        window.alert(formatRemovedItemAttrMessage(itemAttr, card.name));
                      }
                  }}
                />
              ))}
              {inheritedItemAttrs.map((itemAttr) => (
                <CinenerdleExtraChip
                  key={`inherited:${itemAttr}`}
                  itemAttr={itemAttr}
                  itemName={card.name}
                  passive
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
