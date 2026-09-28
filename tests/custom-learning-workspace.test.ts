import assert from 'node:assert/strict';
import test from 'node:test';
import customCodeFixture from '../src/assets/mock-courses/custom_code.json';
import {
  CUSTOM_LEARNING_WORKSPACE_KIND,
  evaluateWorkspaceSolution,
  parseCustomLearningWorkspace,
} from '../src/lib/customLearningWorkspace';
import { isRenderableCustomCoursePresentationItem } from '../src/lib/coursePresentation';
import { ContentItem } from '../src/types/lms';

const fixtureItem: ContentItem = {
  ...customCodeFixture.items[0],
  id: 'custom-code-fixture',
  courseId: 'custom-code-course',
} as ContentItem;

test('the professor-posted demo selects the bounded hosted workspace renderer', () => {
  const workspace = parseCustomLearningWorkspace(fixtureItem.description);
  assert.ok(workspace);
  assert.equal(workspace.kind, CUSTOM_LEARNING_WORKSPACE_KIND);
  assert.equal(workspace.language, 'Python 3');
  assert.equal(workspace.visualization.labels.length, workspace.visualization.values.length);
  assert.equal(isRenderableCustomCoursePresentationItem(fixtureItem), true);
});

test('workspace payloads fail closed for unknown templates, oversized source, and active-looking shapes', () => {
  const source = JSON.parse(fixtureItem.description || '{}');
  source.workspace.kind = 'teacher-supplied-javascript';
  source.workspace.html = '<script>globalThis.compromised = true</script>';
  source.workspace.url = 'https://tracker.example/collect';
  assert.equal(parseCustomLearningWorkspace(JSON.stringify(source)), null);

  source.workspace.kind = CUSTOM_LEARNING_WORKSPACE_KIND;
  source.workspace.challenge.starterCode = 'x'.repeat(8_001);
  assert.equal(parseCustomLearningWorkspace(JSON.stringify(source)), null);
});

test('the runtime projection ignores unknown executable fields and exposes only reviewed data', () => {
  const source = JSON.parse(fixtureItem.description || '{}');
  source.workspace.html = '<img src=x onerror=alert(1)>';
  source.workspace.script = 'fetch("https://tracker.example")';
  source.workspace.visualization.renderer = '<svg onload=alert(1)>';
  const workspace = parseCustomLearningWorkspace(JSON.stringify(source));
  assert.ok(workspace);
  assert.deepEqual(Object.keys(workspace).sort(), [
    'challenge',
    'eyebrow',
    'kind',
    'language',
    'milestones',
    'snippet',
    'summary',
    'title',
    'visualization',
  ]);
  assert.equal('html' in workspace, false);
  assert.equal('script' in workspace, false);
  assert.equal('renderer' in workspace.visualization, false);
});

test('solution checks inspect bounded text without executing learner source', () => {
  const workspace = parseCustomLearningWorkspace(fixtureItem.description);
  assert.ok(workspace);
  let executionProbe = 0;
  const maliciousLookingSource = `${workspace.challenge.expectedTokens.join('\n')}\nexecutionProbe = 99`;
  const result = evaluateWorkspaceSolution(workspace, maliciousLookingSource);
  assert.equal(result.passed, true);
  assert.equal(executionProbe, 0);
  assert.match(result.message, /Nothing was executed or sent over the network/);

  const incomplete = evaluateWorkspaceSolution(workspace, workspace.challenge.starterCode);
  assert.equal(incomplete.passed, false);
  assert.ok(incomplete.missingTokens.length > 0);
});
