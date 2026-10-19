import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = process.cwd();
const sourceRoots = [join(root, 'src', 'app'), join(root, 'src', 'components')];
const pointerControls = new Set([
  'Button',
  'Pressable',
  'TouchableHighlight',
  'TouchableOpacity',
  'TouchableWithoutFeedback',
]);
const actionableProps = new Set([
  'onClick',
  'onLongPress',
  'onPress',
  'onPressIn',
  'onSubmitEditing',
]);
const mutatingAsyncActionName = /^(?:(?:handle|on|request|run))?(?:add|apply|create|delete|end|enable|export|generate|grade|import|publish|reorder|restore|save|schedule|send|start|submit|update|upload)/i;

async function collectTsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  }));
  return nested.flat().sort();
}

function jsxName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

function attribute(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (candidate): candidate is ts.JsxAttribute => ts.isJsxAttribute(candidate) && candidate.name.getText() === name,
  );
}

function hasSpreadAttributes(node: ts.JsxOpeningLikeElement): boolean {
  return node.attributes.properties.some(ts.isJsxSpreadAttribute);
}

function isLiterallyDisabled(node: ts.JsxOpeningLikeElement): boolean {
  const disabled = attribute(node, 'disabled');
  if (!disabled) return false;
  if (!disabled.initializer) return true;
  const expression = expressionFor(disabled);
  return expression?.kind === ts.SyntaxKind.TrueKeyword;
}

function expressionFor(candidate: ts.JsxAttribute | undefined): ts.Expression | undefined {
  if (!candidate?.initializer || !ts.isJsxExpression(candidate.initializer)) return undefined;
  return candidate.initializer.expression;
}

function isEmptyHandler(expression: ts.Expression | undefined): boolean {
  if (!expression) return true;
  if (
    expression.kind === ts.SyntaxKind.NullKeyword
    || expression.kind === ts.SyntaxKind.UndefinedKeyword
    || expression.kind === ts.SyntaxKind.FalseKeyword
  ) return true;
  if (ts.isIdentifier(expression) && /^(?:noOp|noop)$/i.test(expression.text)) return true;
  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) return false;
  return ts.isBlock(expression.body) && expression.body.statements.length === 0;
}

function referencedMutatingAsyncAction(expression: ts.Expression | undefined, asyncActions: Set<string>): string | null {
  if (!expression) return null;
  if ((ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
      && expression.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
    return 'inline async action';
  }
  let match: string | null = null;
  const visit = (node: ts.Node): void => {
    if (match) return;
    if (ts.isIdentifier(node) && asyncActions.has(node.text) && mutatingAsyncActionName.test(node.text)) {
      match = node.text;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return match;
}

function location(source: ts.SourceFile, node: ts.Node): string {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${relative(root, source.fileName)}:${point.line + 1}`;
}

test('every active JSX control has a non-empty action contract', async context => {
  const files = (await Promise.all(sourceRoots.map(collectTsxFiles))).flat();
  const failures: string[] = [];
  let pointerCount = 0;
  let modalCount = 0;
  let switchCount = 0;
  let submitCount = 0;

  for (const file of files) {
    const sourceText = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const asyncActions = new Set<string>();
    const collectAsyncActions = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
        asyncActions.add(node.name.text);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = ts.isCallExpression(node.initializer) && node.initializer.arguments[0]
          ? node.initializer.arguments[0]
          : node.initializer;
        if ((ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
            && initializer.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          asyncActions.add(node.name.text);
        }
      }
      ts.forEachChild(node, collectAsyncActions);
    };
    collectAsyncActions(source);

    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = jsxName(node);
        for (const property of node.attributes.properties) {
          if (!ts.isJsxAttribute(property) || !actionableProps.has(property.name.getText())) continue;
          if (isEmptyHandler(expressionFor(property))) {
            failures.push(`${location(source, property)} ${property.name.getText()} is empty or disabled`);
          }
        }
        if (pointerControls.has(name)) {
          pointerCount += 1;
          const action = [...actionableProps].map(prop => attribute(node, prop)).find(Boolean);
          if (!action && !hasSpreadAttributes(node)) {
            failures.push(`${location(source, node)} <${name}> has no pointer/keyboard action prop`);
          }
          const asyncAction = referencedMutatingAsyncAction(expressionFor(action), asyncActions);
          if (asyncAction && !attribute(node, 'disabled')) {
            failures.push(`${location(source, node)} ${asyncAction} has no in-flight disabled contract`);
          }
          if (attribute(node, 'disabled') && !attribute(node, 'accessibilityState')) {
            failures.push(`${location(source, node)} disabled <${name}> does not expose accessibilityState`);
          }
        }

        if (name === 'Modal') {
          modalCount += 1;
          const close = attribute(node, 'onRequestClose');
          if (!close || isEmptyHandler(expressionFor(close))) {
            failures.push(`${location(source, node)} <Modal> has no non-empty onRequestClose`);
          }
        }

        if (name === 'Switch') {
          switchCount += 1;
          const change = attribute(node, 'onValueChange');
          if ((!change || isEmptyHandler(expressionFor(change))) && !isLiterallyDisabled(node)) {
            failures.push(`${location(source, node)} <Switch> has no non-empty onValueChange`);
          }
          if (attribute(node, 'disabled') && !attribute(node, 'accessibilityState')) {
            failures.push(`${location(source, node)} disabled <Switch> does not expose accessibilityState`);
          }
        }

        const submit = attribute(node, 'onSubmitEditing');
        if (submit) {
          submitCount += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.ok(pointerCount >= 280, `expected the complete active control surface, found ${pointerCount}`);
  assert.ok(modalCount >= 25, `expected the complete modal surface, found ${modalCount}`);
  assert.ok(switchCount >= 15, `expected the complete switch surface, found ${switchCount}`);
  assert.ok(submitCount >= 2, `expected keyboard submit actions, found ${submitCount}`);
  assert.deepEqual(failures, []);
  context.diagnostic(`audited ${pointerCount} pointer controls, ${modalCount} modals, ${switchCount} switches, and ${submitCount} keyboard-submit actions`);
});

test('critical multi-app actions keep their role, state, and outcome wiring', async () => {
  const read = async (path: string) => readFile(join(root, path), 'utf8');
  const [appLayout, courseRoute, contentManager, studentFeed, externalSite, creator, syllabus, flashcardReview, reminderBanner, home, chat, study] = await Promise.all([
    read('src/app/_layout.tsx'),
    read('src/app/admin/course/[id]/index.tsx'),
    read('src/components/lms/ContentManager.tsx'),
    read('src/components/lms/StudentFeed.tsx'),
    read('src/components/lms/ExternalSiteFrame.tsx'),
    read('src/components/lms/shared/UnifiedContentCreator.tsx'),
    read('src/components/lms/LMSComponents.tsx'),
    read('src/components/lms/FlashcardReviewModal.tsx'),
    read('src/components/ui/DeckCompletionBanner.tsx'),
    read('src/app/(tabs)/index.tsx'),
    read('src/app/(tabs)/chat.tsx'),
    read('src/app/study/[deckId].tsx'),
  ]);

  for (const mode of ['vertical', 'horizontal']) {
    assert.match(courseRoute, new RegExp(`chooseViewMode\\('${mode}'\\)`));
  }
  assert.match(appLayout, /APP_CANVAS_RESIZE_SIDES: readonly AppCanvasResizeSide\[\] = \['left', 'right'\]/);
  assert.match(appLayout, /accessibilityLabel=\{`Resize app canvas from \$\{side\} edge`\}/);
  assert.match(appLayout, /onKeyDown:/);
  assert.match(appLayout, /'aria-orientation': 'horizontal'/);
  assert.match(appLayout, /accessibilityValue=\{\{/);
  assert.match(appLayout, /min: MIN_APP_CONTENT_WIDTH/);
  assert.match(appLayout, /max: viewportCanvasMaximum/);
  assert.match(appLayout, /actionName === 'increment'\) adjustCanvasWidth\(32\)/);
  assert.match(appLayout, /actionName === 'decrement'\) adjustCanvasWidth\(-32\)/);

  assert.match(courseRoute, /canEdit && teacherMode === 'edit'[\s\S]*<ContentManager courseId=\{course\.id\}/);
  assert.match(courseRoute, /<StudentFeed[\s\S]*presentationMode=\{course\.presentationMode\}/);
  assert.match(contentManager, /course\?\.presentationMode === 'sequential'[\s\S]*<SequentialManager courseId=\{courseId\}/);
  assert.match(contentManager, /course\?\.presentationMode === 'custom'[\s\S]*<CustomManager courseId=\{courseId\}/);
  assert.match(contentManager, /return <TimelineManager courseId=\{courseId\}/);
  assert.match(studentFeed, /buildCoursePresentationBuckets\([\s\S]*presentationMode/);
  assert.match(studentFeed, /viewMode === 'horizontal'/);
  assert.match(studentFeed, /<ExternalSiteFrame/);
  assert.match(studentFeed, /getCourseSitePresentationMode\(item\)/);
  assert.match(externalSite, /setFrameRevision\(value => value \+ 1\)/);
  assert.match(externalSite, /void openExternal\(safeUrl\)/);

  assert.match(creator, /await onSave/);
  assert.match(creator, /saveInFlightRef\.current = true/);
  assert.match(creator, /accessibilityState=\{\{ disabled: !addForm\.title \|\| saving, busy: saving \}\}/);
  assert.match(syllabus, /sourceRightsConfirmed/);
  assert.match(syllabus, /reviewConfirmed/);
  assert.match(syllabus, /await extractValidatedSyllabus/);
  assert.match(syllabus, /await updateCourse/);
  assert.match(syllabus, /disabled=\{applying \|\| !reviewConfirmed\}/);
  assert.match(flashcardReview, /createAIProcessingAttestation/);
  assert.match(flashcardReview, /Promise\.resolve\(onApprove/);
  // Consent and source-support gating are exercised by the rendered review tests;
  // the disabled expression can legitimately include multiple prerequisites.
  assert.match(reminderBanner, /if \(isEnabling\) return/);
  assert.match(reminderBanner, /try \{[\s\S]*requestPermissionsAsync\(\)[\s\S]*scheduleDueCards\(\)[\s\S]*finally \{[\s\S]*setIsEnabling\(false\)/);

  assert.match(home, /setHasViewedTutorial\(true\)/);
  assert.match(chat, /await sendMessage/);
  assert.match(chat, /void createThread\(/);
  assert.match(chat, /await editChatMessage\(/);
  assert.match(chat, /await reportChatMessage\(/);
  assert.match(study, /window\.addEventListener\('keydown', handleKeyDown/);
  assert.match(study, /window\.removeEventListener\('keydown', handleKeyDown/);
  assert.match(study, /router\.replace\('\/'\)/);
});
