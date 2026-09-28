/**
 * @fileoverview src/components/lms/NumericInput.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { TextInput, TextInputProps } from 'react-native';

type NumericInputProps = Omit<TextInputProps, 'value' | 'defaultValue' | 'onChangeText' | 'keyboardType'> & {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
};

/**
 * Keeps incomplete numeric text (for example `0.`) editable while committing
 * every complete value to the owning form. Invalid or empty text reverts on blur.
 */
export const NumericInput = ({
  value,
  onCommit,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  integer = false,
  onBlur,
  onFocus,
  ...props
}: NumericInputProps) => {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      {...props}
      value={focused ? draft : String(value)}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      onFocus={event => {
        setDraft(String(value));
        setFocused(true);
        onFocus?.(event);
      }}
      onChangeText={next => {
        const normalized = next.replace(',', '.');
        const sign = min < 0 ? '-?' : '';
        const pattern = new RegExp(integer ? `^${sign}\\d*$` : `^${sign}\\d*(?:\\.\\d*)?$`);
        if (!pattern.test(normalized)) return;
        setDraft(normalized);
        if (!normalized || normalized === '.' || normalized === '-' || normalized === '-.') return;
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) return;
        const bounded = Math.min(max, Math.max(min, integer ? Math.trunc(parsed) : parsed));
        onCommit(bounded);
      }}
      onBlur={event => {
        const parsed = Number(draft);
        if (!draft || draft === '.' || draft === '-' || draft === '-.' || !Number.isFinite(parsed)) setDraft(String(value));
        else setDraft(String(Math.min(max, Math.max(min, integer ? Math.trunc(parsed) : parsed))));
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
};
