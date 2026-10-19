/** Fixed local destinations: never accept a URL or arbitrary path from sign-in parameters. */
export const DEMO_DESTINATIONS = [
  { key: 'courses', path: '/admin', title: 'Courses & teaching', detail: 'Choose Teacher or Admin for syllabus import, materials, assessments, grading, roster and course settings. Choose Student A to show the learner experience.' },
  { key: 'timeline', path: '/admin/course/c1', title: 'Timeline course', detail: 'Explore the course feed, author content, then switch to Student Preview. Prepared source files are also available inside syllabus and material import.' },
  { key: 'sequential', path: '/admin/course/c2', title: 'Sequential course', detail: 'Explore ordered modules and the learner progression view.' },
  { key: 'linked', path: '/admin/course/c3', title: 'Linked learning site', detail: 'Open the course and use Student Preview to explore the bundled learning portal and Focus mode.' },
  { key: 'workspace', path: '/admin/course/c4', title: 'Interactive learning workspace', detail: 'Open Student Preview, then Algorithm Studio for the dashboard, code examples and visualizations.' },
  { key: 'learn', path: '/', title: 'Learn & flashcards', detail: 'Start with the four showcase decks. Choose a study session, reveal layers, add a note, or use Browse cards and Edit deck settings.' },
  { key: 'review', path: '/review', title: 'Review due cards', detail: 'Choose a due-card group to demonstrate spaced repetition. Personal progress is saved in this browser for the selected demo account.' },
  { key: 'stats', path: '/stats', title: 'Learning statistics', detail: 'Review personal study activity. Complete a review first to populate activity beyond the initial empty state.' },
  { key: 'new-deck', path: '/deck/new', title: 'Create a deck', detail: 'Create a personal deck, then add and edit cards from its card browser.' },
  { key: 'chat', path: '/chat', title: 'Chat & collaboration', detail: 'Open two tabs with different demo accounts. Choose the same course discussion to see messages arrive across sessions.' },
] as const;

export type DemoDestinationKey = typeof DEMO_DESTINATIONS[number]['key'];
export function resolveDemoDestination(value: unknown): typeof DEMO_DESTINATIONS[number]['path'] {
  return DEMO_DESTINATIONS.find(item => item.key === value)?.path ?? '/admin';
}
