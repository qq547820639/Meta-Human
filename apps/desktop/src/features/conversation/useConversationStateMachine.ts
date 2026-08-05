import { useReducer } from "react";

import {
  conversationUiReducer,
  initialConversationUiState,
  type ConversationUiAction,
  type ConversationUiState,
} from "./conversationStateMachine";

/**
 * Exposes the parallel conversation state machine. The UI distributes the
 * stream / DOM events into independent sub-state dimensions (generation, tts,
 * avatar, recording, network, restore) instead of overwriting a single phase.
 */
export function useConversationStateMachine(): {
  readonly ui: ConversationUiState;
  readonly dispatch: React.Dispatch<ConversationUiAction>;
} {
  const [ui, dispatch] = useReducer(
    conversationUiReducer,
    initialConversationUiState,
  );
  return { ui, dispatch };
}