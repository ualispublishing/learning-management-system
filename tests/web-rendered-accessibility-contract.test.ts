import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(path, 'utf8');

test('web-only accessibility state is emitted as native ARIA attributes', async () => {
  const [layout, studentFeed, bottomBar, cardDisplay, proficiencyKnob, newDeck, roster, chat] = await Promise.all([
    source('src/app/_layout.tsx'),
    source('src/components/lms/StudentFeed.tsx'),
    source('src/components/ui/BottomBar.tsx'),
    source('src/components/ui/CardDisplay.tsx'),
    source('src/components/ui/ProficiencyKnob.tsx'),
    source('src/app/deck/new.tsx'),
    source('src/app/admin/course/[id]/roster.tsx'),
    source('src/app/(tabs)/chat.tsx'),
  ]);

  assert.match(layout, /'aria-valuemin': MIN_APP_CONTENT_WIDTH/);
  assert.match(layout, /'aria-valuemax': viewportCanvasMaximum/);
  assert.match(layout, /'aria-valuenow': displayedAppContentWidth/);

  assert.match(studentFeed, /'aria-hidden': !isActive/);
  assert.match(studentFeed, /'aria-selected': currentPage === idx/);
  assert.match(studentFeed, /tabIndex: currentPage === idx \? 0 : -1/);
  assert.match(studentFeed, /activateFromKeyboard/);

  assert.match(bottomBar, /'aria-hidden': isRevealed/);
  assert.match(bottomBar, /'aria-hidden': !isRevealed/);
  assert.match(cardDisplay, /showRevealControl && !isRevealed/);
  assert.doesNotMatch(cardDisplay, /<Pressable[\s\S]{0,250}accessibilityLabel="Reveal answer"[\s\S]{0,250}<Animated\.View/);
  assert.match(proficiencyKnob, /'aria-valuenow': Math\.round\(value\)/);
  assert.match(proficiencyKnob, /tabIndex: 0/);
  assert.match(proficiencyKnob, /onKeyDown:/);
  assert.doesNotMatch(newDeck, /<BackButton/);
  assert.match(roster, /<Text accessibilityRole="header" style=\{\[styles\.title/);
  assert.match(roster, /Only course administrators can change IT or Administrator memberships/);
  assert.match(chat, /const clearDeepLinkRoute = \(\) =>/);
  assert.match(chat, /router\.replace\('\/chat'\)/);
  assert.match(chat, /<Text accessibilityRole="header" style=\{\[styles\.mainHeaderTitle/);
  assert.match(chat, /<Text accessibilityRole="header" style=\{\[styles\.sectionTitle/);
});
