/**
 * @fileoverview src/lib/db/seedProgrammingCourse.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type { Deck } from '../../types';
import { createEntityId } from '../id';
import { getFlashcardPrincipalId } from './principal';
import { CardStore, DeckStore, EditorStore } from './store';

export const LEARN_SHOWCASE_VERSION = 1;
export const PROGRAMMING_COURSE_VIDEO_URL = 'https://archive.org/download/MIT6.0001F16/MIT6_0001F16_Lecture_01_300k.mp4';

export const PROGRAMMING_COURSE_SOURCES = {
  course: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/',
  lecture1: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-1-what-is-computation/',
  lecture2: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-2-branching-and-iteration/',
  lecture3: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-3-string-manipulation-guess-and-check-approximations-bisection/',
  lecture4: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-4-decomposition-abstraction-and-functions/',
  lecture7: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-7-testing-debugging-exceptions-and-assertions/',
  pythonControlFlow: 'https://docs.python.org/3/tutorial/controlflow.html',
  pythonErrors: 'https://docs.python.org/3/tutorial/errors.html',
} as const;

type ShowcaseCard = {
  key: string;
  frontContent: string;
  layers: string[];
  initialUnlockedLayers?: number;
  tags: string[];
  color?: string;
  textColor?: string;
  starterNotes?: Record<string, { text: string }>;
};

type ShowcaseDeck = {
  key: string;
  name: string;
  description: string;
  cardColor: string;
  cardTextColor: string;
  bannerType?: string;
  courseIds?: string[];
  sources?: Record<string, string>;
  license?: string;
  cards: ShowcaseCard[];
};

export const LEARN_SHOWCASE_DEFINITIONS: ShowcaseDeck[] = [
  {
    key: 'programming-concept-ladder',
    name: 'Foundations of Programming · Concept Ladder',
    description: 'Course-linked Python concepts that reveal examples, reasoning, and transfer prompts one page at a time.',
    cardColor: '#E6F0FF',
    cardTextColor: '#102A43',
    courseIds: ['c1', 'c2'],
    sources: { ...PROGRAMMING_COURSE_SOURCES, video: PROGRAMMING_COURSE_VIDEO_URL },
    license: 'MIT OpenCourseWare links and video: CC BY-NC-SA 4.0; Python documentation links: PSF License Version 2.',
    cards: [
      {
        key: 'program-as-recipe',
        frontContent: 'What makes a program more precise than an everyday recipe?',
        layers: [
          'A program states operations in a form whose meaning is defined for the machine executing it.',
          '**Example:** “repeat until done” is ambiguous unless *done* has a testable condition.',
          `Course connection: [MIT OCW Lecture 1 — What is Computation?](${PROGRAMMING_COURSE_SOURCES.lecture1})`,
        ],
        initialUnlockedLayers: 1,
        tags: ['programming', 'computation', 'lecture-1', 'concept'],
        starterNotes: { '-1': { text: 'Add your own example of an ambiguous instruction here.' } },
      },
      {
        key: 'branching-trace',
        frontContent: 'Trace this branch: `temperature = 18`; if it is below 20, print “coat”, otherwise print “light layer”.',
        layers: [
          'It prints **coat** because `18 < 20` is true.',
          'The condition is evaluated first; exactly one branch in this `if`/`else` pair runs.',
          `Try changing the boundary, then compare with [MIT OCW Lecture 2](${PROGRAMMING_COURSE_SOURCES.lecture2}) and the [Python control-flow tutorial](${PROGRAMMING_COURSE_SOURCES.pythonControlFlow}).`,
        ],
        initialUnlockedLayers: 2,
        tags: ['programming', 'branching', 'trace', 'lecture-2'],
      },
      {
        key: 'loop-invariant',
        frontContent: 'A loop builds the sum of the first `n` positive integers. What useful invariant can you state?',
        layers: [
          'After processing `k`, the accumulator equals the sum of the integers from 1 through `k`.',
          'Initialization: before the first item, the accumulator is 0—the sum of an empty prefix.',
          'Maintenance: adding the next integer preserves the claim for the longer prefix.',
          'Termination: when `k = n`, the accumulator is the required total.',
        ],
        tags: ['programming', 'iteration', 'invariant', 'reasoning'],
      },
      {
        key: 'bisection-search',
        frontContent: 'Why does bisection search need an ordered search space?',
        layers: [
          'The midpoint comparison must tell us which half cannot contain the answer.',
          'Ordering makes that elimination valid; without it, a midpoint gives no information about either half.',
          'Each successful comparison roughly halves the remaining interval.',
          `Transfer prompt: sketch a boundary case, then visit [MIT OCW Lecture 3](${PROGRAMMING_COURSE_SOURCES.lecture3}).`,
        ],
        tags: ['programming', 'algorithms', 'bisection', 'lecture-3'],
      },
      {
        key: 'function-contract',
        frontContent: 'What belongs in a useful function contract?',
        layers: [
          'The expected inputs, the returned result, and important assumptions or side effects.',
          '**Precondition:** what callers must provide. **Postcondition:** what the function promises in return.',
          'A contract lets callers reason about behavior without reading every implementation detail.',
          `Course connection: [MIT OCW Lecture 4 — Decomposition, Abstraction, and Functions](${PROGRAMMING_COURSE_SOURCES.lecture4})`,
        ],
        tags: ['programming', 'functions', 'abstraction', 'lecture-4'],
      },
      {
        key: 'optional-course-media',
        frontContent: 'Optional media lab: What should you be able to explain after the opening computation lecture?',
        layers: [
          `[VIDEO:${PROGRAMMING_COURSE_VIDEO_URL}]`,
          `Text alternative: use the [official lecture page](${PROGRAMMING_COURSE_SOURCES.lecture1}) for the description, captions, and transcript, then summarize the difference between declarative and imperative knowledge.`,
          'Media is remote and optional. Playback requires an explicit host approval in the card viewer. The linked MIT OCW material is licensed **CC BY-NC-SA 4.0** and is included here only in this non-commercial demo.',
        ],
        initialUnlockedLayers: 3,
        tags: ['programming', 'media', 'video', 'accessibility', 'lecture-1'],
        color: '#102A43',
        textColor: '#FFFFFF',
      },
    ],
  },
  {
    key: 'statistics-worked-examples',
    name: 'Statistics in Context · Worked Examples',
    description: 'Short quantitative scenarios that move from answer to method, interpretation, and common misconception.',
    cardColor: '#FFF4CC',
    cardTextColor: '#332701',
    bannerType: 'math',
    cards: [
      {
        key: 'mean-outlier',
        frontContent: 'A small salary dataset gains one extremely high value. Which changes more: the mean or the median?',
        layers: [
          'The **mean** usually changes more because every value contributes directly to its total.',
          'The median depends on rank, so one extreme endpoint often leaves the middle position nearly unchanged.',
          'Transfer prompt: when reporting a skewed distribution, compare both instead of treating either as automatically correct.',
        ],
        tags: ['statistics', 'center', 'mean', 'median', 'worked-example'],
      },
      {
        key: 'conditional-probability',
        frontContent: 'Of 40 rainy days, 30 had umbrellas. Estimate `P(umbrella | rain)`.',
        layers: [
          '`30 / 40 = 0.75`, so the observed conditional proportion is **75%**.',
          'The denominator is the group after the condition is applied: rainy days, not all recorded days.',
          'Common trap: reversing the condition would ask a different question—`P(rain | umbrella)`.',
        ],
        initialUnlockedLayers: 2,
        tags: ['statistics', 'probability', 'conditional', 'worked-example'],
      },
      {
        key: 'correlation-causation',
        frontContent: 'A study finds a correlation between two variables. What can you conclude?',
        layers: [
          'They vary together in the observed data; correlation alone does not establish that one causes the other.',
          'Confounding variables, selection effects, reverse causation, and chance are alternative explanations.',
          'A stronger causal claim needs a defensible design plus evidence that addresses plausible alternatives.',
        ],
        tags: ['statistics', 'correlation', 'causation', 'interpretation'],
      },
      {
        key: 'confidence-interval',
        frontContent: 'What does a 95% confidence interval communicate in repeated-sampling terms?',
        layers: [
          'Across many repetitions of the same procedure, about 95% of the resulting intervals would cover the true parameter.',
          'It is not a claim that this fixed interval has a 95% probability of containing a fixed parameter.',
          'The interval combines an estimate with uncertainty created by the sampling process.',
        ],
        tags: ['statistics', 'inference', 'confidence-interval', 'concept'],
      },
      {
        key: 'choose-a-graph',
        frontContent: 'Choose a first graph for one categorical variable and one quantitative variable.',
        layers: [
          'Categorical: a bar chart. Quantitative: a histogram or dot plot.',
          'Match the encoding to the question: counts by category versus the shape and spread of numeric values.',
          'Accessibility check: never rely on color alone; use labels, patterns, ordering, or direct annotation too.',
        ],
        tags: ['statistics', 'visualization', 'accessibility', 'data-literacy'],
        color: '#1F2937',
        textColor: '#FFFFFF',
      },
    ],
  },
  {
    key: 'scientific-reasoning-cases',
    name: 'Scientific Reasoning · Evidence Cases',
    description: 'Claim–evidence–reasoning prompts for practising experimental design and evaluating explanations.',
    cardColor: '#E8F7EE',
    cardTextColor: '#12351F',
    cards: [
      {
        key: 'testable-hypothesis',
        frontContent: 'Turn “plants like music” into a testable hypothesis.',
        layers: [
          'Example: plants exposed to a defined sound treatment will show a different mean growth rate than matched plants without it over four weeks.',
          'Define the treatment, outcome measure, comparison, population, and time window.',
          'A precise hypothesis can be unsupported; testability is about whether evidence could count for or against it.',
        ],
        tags: ['science', 'hypothesis', 'experimental-design', 'claim'],
      },
      {
        key: 'control-group',
        frontContent: 'Why include a control group in an experiment?',
        layers: [
          'It provides a comparison for changes that might occur without the treatment.',
          'A good control differs from the treatment group only in the factor being tested, as far as practical.',
          'Without a comparison, time, handling, environment, or measurement effects can masquerade as treatment effects.',
        ],
        tags: ['science', 'control', 'experimental-design', 'evidence'],
      },
      {
        key: 'measurement-reliability',
        frontContent: 'A sensor gives nearly the same wrong reading every time. Is it reliable, valid, both, or neither?',
        layers: [
          'It is **reliable** (consistent) but not **valid** (accurate for the intended measurement).',
          'Repeated agreement does not reveal a shared calibration error.',
          'Use a known reference plus repeated trials to investigate both validity and reliability.',
        ],
        initialUnlockedLayers: 2,
        tags: ['science', 'measurement', 'reliability', 'validity'],
      },
      {
        key: 'replication',
        frontContent: 'What does successful replication add to a scientific claim?',
        layers: [
          'It shows the result is not unique to one sample, team, apparatus, or run under the tested conditions.',
          'Conceptual replications vary methods while testing the same underlying claim.',
          'Replication strengthens confidence but does not make a conclusion immune to future evidence.',
        ],
        tags: ['science', 'replication', 'evidence', 'reasoning'],
      },
      {
        key: 'claim-evidence-reasoning',
        frontContent: 'What are the three parts of a claim–evidence–reasoning response?',
        layers: [
          '**Claim:** the answer or explanation. **Evidence:** relevant observations or data. **Reasoning:** why the evidence supports the claim.',
          'Evidence without reasoning leaves the logical bridge implicit.',
          'Study prompt: write your own counter-evidence in the card note, then decide whether it weakens or overturns the claim.',
        ],
        tags: ['science', 'claim', 'evidence', 'reasoning', 'notes'],
      },
    ],
  },
  {
    key: 'learn-workflow-lab',
    name: 'Learn Workflow Lab · Notes & Review',
    description: 'A guided mini-deck for trying Learn, Study, Quiz, notes, progressive pages, and confidence-based review.',
    cardColor: '#2E1065',
    cardTextColor: '#FFFFFF',
    cards: [
      {
        key: 'three-modes',
        frontContent: 'How do Learn, Study, and Quiz differ in this app?',
        layers: [
          '**Learn** follows deck order. **Study** builds a scheduler-informed queue. **Quiz** requires an answer before reveal.',
          'All three use the same cards; the session mode changes selection or response rules, not the underlying content.',
          'Try the same five-card target in each mode and note which one best matches your current goal.',
        ],
        tags: ['workflow', 'learn', 'study', 'quiz', 'guide'],
      },
      {
        key: 'progressive-pages',
        frontContent: 'Why might a card keep later pages locked at first?',
        layers: [
          'Progressive pages let a card start with its core answer and add nuance only after successful recall.',
          'A strong review can unlock the next page; difficult reviews keep the current scope available for practice.',
          'This page is intentionally deeper: examples and transfer prompts belong after the concise answer.',
          'Design check: each page should add a distinct idea, not split one sentence into artificial fragments.',
        ],
        initialUnlockedLayers: 1,
        tags: ['workflow', 'layers', 'progressive-disclosure', 'guide'],
      },
      {
        key: 'use-notes',
        frontContent: 'What belongs in a private study note?',
        layers: [
          'A mnemonic, personal example, unresolved question, or explanation in your own words.',
          'Keep the shared card concise; use page-specific notes for context that is useful to you.',
          'Native builds can attach a voice note. Web study supports text notes; browser and device permissions still apply to media features.',
        ],
        initialUnlockedLayers: 3,
        tags: ['workflow', 'notes', 'reflection', 'guide'],
        starterNotes: { '-1': { text: 'This is a seeded example note. Edit or remove it while trying the workflow.' } },
      },
      {
        key: 'confidence-rating',
        frontContent: 'What should your post-reveal confidence rating represent?',
        layers: [
          'How successfully you recalled and explained this card now—not how much you like the topic.',
          'Lower ratings bring difficult material back sooner; stronger ratings can extend the interval and reveal additional pages.',
          'Be consistent rather than perfect. Review history is recorded with the scheduled card update.',
        ],
        tags: ['workflow', 'review', 'confidence', 'scheduling'],
      },
      {
        key: 'accessible-card-design',
        frontContent: 'Name three checks for an accessible study card.',
        layers: [
          'Use strong text contrast, meaningful labels, and a concise reading order.',
          'Provide a text alternative for media and do not encode meaning with color alone.',
          'Respect reduced-motion preferences and make interactive controls keyboard- and screen-reader understandable.',
        ],
        tags: ['workflow', 'accessibility', 'contrast', 'media', 'guide'],
        color: '#FFF7ED',
        textColor: '#431407',
      },
    ],
  },
];

const showcaseSeedPromises = new Map<string, Promise<string[]>>();

async function seedShowcaseCollection(): Promise<string[]> {
  const principalId = getFlashcardPrincipalId();
  const existingDecks = await DeckStore.getAll();
  const startingPosition = existingDecks.reduce((maximum, deck) => Math.max(maximum, deck.position), -1) + 1;
  const seededDeckIds: string[] = [];

  for (let deckIndex = 0; deckIndex < LEARN_SHOWCASE_DEFINITIONS.length; deckIndex += 1) {
    const definition = LEARN_SHOWCASE_DEFINITIONS[deckIndex];
    let deck = existingDecks.find(candidate => candidate.settings.learnShowcaseKey === definition.key);
    let createdDeck = false;

    if (!deck) {
      deck = {
        id: createEntityId('showcase-deck'),
        user_id: principalId,
        name: definition.name,
        description: definition.description,
        position: startingPosition + deckIndex,
        completed_once: false,
        created_at: Date.now() + deckIndex,
        settings: {
          isLearnShowcase: true,
          learnShowcaseKey: definition.key,
          learnShowcaseVersion: LEARN_SHOWCASE_VERSION,
          fixtureContent: true,
          cardColor: definition.cardColor,
          cardTextColor: definition.cardTextColor,
          ...(definition.bannerType ? { bannerType: definition.bannerType } : {}),
          ...(definition.courseIds ? { lmsCourseIds: definition.courseIds } : {}),
          ...(definition.sources ? { sources: definition.sources } : {}),
          ...(definition.license ? { sourceLicense: definition.license } : { sourceLicense: 'Original product-owned demo copy.' }),
        },
      } satisfies Deck;
      await DeckStore.insert(deck);
      existingDecks.push(deck);
      createdDeck = true;
    }

    try {
      const existingCards = await CardStore.getAllCardsForDeckWithNotes(deck.id, 10_000);
      const existingKeys = new Set(existingCards.map(({ note }) => note.field_values.learnShowcaseCardKey).filter(Boolean));
      const missingCards = definition.cards.filter(card => !existingKeys.has(card.key));
      if (missingCards.length) {
        await EditorStore.createCardsWithLayers(deck.id, missingCards.map(card => ({
          frontContent: card.frontContent,
          layers: [...card.layers],
          initialUnlockedLayers: card.initialUnlockedLayers ?? 1,
          tags: ['showcase', definition.key, ...card.tags],
          additionalFields: {
            learnShowcaseCardKey: card.key,
            learnShowcaseDeckKey: definition.key,
            provenance: definition.license ?? 'Original product-owned demo copy.',
            ...(card.color ? { color: card.color } : {}),
            ...(card.textColor ? { textColor: card.textColor } : {}),
            ...(card.starterNotes ? { layerNotes: JSON.stringify(card.starterNotes) } : {}),
          },
        })));
      }
      seededDeckIds.push(deck.id);
    } catch (error) {
      if (createdDeck) await DeckStore.softDelete(deck.id).catch(() => undefined);
      throw error;
    }
  }

  return seededDeckIds;
}

export function seedProgrammingCourseLearnDemo(): Promise<string[]> {
  const isDevelopmentBuild = typeof __DEV__ !== 'undefined'
    ? __DEV__
    : process.env.NODE_ENV !== 'production';
  if (!isDevelopmentBuild) return Promise.resolve([]);
  const principalId = getFlashcardPrincipalId();
  const existing = showcaseSeedPromises.get(principalId);
  if (existing) return existing;
  const pending = seedShowcaseCollection().finally(() => {
    if (showcaseSeedPromises.get(principalId) === pending) showcaseSeedPromises.delete(principalId);
  });
  showcaseSeedPromises.set(principalId, pending);
  return pending;
}
