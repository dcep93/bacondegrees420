import type { HTMLAttributes, ReactNode } from "react";
import { joinClassNames } from "./ui_utils";

type TooltipVariant = "bacon-inline" | "bacon-panel" | "cinenerdle-inline";
type TooltipPlacement =
  | "bottom-center"
  | "left"
  | "right"
  | "right-center"
  | "top-center";

function getTooltipEntries(content: string | string[]): string[] {
  return (Array.isArray(content) ? content : content.split("\n"))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isStringArray(content: ReactNode | string[]): content is string[] {
  return Array.isArray(content) && content.every((entry) => typeof entry === "string");
}

export default function Tooltip({
  anchorClassName,
  anchorProps,
  children,
  content,
  placement = "bottom-center",
  tooltipClassName,
  variant = "bacon-panel",
  wrapperTag = "span",
}: {
  anchorClassName?: string;
  anchorProps?: HTMLAttributes<HTMLDivElement | HTMLSpanElement>;
  children: ReactNode;
  content: ReactNode | string | string[] | null | undefined;
  placement?: TooltipPlacement;
  tooltipClassName?: string;
  variant?: TooltipVariant;
  wrapperTag?: "div" | "span";
}) {
  if (!content) {
    return <>{children}</>;
  }

  const WrapperTag = wrapperTag;
  const stringEntries =
    typeof content === "string" || isStringArray(content)
      ? getTooltipEntries(content)
      : null;

  if (stringEntries && stringEntries.length === 0) {
    return <>{children}</>;
  }

  const anchorBaseClassName = variant === "cinenerdle-inline"
    ? "cinenerdle-card-chip-tooltip-anchor"
    : "bacon-fancy-tooltip-anchor";
  const tooltipBaseClassName = variant === "cinenerdle-inline"
    ? joinClassNames(
        "cinenerdle-card-inline-tooltip",
        `cinenerdle-card-inline-tooltip-${placement === "left" ? "left" : "right"}`,
      )
    : joinClassNames(
        variant === "bacon-inline"
          ? "bacon-inline-tooltip"
          : "bacon-connection-pill-tooltip",
        "bacon-fancy-tooltip",
        `bacon-fancy-tooltip-${placement}`,
      );
  const entryClassName = variant === "bacon-inline"
    ? "bacon-inline-tooltip-entry"
    : "bacon-connection-pill-tooltip-entry";

  return (
    <WrapperTag
      className={joinClassNames(anchorBaseClassName, anchorClassName)}
      {...anchorProps}
    >
      {children}
      <span
        className={joinClassNames(tooltipBaseClassName, tooltipClassName)}
        role="tooltip"
      >
        {stringEntries
          ? stringEntries.map((entry, index) => (
              <span className={entryClassName} key={`${index}:${entry}`}>
                {entry}
              </span>
            ))
          : content}
      </span>
    </WrapperTag>
  );
}
