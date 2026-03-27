import { useCallback } from "react";
import { AbstractGenerator } from "../../components/abstract_generator";
import { useCinenerdleController } from "./controller";
import { normalizeHashValue } from "./hash";
import "../../styles/cinenerdle2.css";

type Cinenerdle2Props = {
  hashValue: string;
  resetVersion: number;
};

function applyHash(nextHash: string) {
  const normalizedHash = normalizeHashValue(nextHash);

  if (!normalizedHash) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    window.dispatchEvent(new Event("hashchange"));
    return;
  }

  window.location.hash = normalizedHash.replace(/^#/, "");
}

export default function Cinenerdle2({
  hashValue,
  resetVersion,
}: Cinenerdle2Props) {
  const normalizedHash = normalizeHashValue(hashValue);
  const readHash = useCallback(() => normalizedHash, [normalizedHash]);
  const writeHash = useCallback((nextHash: string) => {
    applyHash(nextHash);
  }, []);

  const controller = useCinenerdleController({
    readHash,
    writeHash,
  });

  return (
    <AbstractGenerator
      afterCardSelected={controller.afterCardSelected}
      initTree={controller.initTree}
      renderCard={controller.renderCard}
      resetKey={`${resetVersion}:${normalizedHash}`}
    />
  );
}
