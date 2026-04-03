import { useRef, type FocusEvent, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { addCinenerdleDebugLog } from "../generators/cinenerdle2/debug_log";
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

function formatDebugRect(rect: DOMRect | ClientRect) {
  return {
    top: Number(rect.top.toFixed(2)),
    right: Number(rect.right.toFixed(2)),
    bottom: Number(rect.bottom.toFixed(2)),
    left: Number(rect.left.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
  };
}

function getClippingAncestors(element: HTMLElement | null) {
  const clippingAncestors: Array<{
    element: string;
    overflowX: string;
    overflowY: string;
    maxHeight: string;
    height: string;
  }> = [];

  let currentElement = element?.parentElement ?? null;
  while (currentElement) {
    const computedStyle = window.getComputedStyle(currentElement);
    const overflowX = computedStyle.overflowX;
    const overflowY = computedStyle.overflowY;
    const canClip =
      !["visible", "clip"].includes(overflowX) ||
      !["visible", "clip"].includes(overflowY);

    if (canClip) {
      const className =
        typeof currentElement.className === "string"
          ? currentElement.className.trim().replace(/\s+/g, ".")
          : "";
      clippingAncestors.push({
        element: `${currentElement.tagName.toLowerCase()}${className ? `.${className}` : ""}`,
        overflowX,
        overflowY,
        maxHeight: computedStyle.maxHeight,
        height: computedStyle.height,
      });
    }

    currentElement = currentElement.parentElement;
  }

  return clippingAncestors;
}

export default function Tooltip({
  anchorClassName,
  anchorProps,
  children,
  content,
  debugLogLabel,
  placement = "top-center",
  tooltipClassName,
  variant = "bacon-panel",
  wrapperTag = "span",
}: {
  anchorClassName?: string;
  anchorProps?: HTMLAttributes<HTMLDivElement | HTMLSpanElement>;
  children: ReactNode;
  content: ReactNode | string | string[] | null | undefined;
  debugLogLabel?: string;
  placement?: TooltipPlacement;
  tooltipClassName?: string;
  variant?: TooltipVariant;
  wrapperTag?: "div" | "span";
}) {
  const wrapperRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);

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

  function scheduleTooltipDebugLog(trigger: "focus" | "hover") {
    if (
      !debugLogLabel ||
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      return;
    }

    window.requestAnimationFrame(() => {
      const wrapperElement = wrapperRef.current;
      const tooltipElement = tooltipRef.current;
      if (!wrapperElement || !tooltipElement) {
        return;
      }

      const computedStyle = window.getComputedStyle(tooltipElement);
      addCinenerdleDebugLog(`tooltip:${debugLogLabel}`, {
        trigger,
        placement,
        wrapperRect: formatDebugRect(wrapperElement.getBoundingClientRect()),
        tooltipRect: formatDebugRect(tooltipElement.getBoundingClientRect()),
        tooltipMetrics: {
          clientHeight: tooltipElement.clientHeight,
          scrollHeight: tooltipElement.scrollHeight,
          offsetHeight: tooltipElement.offsetHeight,
          clientWidth: tooltipElement.clientWidth,
          scrollWidth: tooltipElement.scrollWidth,
          offsetWidth: tooltipElement.offsetWidth,
        },
        tooltipStyle: {
          maxHeight: computedStyle.maxHeight,
          height: computedStyle.height,
          overflow: computedStyle.overflow,
          overflowX: computedStyle.overflowX,
          overflowY: computedStyle.overflowY,
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        clippingAncestors: getClippingAncestors(wrapperElement),
      });
    });
  }

  const wrapperProps = {
    ...anchorProps,
    onFocus: (event: FocusEvent<HTMLDivElement | HTMLSpanElement>) => {
      anchorProps?.onFocus?.(event);
      scheduleTooltipDebugLog("focus");
    },
    onMouseEnter: (event: MouseEvent<HTMLDivElement | HTMLSpanElement>) => {
      anchorProps?.onMouseEnter?.(event);
      scheduleTooltipDebugLog("hover");
    },
  };

  return (
    <WrapperTag
      className={joinClassNames(anchorBaseClassName, anchorClassName)}
      ref={(element) => {
        wrapperRef.current = element as HTMLElement | null;
      }}
      {...wrapperProps}
    >
      {children}
      <span
        className={joinClassNames(tooltipBaseClassName, tooltipClassName)}
        ref={tooltipRef}
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
