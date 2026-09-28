import React from 'react';
import Markdown from 'react-native-markdown-display';
import { Text } from 'react-native';

const rules = {
  link: (node: any, children: any) => {
    return <Text style={{ color: 'red' }}>{children}</Text>;
  }
};

const output = Markdown({ rules, children: '[Red Text](#color:#EF4444)' });
console.log(output);
