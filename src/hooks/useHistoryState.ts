/**
 * @fileoverview src/hooks/useHistoryState.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { useState, useCallback } from 'react';

export const MAX_HISTORY_ENTRIES = 100;

export function useHistoryState<T>(initialValue: T) {
  const [state, setState] = useState<{
    past: T[];
    present: T;
    future: T[];
  }>({
    past: [],
    present: initialValue,
    future: [],
  });

  const set = useCallback((newPresent: T) => {
    setState((currentState) => {
      if (currentState.present === newPresent) {
        return currentState;
      }
      return {
        past: [...currentState.past.slice(-(MAX_HISTORY_ENTRIES - 1)), currentState.present],
        present: newPresent,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setState((currentState) => {
      if (currentState.past.length === 0) return currentState;

      const previous = currentState.past[currentState.past.length - 1];
      const newPast = currentState.past.slice(0, currentState.past.length - 1);

      return {
        past: newPast,
        present: previous,
        future: [currentState.present, ...currentState.future].slice(0, MAX_HISTORY_ENTRIES),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((currentState) => {
      if (currentState.future.length === 0) return currentState;

      const next = currentState.future[0];
      const newFuture = currentState.future.slice(1);

      return {
        past: [...currentState.past.slice(-(MAX_HISTORY_ENTRIES - 1)), currentState.present],
        present: next,
        future: newFuture,
      };
    });
  }, []);

  const reset = useCallback((newPresent: T) => {
    setState({
      past: [],
      present: newPresent,
      future: [],
    });
  }, []);

  return {
    state: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
