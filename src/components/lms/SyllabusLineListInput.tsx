import React, { useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

type Props = Omit<TextInputProps, 'value' | 'defaultValue' | 'onChangeText' | 'onBlur'> & {
  values: string[];
  onChangeValues: (values: string[]) => void;
};

/** Keep spaces and the next empty line while typing; store normalized entries. */
export function SyllabusLineListInput({ values, onChangeValues, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return <TextInput {...props} multiline value={draft ?? values.join('\n')}
    onChangeText={text => {
      setDraft(text);
      onChangeValues(text.split('\n').map(line => line.trim()).filter(Boolean));
    }}
    onBlur={() => setDraft(null)}
  />;
}
