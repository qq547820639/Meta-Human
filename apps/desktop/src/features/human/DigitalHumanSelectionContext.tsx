import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { DigitalHumanData } from "../../api/contracts";

/**
 * Single, observable source of truth for the currently selected / default
 * digital human. It is shared by startup restore, the management page, the
 * conversation workspace and the creation/rebuild flow so that switching the
 * default refreshes the main conversation immediately without a restart.
 *
 * The previous code kept a write-only `selectedHumanId` in `App.tsx` that was
 * never read. Here the selection is a real, observable state: any subscriber
 * re-renders when `selectHuman` is called.
 */

export interface SelectedHumanState {
  readonly id: string | null;
  readonly name: string;
  readonly portraitPath: string | null;
  readonly streamUrl: string | null;
  readonly avatarId: string | null;
  readonly voiceId: string | null;
}

export const emptySelection: SelectedHumanState = {
  id: null,
  name: "",
  portraitPath: null,
  streamUrl: null,
  avatarId: null,
  voiceId: null,
};

export interface DigitalHumanSelectionValue {
  readonly selected: SelectedHumanState;
  readonly selectedHumanId: string | null;
  readonly selectHuman: (human: SelectedHumanState) => void;
  readonly clearSelection: () => void;
}

/** Builds a selection state from a full `DigitalHumanData` contract object. */
export function selectionFromHuman(
  human: DigitalHumanData,
  streamUrl: string | null = null,
): SelectedHumanState {
  return {
    id: human.id,
    name: human.name,
    portraitPath: human.portrait_path,
    streamUrl,
    avatarId: human.avatar_id,
    voiceId: human.voice_id,
  };
}

const DigitalHumanSelectionContext =
  createContext<DigitalHumanSelectionValue | null>(null);

export function DigitalHumanSelectionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [selected, setSelected] = useState<SelectedHumanState>(emptySelection);

  const value = useMemo<DigitalHumanSelectionValue>(
    () => ({
      selected,
      selectedHumanId: selected.id,
      selectHuman: setSelected,
      clearSelection: () => setSelected(emptySelection),
    }),
    [selected],
  );

  return (
    <DigitalHumanSelectionContext.Provider value={value}>
      {children}
    </DigitalHumanSelectionContext.Provider>
  );
}

export function useDigitalHumanSelection(): DigitalHumanSelectionValue {
  const ctx = useContext(DigitalHumanSelectionContext);
  if (ctx === null) {
    throw new Error(
      "useDigitalHumanSelection must be used within DigitalHumanSelectionProvider",
    );
  }
  return ctx;
}