import type { HTMLAttributes, ReactNode } from "react";

type FancyTooltipPlacement =
  | "bottom-center"
  | "right-center"
  | "top-center";

function getTooltipEntries(content: string | string[]): string[] {
  const entries = Array.isArray(content)
    ? content
    : content.split("\n");

  return entries
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default function FancyTooltip({
  anchorProps,
  anchorClassName,
  children,
  content,
  placement = "bottom-center",
  tooltipClassName,
  variant = "panel",
  wrapperTag = "span",
}: {
  anchorProps?: HTMLAttributes<HTMLDivElement | HTMLSpanElement>;
  anchorClassName?: string;
  children: ReactNode;
  content: string | string[] | null | undefined;
  placement?: FancyTooltipPlacement;
  tooltipClassName?: string;
  variant?: "inline" | "panel";
  wrapperTag?: "div" | "span";
}) {
  if (!content) {
    return <>{children}</>;
  }

  const tooltipEntries = getTooltipEntries(content);
  if (tooltipEntries.length === 0) {
    return <>{children}</>;
  }

  const WrapperTag = wrapperTag;

  return (
    <WrapperTag
      className={[
        "bacon-fancy-tooltip-anchor",
        anchorClassName ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...anchorProps}
    >
      {children}
      <span
        className={[
          variant === "inline"
            ? "bacon-inline-tooltip"
            : "bacon-connection-pill-tooltip",
          "bacon-fancy-tooltip",
          `bacon-fancy-tooltip-${placement}`,
          tooltipClassName ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="tooltip"
      >
        {tooltipEntries.map((entry, index) => (
          <span
            className={variant === "inline"
              ? "bacon-inline-tooltip-entry"
              : "bacon-connection-pill-tooltip-entry"}
            key={`${index}:${entry}`}
          >
            {entry}
          </span>
        ))}
      </span>
    </WrapperTag>
  );
}
