import React, { createContext, useContext, useState, useCallback } from "react";

export interface IntroPathNode {
  id: number;
  name: string;
}

interface IntroPathState {
  /** The person initiating the intro (self) */
  fromId: number | null;
  /** The final target person */
  target: IntroPathNode | null;
  /** Intermediate hops (not including self or target) */
  chain: IntroPathNode[];
}

interface IntroPathContextValue {
  introPath: IntroPathState;
  setIntroPath: (path: IntroPathState) => void;
  clearIntroPath: () => void;
  /** All node IDs in the full chain (from → chain → target) */
  allNodeIds: Set<number>;
  /** All edge pairs [a,b] as "min,max" strings for highlighting */
  allEdgePairs: Set<string>;
  hasPath: boolean;
}

const EMPTY: IntroPathState = { fromId: null, target: null, chain: [] };

const IntroPathContext = createContext<IntroPathContextValue>({
  introPath: EMPTY,
  setIntroPath: () => {},
  clearIntroPath: () => {},
  allNodeIds: new Set(),
  allEdgePairs: new Set(),
  hasPath: false,
});

export function IntroPathProvider({ children }: { children: React.ReactNode }) {
  const [introPath, setIntroPathRaw] = useState<IntroPathState>(EMPTY);

  const setIntroPath = useCallback((path: IntroPathState) => {
    setIntroPathRaw(path);
  }, []);

  const clearIntroPath = useCallback(() => {
    setIntroPathRaw(EMPTY);
  }, []);

  // Compute derived values
  const fullChain: number[] = [];
  if (introPath.fromId != null) {
    fullChain.push(introPath.fromId);
    for (const hop of introPath.chain) fullChain.push(hop.id);
    if (introPath.target) fullChain.push(introPath.target.id);
  }

  const allNodeIds = new Set(fullChain);
  const allEdgePairs = new Set<string>();
  for (let i = 0; i < fullChain.length - 1; i++) {
    const a = fullChain[i], b = fullChain[i + 1];
    allEdgePairs.add(`${Math.min(a, b)},${Math.max(a, b)}`);
  }

  const hasPath = fullChain.length >= 2;

  return (
    <IntroPathContext.Provider value={{ introPath, setIntroPath, clearIntroPath, allNodeIds, allEdgePairs, hasPath }}>
      {children}
    </IntroPathContext.Provider>
  );
}

export function useIntroPath() {
  return useContext(IntroPathContext);
}
