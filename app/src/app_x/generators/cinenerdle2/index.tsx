import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AbstractGenerator } from "../../components/abstract_generator";
import { useCinenerdleController } from "./controller";
import { normalizeHashValue } from "./hash";
import { primeTmdbApiKeyOnInit } from "./tmdb";
import "../../styles/cinenerdle2.css";

type Cinenerdle2Props = {
  hashValue: string;
  navigationVersion: number;
  onHashWrite: (nextHash: string, mode: "selection" | "navigation") => void;
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

const Cinenerdle2 = memo(function Cinenerdle2({
  hashValue,
  navigationVersion,
  onHashWrite,
  resetVersion,
}: Cinenerdle2Props) {
  const normalizedHash = normalizeHashValue(hashValue);
  const hashRef = useRef(normalizedHash);

  useLayoutEffect(() => {
    hashRef.current = normalizedHash;
  }, [normalizedHash]);

  useEffect(() => {
    primeTmdbApiKeyOnInit();
  }, []);

  const readHash = useCallback(() => hashRef.current, []);
  const writeHash = useCallback(
    (nextHash: string, mode: "selection" | "navigation" = "navigation") => {
      const normalizedNextHash = normalizeHashValue(nextHash);
      const currentHash = normalizeHashValue(window.location.hash);

      if (normalizedNextHash === currentHash) {
        return;
      }

      onHashWrite(normalizedNextHash, mode);
      applyHash(normalizedNextHash);
    },
    [onHashWrite],
  );

  const controller = useCinenerdleController({
    readHash,
    writeHash,
  });

  return (
    <AbstractGenerator
      afterCardSelected={controller.afterCardSelected}
      initTree={controller.initTree}
      renderCard={controller.renderCard}
      resetKey={`${resetVersion}:${navigationVersion}`}
    />
  );
});

export default Cinenerdle2;
