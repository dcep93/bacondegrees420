import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { joinClassNames } from "./ui_utils";

type TooltipVariant = "bacon-inline" | "bacon-panel" | "cinenerdle-inline";
type TooltipPlacement =
  | "bottom-center"
  | "left"
  | "right"
  | "right-center"
  | "top-center";

type FixedTooltipPosition = {
  left: number;
  top: number;
};

function getFixedTooltipAnchorPosition(
  anchorRect: DOMRect,
  placement: TooltipPlacement,
): FixedTooltipPosition {
  switch (placement) {
    case "bottom-center":
      return {
        left: anchorRect.left + (anchorRect.width / 2),
        top: anchorRect.bottom + 10,
      };
    case "left":
      return {
        left: anchorRect.left - 10,
        top: anchorRect.top + (anchorRect.height / 2),
      };
    case "right":
    case "right-center":
      return {
        left: anchorRect.right + 10,
        top: anchorRect.top + (anchorRect.height / 2),
      };
    case "top-center":
    default:
      return {
        left: anchorRect.left + (anchorRect.width / 2),
        top: anchorRect.top - 10,
      };
  }
}

function getFixedTooltipTransform(
  placement: TooltipPlacement,
  isVisible: boolean,
): string {
  switch (placement) {
    case "bottom-center":
      return isVisible ? "translate(-50%, 0)" : "translate(-50%, 4px)";
    case "left":
      return isVisible ? "translate(-100%, -50%)" : "translate(calc(-100% - 4px), -50%)";
    case "right":
    case "right-center":
      return isVisible ? "translate(0, -50%)" : "translate(4px, -50%)";
    case "top-center":
    default:
      return isVisible ? "translate(-50%, -100%)" : "translate(-50%, calc(-100% - 4px))";
  }
}

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
  placement = "top-center",
  tooltipClassName,
  useFixedPosition = false,
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
  useFixedPosition?: boolean;
  variant?: TooltipVariant;
  wrapperTag?: "div" | "span";
}) {
  const wrapperRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [fixedTooltipPosition, setFixedTooltipPosition] = useState<FixedTooltipPosition | null>(null);
  const stringEntries =
    typeof content === "string" || isStringArray(content)
      ? getTooltipEntries(content)
      : null;

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
  const usesFixedPosition = useFixedPosition && variant !== "cinenerdle-inline";
  const WrapperTag = wrapperTag;

  function syncFixedTooltipPosition() {
    if (!usesFixedPosition || !wrapperRef.current) {
      return;
    }

    const anchorRect = wrapperRef.current.getBoundingClientRect();
    setFixedTooltipPosition(getFixedTooltipAnchorPosition(anchorRect, placement));
  }

  useEffect(() => {
    if (!usesFixedPosition || !isTooltipVisible) {
      return;
    }

    function handleViewportChange() {
      if (!wrapperRef.current) {
        return;
      }

      const anchorRect = wrapperRef.current.getBoundingClientRect();
      setFixedTooltipPosition(getFixedTooltipAnchorPosition(anchorRect, placement));
    }

    handleViewportChange();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isTooltipVisible, placement, usesFixedPosition]);

  if (!content) {
    return <>{children}</>;
  }

  if (stringEntries && stringEntries.length === 0) {
    return <>{children}</>;
  }

  const tooltipStyle: CSSProperties | undefined = usesFixedPosition
    ? {
        bottom: "auto",
        left: fixedTooltipPosition ? `${fixedTooltipPosition.left}px` : "0px",
        opacity: isTooltipVisible ? 1 : 0,
        pointerEvents: isTooltipVisible ? "auto" : "none",
        position: "fixed",
        right: "auto",
        top: fixedTooltipPosition ? `${fixedTooltipPosition.top}px` : "0px",
        transform: getFixedTooltipTransform(placement, isTooltipVisible),
        visibility: isTooltipVisible ? "visible" : "hidden",
        zIndex: 200,
      }
    : undefined;

  const wrapperProps = {
    ...anchorProps,
    onFocus: (event: FocusEvent<HTMLDivElement | HTMLSpanElement>) => {
      anchorProps?.onFocus?.(event);
      if (usesFixedPosition) {
        syncFixedTooltipPosition();
        setIsTooltipVisible(true);
      }
    },
    onBlur: (event: FocusEvent<HTMLDivElement | HTMLSpanElement>) => {
      anchorProps?.onBlur?.(event);
      if (usesFixedPosition) {
        setIsTooltipVisible(false);
      }
    },
    onMouseEnter: (event: MouseEvent<HTMLDivElement | HTMLSpanElement>) => {
      anchorProps?.onMouseEnter?.(event);
      if (usesFixedPosition) {
        syncFixedTooltipPosition();
        setIsTooltipVisible(true);
      }
    },
    onMouseLeave: (event: MouseEvent<HTMLDivElement | HTMLSpanElement>) => {
      anchorProps?.onMouseLeave?.(event);
      if (usesFixedPosition) {
        setIsTooltipVisible(false);
      }
    },
  };

  const tooltipElement = (
    <span
      className={joinClassNames(tooltipBaseClassName, tooltipClassName)}
      ref={tooltipRef}
      role="tooltip"
      style={tooltipStyle}
    >
      {stringEntries
        ? stringEntries.map((entry, index) => (
            <span className={entryClassName} key={`${index}:${entry}`}>
              {entry}
            </span>
          ))
        : content}
    </span>
  );

  return (
    <WrapperTag
      className={joinClassNames(anchorBaseClassName, anchorClassName)}
      ref={(element) => {
        wrapperRef.current = element as HTMLElement | null;
      }}
      {...wrapperProps}
    >
      {children}
      {usesFixedPosition && typeof document !== "undefined"
        ? createPortal(tooltipElement, document.body)
        : tooltipElement}
    </WrapperTag>
  );
}
