import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { registerHooks } from 'node:module';
import React from 'react';
import { JSDOM } from 'jsdom';
import { InstitutionAIService } from '../src/lib/ai/service';
import { mapSyllabusToCourse } from '../src/lib/ai/syllabusCourseMapping';
import { preparedDemoAssetService, resolvePreparedDemoUrl, type PreparedDemoSource } from '../src/lib/ai/preparedDemo';
import { attachAIProcessingAttestation, createAIProcessingAttestation, runAttestedAIRequest } from '../src/lib/ai/processingConsent';
import { assertAssetMatchesAIProvenance } from '../src/lib/integration/assetService';
import { createSharedDemoRepositoryFactory } from '../src/lib/repositories/remote/SharedDemoRepositoryFactory';
import { createPreparedAIDemo } from '../src/lib/testing/preparedAIDemoServer';
import { listenSharedDemoServer, resetSharedDemoData } from '../src/lib/testing/sharedDemoServer';
import type { AIDocumentAsset, SyllabusExtraction } from '../src/lib/ai/types';
import type { ContentItem, Course } from '../src/types/lms';

async function assertLearnerAttribution(course: Course, item: ContentItem) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lms.example.test/', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, DocumentFragment: dom.window.DocumentFragment, ShadowRoot: dom.window.ShadowRoot, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) };
  const originals = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  const stubs: Record<string, string> = {
    'react-native': 'import React from "react"; export * from "react-native-web"; export const Modal = ({visible,children}) => visible ? React.createElement("div",{role:"dialog"},children) : null;',
    '@expo/vector-icons/Ionicons': 'export default () => null;',
    '../../lib/useThemeColors': 'export const useThemeColors = () => ({background:"#fff",card:"#fff",text:"#111",textSecondary:"#333",primary:"#005fcc",border:"#777",buttonText:"#fff"});',
    '../../lib/store/useLMSStore': 'export const useLMSStore = selector => selector({ currentUserId: "u3" });',
    '../../lib/db/store': 'export const DeckStore = {}; export const EditorStore = {};',
    '../../lib/db/principal': 'export const getFlashcardPrincipalId = () => "u3";',
    '../../lib/learningState': 'export const getLearningStateService = () => {throw new Error("Unexpected progress write");}; export const recordConsentedLearningActivity = () => {throw new Error("Unexpected activity write");};',
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) { return stubs[specifier] ? { url: `published-ai:${specifier}`, shortCircuit: true } : nextResolve(specifier, context.parentURL?.startsWith('published-ai:') ? { ...context, parentURL: import.meta.url } : context); },
    load(url, context, nextLoad) { return url.startsWith('published-ai:') ? { format: 'module', source: stubs[url.slice('published-ai:'.length)], shortCircuit: true } : nextLoad(url, context); },
  });
  const ui = await import('@testing-library/react');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Saved attribution must not fetch a catalog or regenerate results.'); };
  try {
    const { CourseInformationView } = await import('../src/components/lms/CourseInformationView');
    const { CourseFlashcardPlayer } = await import('../src/components/lms/CourseFlashcardPlayer');
    ui.render(React.createElement(CourseInformationView, { course }));
    const syllabusText = ui.screen.getByLabelText('AI generation details').textContent || '';
    assert.match(syllabusText, /Generating model: gpt-6-astra\. Reasoning: xhigh/);
    assert.match(syllabusText, /additional syllabus fields were copied from exact source passages/);
    assert.match(syllabusText, /Source: mit-6.0001-syllabus.txt/);
    ui.cleanup();
    const view = ui.render(React.createElement(CourseFlashcardPlayer, { item, onClose() {}, previewMode: true }));
    assert.match(ui.screen.getByLabelText('AI generation details').textContent || '', /Generating model: gpt-6-astra/);
    assert.match(ui.screen.getByLabelText('AI generation details').textContent || '', /no live AI call is made.*Live model outputs may differ.*Replay engine: prepared-demo\/v1/);
    assert.match(ui.screen.getByLabelText('AI generation details').textContent || '', /Source: mit-6.0001-lecture1-excerpt.mp4/);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: /^Question:/ }));
    assert.equal(ui.screen.getByText('SOURCE EVIDENCE').textContent, 'SOURCE EVIDENCE');
    view.rerender(React.createElement(CourseFlashcardPlayer, { item: { ...item, metadata: {} }, onClose() {}, previewMode: true }));
    assert.equal(ui.screen.queryByLabelText('AI generation details') === null, true, 'ordinary study sets cannot inherit attribution');
  } finally {
    ui.cleanup(); hooks.deregister(); globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

// Exercises real HTTP transports and demo repositories in an isolated process.
// Review acknowledgements below are synthetic workflow input, not expert approval.
test('prepared syllabus and video publish through the shared backend and survive a learner re-login', async () => {
  resetSharedDemoData();
  const oldDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  const oldUrl = process.env.EXPO_PUBLIC_LMS_SHARED_DEMO_URL;
  const oldMode = process.env.EXPO_PUBLIC_LMS_PREPARED_AI_DEMO;
  const server = await listenSharedDemoServer({ port: 0, handlePreparedAI: await createPreparedAIDemo(path.resolve('demo/ai')) });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true });
    process.env.EXPO_PUBLIC_LMS_SHARED_DEMO_URL = base;
    process.env.EXPO_PUBLIC_LMS_PREPARED_AI_DEMO = '1';
    const teacher = createSharedDemoRepositoryFactory(base);
    const student = createSharedDemoRepositoryFactory(base);
    await teacher.auth.login('smith@example.invalid');
    await student.auth.login('alice@example.invalid');
    const original = await teacher.courses.getCourseDetails('c1');
    assert.ok(original);
    const beforeContent = await student.content.getContentItems('c1');
    const ai = new InstitutionAIService({ baseUrl: base });
    const attestation = createAIProcessingAttestation(new Date('2026-10-05T12:00:00Z'));
    const catalogResponse = await fetch(`${base}/demo-ai/catalog`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as { entries: PreparedDemoSource[] };
    const documentFor = async (id: string) => {
      const source = catalog.entries.find(entry => entry.id === id);
      assert.ok(source, `Missing prepared source: ${id}`);
      const response = await fetch(`${base}/demo-ai/files/${source.sha256}`);
      assert.equal(response.status, 200);
      const file = await response.blob();
      const document: AIDocumentAsset = { uri: 'file:///prepared-demo-test', name: source.name, mimeType: source.mimeType, size: file.size, file, kind: source.kind };
      return { source, document };
    };

    const syllabus = await documentFor('syllabus');
    const extraction = await runAttestedAIRequest(attestation, () => ai.extractSyllabus({ document: syllabus.document, courseTitle: original.title }));
    assert.equal(extraction.evidence.length, 36);
    assert.equal(extraction.policies?.length, 10);
    assert.equal(extraction.schedule?.length, 12);
    assert.equal(extraction.termStart, undefined);
    assert.equal(extraction.gradingWeights, undefined);
    assert.equal((await student.courses.getCourseDetails('c1'))?.title, original.title, 'generating a draft does not rewrite the course');
    const syllabusAsset = await preparedDemoAssetService.upload(syllabus.document, { courseId: 'c1', purpose: 'course-content' });
    assertAssetMatchesAIProvenance(syllabusAsset, extraction.provenance);
    const mapped = mapSyllabusToCourse(extraction, original);
    await teacher.courses.updateCourse('c1', {
      ...mapped.courseFields,
      metadata: {
        ...original.metadata,
        syllabus: { ...mapped.syllabusDetails, sourceAsset: syllabusAsset, sourceFileName: syllabus.document.name, humanReviewedAt: attestation.sourceRightsAttestedAt },
      },
    });
    const imported = await student.courses.getCourseDetails('c1');
    assert.ok(imported);
    assert.equal(imported.title, extraction.title);
    assert.equal(imported.termStart, original.termStart, 'missing source dates preserve the course term');
    assert.equal(imported.termEnd, original.termEnd);
    assert.deepEqual(imported.gradingWeights, original.gradingWeights, 'conditional source grading does not overwrite existing weights');
    assert.deepEqual((imported.metadata?.syllabus as SyllabusExtraction).evidence, extraction.evidence);
    assert.equal((imported.metadata?.syllabus as SyllabusExtraction).courseCode, '6.0001');
    assert.equal((imported.metadata?.syllabus as SyllabusExtraction).learningObjectives?.length, 3);
    assert.equal((imported.metadata?.syllabus as SyllabusExtraction).meetingTimes?.length, 2);
    await assert.rejects(() => student.courses.updateCourse('c1', { title: 'Unauthorized rewrite' }), /student role cannot/);

    const lesson = await documentFor('lecture-video');
    const drafts = await runAttestedAIRequest(attestation, () => ai.generateFlashcards({ document: lesson.document, requestedCardCount: 6 }));
    assert.equal(drafts.length, 6);
    assert.equal(drafts.every(card => card.reviewerVerified === false), true, 'source validation cannot manufacture instructor approval');
    assert.equal((await student.content.getContentItems('c1')).length, beforeContent.length, 'generation alone publishes nothing');
    const lessonAsset = await preparedDemoAssetService.upload(lesson.document, { courseId: 'c1', purpose: 'course-content' });
    assertAssetMatchesAIProvenance(lessonAsset, drafts[0].provenance);
    assert.throws(() => assertAssetMatchesAIProvenance(syllabusAsset, drafts[0].provenance), /no longer matches/);
    assert.ok(lesson.source.captionSha256 && lesson.source.transcript);
    const material: ContentItem = {
      id: 'prepared-publication-material', courseId: 'c1', category: 'material', title: 'Prepared lecture publication test',
      contentUrl: lessonAsset.url, presentationSlot: 'current', createdAt: Date.now(),
      metadata: { asset: lessonAsset },
      videoAlternatives: {
        transcript: { text: lesson.source.transcript },
        captionTracks: [{ url: `https://prepared-demo.invalid/files/${lesson.source.captionSha256}`, language: 'en', label: 'English', format: 'text/vtt', isDefault: true }],
      },
    };
    const study: ContentItem = {
      id: 'prepared-publication-cards', courseId: 'c1', category: 'material', title: 'Prepared lecture study cards',
      presentationSlot: 'current', createdAt: Date.now(),
      studyCards: drafts.map(card => ({ ...card, reviewerVerified: true })),
      metadata: { ai: attachAIProcessingAttestation({ task: 'flashcards', sourceContentItemId: material.id, sourceFileName: lesson.document.name, provenance: drafts[0].provenance, humanReviewedAt: attestation.sourceRightsAttestedAt }, attestation) },
    };
    await assert.rejects(() => student.content.createContentItems([material, study]), /student role cannot/);
    await assert.rejects(() => teacher.content.createContentItems([material, { ...study, id: beforeContent[0].id }]), /already exists/);
    assert.equal((await student.content.getContentItems('c1')).some(item => item.id === material.id), false, 'a rejected batch cannot publish only the source');
    await teacher.content.createContentItems([material, study]);

    await student.auth.logout();
    assert.throws(() => student.content.getContentItems('c1'), /Choose a shared demo identity/);
    await student.auth.login('alice@example.invalid');
    const published = await student.content.getContentItems('c1');
    assert.equal(published.length, beforeContent.length + 2);
    const visibleMaterial = published.find(item => item.id === material.id);
    const visibleStudy = published.find(item => item.id === study.id);
    assert.ok(visibleMaterial && visibleStudy);
    assert.deepEqual(visibleStudy.studyCards?.map(card => [card.front, card.back, card.sourceExcerpt, card.sourceLocation]), drafts.map(card => [card.front, card.back, card.sourceExcerpt, card.sourceLocation]));
    assert.equal(visibleStudy.studyCards?.every(card => card.reviewerVerified), true);
    assert.equal(visibleMaterial.videoAlternatives?.transcript?.text, lesson.source.transcript);
    const media = await fetch(resolvePreparedDemoUrl(visibleMaterial.contentUrl!), { headers: { range: 'bytes=0-31' } });
    assert.equal(media.status, 206);
    assert.equal((await media.arrayBuffer()).byteLength, 32);
    const captions = await fetch(resolvePreparedDemoUrl(visibleMaterial.videoAlternatives!.captionTracks![0].url));
    assert.equal(captions.status, 200);
    assert.match(await captions.text(), /^WEBVTT/);
    assert.equal((await student.courses.getCourseDetails('c1'))?.title, extraction.title);
    await assertLearnerAttribution((await student.courses.getCourseDetails('c1'))!, visibleStudy);
    await teacher.auth.logout();
    assert.equal((await student.auth.getCurrentUser())?.id, 'u3', 'teacher logout cannot change the learner session');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    resetSharedDemoData();
    if (oldDev) Object.defineProperty(globalThis, '__DEV__', oldDev); else Reflect.deleteProperty(globalThis, '__DEV__');
    if (oldUrl === undefined) delete process.env.EXPO_PUBLIC_LMS_SHARED_DEMO_URL; else process.env.EXPO_PUBLIC_LMS_SHARED_DEMO_URL = oldUrl;
    if (oldMode === undefined) delete process.env.EXPO_PUBLIC_LMS_PREPARED_AI_DEMO; else process.env.EXPO_PUBLIC_LMS_PREPARED_AI_DEMO = oldMode;
  }
});
