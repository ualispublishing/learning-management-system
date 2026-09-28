/**
 * @fileoverview src/components/lms/ContentManager.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React from 'react';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { TimelineManager } from './TimelineManager';
import { SequentialManager } from './SequentialManager';
import { CustomManager } from './CustomManager';

export const ContentManager = ({ courseId }: { courseId: string }) => {
  const course = useLMSStore(state => state.courses.find(c => c.id === courseId));
  if (course?.presentationMode === 'sequential') return <SequentialManager courseId={courseId} />;
  if (course?.presentationMode === 'custom') {
    return <CustomManager courseId={courseId} />;
  }
  return <TimelineManager courseId={courseId} />;
}
