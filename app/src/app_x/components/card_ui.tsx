import type { MouseEvent, ReactNode } from "react";

export function CardTitle({
  children,
  className,
  onClick,
  as = "button",
}: {
  children: ReactNode;
  className: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  as?: "button" | "p";
}) {
  if (as === "p") {
    return (
      <p
        className={className}
        onClick={onClick}
      >
        {children}
      </p>
    );
  }

  return (
    <button
      className={className}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
