import type {
  AriaRole,
  KeyboardEvent,
  MouseEvent,
} from "react";
import { CardTitle } from "../../components/card_ui";
import { handleIsolatedClick, joinClassNames } from "../../components/ui_utils";
import { FooterChips } from "./entity_card/chips";
import type { RenderableCinenerdleEntityCard } from "./entity_card/types";

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

export function CinenerdleEntityCard({
  card,
  ariaPressed,
  className,
  onCardClick,
  onCardKeyDown,
  onTitleClick,
  role,
  tabIndex,
  titleElement = "p",
}: {
  card: RenderableCinenerdleEntityCard;
  ariaPressed?: boolean;
  className?: string;
  onCardClick?: (event: MouseEvent<HTMLElement>) => void;
  onCardKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onTitleClick?: (event: MouseEvent<HTMLElement>) => void;
  role?: AriaRole;
  tabIndex?: number;
  titleElement?: "button" | "p";
}) {
  const creditLines =
    card.creditLines && card.creditLines.length > 0
      ? card.creditLines
      : [{ subtitle: card.subtitle, subtitleDetail: card.subtitleDetail }];

  return (
    <article
      aria-pressed={ariaPressed}
      className={joinClassNames(
        "cinenerdle-card",
        card.isSelected && "cinenerdle-card-selected",
        card.isLocked && "cinenerdle-card-locked",
        card.isAncestorSelected && "cinenerdle-card-ancestor-selected",
        className,
      )}
      onClick={onCardClick}
      onKeyDown={onCardKeyDown}
      role={role}
      tabIndex={tabIndex}
    >
      <div className="cinenerdle-card-image-shell">
        {card.imageUrl ? (
          <img
            alt={card.name}
            className="cinenerdle-card-image"
            loading="lazy"
            src={card.imageUrl}
          />
        ) : (
          <div className="cinenerdle-card-image cinenerdle-card-image-fallback">
            {card.name}
          </div>
        )}
      </div>

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
        <div className="cinenerdle-card-copy-spacer" />
        <div className="cinenerdle-card-secondary">
          {creditLines.map((line, index) => (
            <div
              className="cinenerdle-card-credit-line"
              key={`${line.subtitle}:${line.subtitleDetail}:${index}`}
            >
              <p className="cinenerdle-card-subtitle">{line.subtitle}</p>
              {line.subtitleDetail ? (
                <p className="cinenerdle-card-detail">{line.subtitleDetail}</p>
              ) : null}
            </div>
          ))}
        </div>
        <FooterChips card={card} />
      </div>
    </article>
  );
}
