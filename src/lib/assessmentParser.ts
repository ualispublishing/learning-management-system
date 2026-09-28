/**
 * @fileoverview src/lib/assessmentParser.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { QuizQuestion, AnswerType } from '../types/lms';
import { createEntityId } from './id';

export function parseAssessmentText(text: string): QuizQuestion[] {
  if (!text) return [];

  // Split by "Q<something>: ===="
  // Example: "Q1: ====" or "Question 2: ====" or just "Q: ===="
  const blocks = text.split(/Q.*?:[\s]*====/g);
  
  const questions: QuizQuestion[] = [];
  let qIndex = 1;

  // The first element might be empty or preamble if the text starts with Q1: ====
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let type: AnswerType = 'text';
    let content = '';
    let options: string[] = [];
    let correctAnswer: string | undefined = undefined;
    let points = 10;
    const customConfig: any = {};

    let currentKey = 'Content';

    for (const line of lines) {
      const match = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (match) {
        const key = match[1].toLowerCase();
        const value = match[2].trim();

        if (key === 'type') {
          const t = value.toLowerCase();
          if (t === 'multiple_choice' || t === 'mcq') type = 'multiple_choice';
          else if (t === 'text' || t === 'text_box') type = 'text';
          else if (t === 'dropbox' || t === 'file') type = 'dropbox';
          else if (t === 'timed') type = 'timed';
          else if (t === 'spectrum') type = 'spectrum';
          else if (t === 'code' || t === 'custom_code') type = 'custom_code';
          else if (t === 'page_break') type = 'page_break';
          currentKey = key;
        } else if (key === 'options') {
          options = value.split(',').map(s => s.trim());
          currentKey = key;
        } else if (key === 'correct') {
          correctAnswer = value;
          currentKey = key;
        } else if (key === 'points') {
          points = parseInt(value, 10) || 10;
          currentKey = key;
        } else if (key === 'content') {
          content = value;
          currentKey = key;
        } else if (key === 'timerseconds') {
          customConfig.timerSeconds = parseInt(value, 10) || 30;
          currentKey = key;
        } else if (key === 'min') {
          customConfig.min = parseInt(value, 10) || 1;
          currentKey = key;
        } else if (key === 'max') {
          customConfig.max = parseInt(value, 10) || 10;
          currentKey = key;
        } else {
          // Unrecognized key, append to current block if it's multiline content
          if (currentKey === 'content') content += '\n' + line;
        }
      } else {
        // No colon match, probably a multiline continuation
        if (currentKey === 'content') {
          content += '\n' + line;
        }
      }
    }

    questions.push({
      id: createEntityId('q'),
      label: type === 'page_break' ? '' : `${qIndex++}`,
      content: type === 'page_break' ? 'Page Break' : (content || 'Untitled Question'),
      answerType: type,
      options,
      correctAnswer,
      points,
      customConfig: Object.keys(customConfig).length > 0 ? customConfig : undefined
    });
  }

  return questions;
}
