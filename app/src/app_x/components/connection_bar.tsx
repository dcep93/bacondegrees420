import type { FormEvent, KeyboardEvent, MouseEvent, Ref } from "react";
import Tooltip from "./tooltip";
import type { ConnectionSuggestion } from "../connection_search_state";
import { joinClassNames } from "./ui_utils";

export default function ConnectionBar({
  connectionInputWrapRef,
  connectionQuery,
  connectionSuggestions,
  highestGenerationSelectedLabel,
  isConnectionInputDisabled,
  isSearchablePersistencePending,
  onConnectionQueryChange,
  onInputKeyDown,
  onSubmit,
  onSuggestionClick,
  onSuggestionHover,
  selectedPathTooltipEntries,
  selectedSuggestionIndex,
}: {
  connectionInputWrapRef?: Ref<HTMLDivElement>;
  connectionQuery: string;
  connectionSuggestions: ConnectionSuggestion[];
  highestGenerationSelectedLabel: string;
  isConnectionInputDisabled: boolean;
  isSearchablePersistencePending: boolean;
  onConnectionQueryChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSuggestionClick: (event: MouseEvent<HTMLButtonElement>, suggestion: ConnectionSuggestion) => void;
  onSuggestionHover: (index: number) => void;
  selectedPathTooltipEntries: string[];
  selectedSuggestionIndex: number;
}) {
  return (
    <form className="bacon-connection-form" onSubmit={onSubmit}>
      <div className="bacon-connection-input-wrap" ref={connectionInputWrapRef}>
        <input
          autoCapitalize="words"
          autoCorrect="off"
          className="bacon-connection-input"
          disabled={isConnectionInputDisabled}
          onChange={(event) => onConnectionQueryChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={isSearchablePersistencePending
            ? "Building connections..."
            : "Connect to film or person"}
          type="text"
          value={connectionQuery}
        />
        {connectionSuggestions.length > 0 ? (
          <div className="bacon-connection-dropdown">
            {connectionSuggestions.map((suggestion, index) => (
              <button
                className={joinClassNames(
                  "bacon-connection-option",
                  suggestion.isConnectedToYoungestSelection && "bacon-connection-option-connected",
                  index === selectedSuggestionIndex && "bacon-connection-option-selected",
                )}
                key={suggestion.key}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onSuggestionHover(index)}
                onClick={(event) => onSuggestionClick(event, suggestion)}
                type="button"
              >
                <span className="bacon-connection-option-label">{suggestion.label}</span>
                {typeof suggestion.connectionOrderToYoungestSelection === "number" ? (
                  <span className="bacon-connection-option-badge">
                    {`#${suggestion.connectionOrderToYoungestSelection}`}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Tooltip content={selectedPathTooltipEntries} placement="top-center">
        <span className="bacon-connection-pill-wrap">
          <span className="bacon-connection-pill" tabIndex={0}>
            {highestGenerationSelectedLabel}
          </span>
        </span>
      </Tooltip>
    </form>
  );
}
