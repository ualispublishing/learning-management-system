import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { CourseStudyCardBody, CourseStudyNavigation } from './CourseStudyCardView';
import { CourseInformationView } from './CourseInformationView';
import { PreparedDemoEvaluation } from './PreparedDemoEvaluation';
import { useThemeColors } from '../../lib/useThemeColors';
import { isPreparedAIDemo, preparedDemoBaseUrl, preparedGenerationAttribution, type PreparedDemoGeneration, type PreparedDemoSource } from '../../lib/ai/preparedDemo';
import { showPreparedResult, syllabusCourseMapping, type PreparedShowcaseResult, type PreparedSourcePreview } from '../../lib/ai/preparedShowcase';
import { preparedExport, type PreparedExportFormat } from '../../lib/ai/preparedExports';
import { mapSyllabusToCourse } from '../../lib/ai/syllabusCourseMapping';
import type { GeneratedFlashcard, SyllabusExtraction } from '../../lib/ai/types';

const sourceLabels: Record<string, string> = { syllabus: 'Syllabus', 'slides-pdf': 'PDF slides', 'slides-pptx': 'PowerPoint', 'lecture-video': 'Video', 'lecture-audio': 'Audio', 'lecture-captions': 'Captions' };
const blankCourse = { title: 'Untitled example course', description: '', termStart: 0, termEnd: 0, gradingWeights: {} };

function ResultExports({ source, result, generation }: { source: PreparedDemoSource; result: PreparedShowcaseResult; generation?: PreparedDemoGeneration }) {
  const [format, setFormat] = useState<PreparedExportFormat | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const artifact = format ? preparedExport(result, format, generation) : null;
  const formats: { key: PreparedExportFormat; label: string }[] = result.task === 'syllabus'
    ? [{ key: 'syllabus', label: 'Export syllabus draft' }, { key: 'course', label: 'Export course mapping' }, { key: 'result', label: 'Export result JSON' }, { key: 'schema', label: 'View extraction JSON schema' }]
    : [{ key: 'result', label: 'Export result JSON' }];
  const copy = async () => {
    if (!artifact) return;
    try { await navigator.clipboard.writeText(artifact.text); setCopyStatus('Copied export text.'); }
    catch { setCopyStatus('Copy is unavailable here. Select the export text below and copy it manually, or use Save file.'); }
  };
  return <>
    <div className="ai-actions">{formats.map(item => <button key={item.key} aria-pressed={format === item.key} onClick={() => { setFormat(item.key); setCopyStatus(''); }}>{item.label}</button>)}</div>
    {artifact ? <section className="ai-export" aria-label="Export preview">
      <h3>{artifact.name}</h3>
      <p className="ai-note">{format === 'schema' ? 'JSON schema for syllabus extraction, including supported course fields, evidence and warnings.' : 'Portable prepared draft with source evidence. Instructor review is pending. Temporary session and card IDs are omitted.'}</p>
      <div className="ai-actions"><a href={`${preparedDemoBaseUrl()}/demo-ai/exports/${source.sha256}/${format}`}>Save file</a><button onClick={() => void copy()}>Copy export text</button><button onClick={() => setFormat(null)}>Close export</button></div>
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
      <textarea aria-label="Export contents" readOnly rows={12} value={artifact.text} onFocus={event => event.currentTarget.select()} />
    </section> : null}
  </>;
}

function SyllabusResult({ syllabus }: { syllabus: SyllabusExtraction }) {
  const [tab, setTab] = useState<'course' | 'syllabus' | 'mapping'>('course');
  const mapped = mapSyllabusToCourse(syllabus, blankCourse);
  return <>
    <div className="ai-tabs" aria-label="Syllabus result views">
      <button aria-pressed={tab === 'course'} onClick={() => setTab('course')}>Course information</button>
      <button aria-pressed={tab === 'syllabus'} onClick={() => setTab('syllabus')}>Updated syllabus</button>
      <button aria-pressed={tab === 'mapping'} onClick={() => setTab('mapping')}>Field mapping</button>
    </div>
    {tab === 'course' ? <div aria-label="Course information preview">
      <p className="ai-eyebrow">Example course · after import</p>
      <CourseInformationView course={{ ...mapped.courseFields, metadata: { syllabus: mapped.syllabusDetails } }} />
      {!syllabus.termStart && !syllabus.termEnd ? <p className="ai-note">Existing course dates would be kept.</p> : null}
      <p className="ai-note">Preview only. The same field mapping is used when a reviewed syllabus is applied inside a course.</p>
    </div> : tab === 'syllabus' ? <article aria-label="Updated syllabus draft">
      <p className="ai-eyebrow">Formatted draft · instructor review pending</p>
      <h3>{syllabus.title}</h3><p>{syllabus.description}</p>
      {syllabus.courseCode && <><h4>Course code</h4><p>{syllabus.courseCode}</p></>}
      {syllabus.courseDuration && <><h4>Course duration</h4><p>{syllabus.courseDuration}</p></>}
      {syllabus.intendedAudience && <><h4>Intended audience</h4><p>{syllabus.intendedAudience}</p></>}
      {!!syllabus.meetingTimes?.length && <><h4>Meeting times</h4>{syllabus.meetingTimes.map(value => <p key={value}>{value}</p>)}</>}
      {!!syllabus.learningObjectives?.length && <><h4>Learning objectives</h4>{syllabus.learningObjectives.map(value => <p key={value}>{value}</p>)}</>}
      <h4>Instructors</h4><p>{syllabus.instructorNames?.join(' · ')}</p>
      <h4>Session schedule</h4><ol>{syllabus.schedule?.map((entry, index) => <li key={index}>{entry.topic}<span className="ai-muted"> — {entry.date || 'date to be confirmed'}</span></li>)}</ol>
      <h4>Required materials</h4>{syllabus.requiredMaterials?.map(material => <p key={material}>{material}</p>)}
      <h4>Policies</h4>{syllabus.policies?.map(policy => <section key={policy.name}><h5>{policy.name}</h5><p>{policy.text}</p></section>)}
      <p className="ai-note">This is a structured summary of the source, with the review items below. The original syllabus remains available on the left.</p>
    </article> : <div aria-label="Syllabus to course field mapping">
      <p>Before: an unconfigured example course. After: supported values populate these fields; omitted values preserve existing course settings.</p>
      {syllabusCourseMapping(syllabus).map(row => <section className="ai-mapping" key={row.destination}>
        <h4>{row.label} <span className="ai-chip">{row.value ? 'Populate' : 'Keep existing'}</span></h4>
        <code>{row.destination}</code><p>{row.value || 'No safe replacement supplied. Review the source and configure manually.'}</p>
      </section>)}
      <p className="ai-note">Evidence and warnings are retained with syllabus metadata. Instructor names are descriptive; importing a syllabus does not grant staff access.</p>
    </div>}
    <details className="ai-review" open><summary>{syllabus.warnings.length} items need instructor review</summary><ul>{syllabus.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>
    <details><summary>{syllabus.evidence.length} source citations</summary>{syllabus.evidence.map(item => <blockquote key={item.field}><strong>{item.field}</strong><p>{item.sourceExcerpt}</p><cite>{item.sourceLocation}</cite></blockquote>)}</details>

  </>;
}

function FlashcardResult({ cards, title }: { cards: GeneratedFlashcard[]; title: string }) {
  const colors = useThemeColors();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [understood, setUnderstood] = useState<Set<string>>(() => new Set());
  const move = (next: number) => { setIndex(Math.max(0, Math.min(cards.length - 1, next))); setRevealed(false); };
  const rate = (value: boolean) => {
    setUnderstood(current => { const next = new Set(current); if (value) next.add(cards[index].id); else next.delete(cards[index].id); return next; });
    if (index < cards.length - 1) move(index + 1);
  };
  return <>
    <div className="ai-course-study" aria-label="Flashcard study preview">
      <p className="ai-eyebrow">Course flashcards · temporary study set</p>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', marginVertical: 12 }}>{title}</Text>
      <p className="ai-note">Card {index + 1} of {cards.length} · {understood.size} marked understood</p>
      <CourseStudyCardBody cards={cards} index={index} revealed={revealed} onToggleAnswer={() => setRevealed(value => !value)} onRate={rate} />
      <CourseStudyNavigation cards={cards} index={index} onMove={move} />
    </div>
    <details><summary>Review all {cards.length} flashcards</summary>{cards.map((item, position) => <section className="ai-mapping" key={item.id}>
      <h4>{position + 1}. {item.front}</h4><p>{item.back}</p><blockquote><p>{item.sourceExcerpt}</p><cite>{item.sourceLocation}</cite></blockquote>
    </section>)}</details>
    <p className="ai-note">This is the course flashcard presentation. These generated drafts use the course study-card format; preview study progress stays on this screen. In a course, an instructor reviews and publishes the material and study set together.</p>
  </>;
}

function ShowcaseExample({ source, generation }: { source: PreparedDemoSource; generation?: PreparedDemoGeneration }) {
  const [preview, setPreview] = useState<PreparedSourcePreview | null>(null);
  const [result, setResult] = useState<PreparedShowcaseResult | null>(null);
  const [previewError, setPreviewError] = useState(''); const [resultError, setResultError] = useState('');
  const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  const active = useRef(true); const inFlight = useRef(false);
  const base = preparedDemoBaseUrl(); const url = `${base}/demo-ai/files/${source.sha256}`;
  useEffect(() => {
    active.current = true; const controller = new AbortController();
    void fetch(`${base}/demo-ai/source/${source.sha256}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('The source preview could not be loaded.');
      const value = await response.json() as PreparedSourcePreview;
      if (value.documentSha256 !== source.sha256) throw new Error('The preview does not match this file.');
      if (!controller.signal.aborted) setPreview(value);
    }).catch(reason => { if (!controller.signal.aborted) setPreviewError(reason instanceof Error ? reason.message : 'Source preview failed.'); });
    return () => { controller.abort(); active.current = false; };
  }, [base, source.sha256, retry]);
  const show = async () => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setResultError('');
    try { const value = await showPreparedResult(source); if (active.current) setResult(value); }
    catch (reason) { if (active.current) setResultError(reason instanceof Error ? reason.message : 'Prepared result could not be loaded.'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const provenance = result?.task === 'syllabus' ? result.syllabus.provenance : result?.cards[0]?.provenance;
  return <div className="ai-comparison">
    <section className="ai-panel" aria-label="Before: source material">
      <div className="ai-panel-title"><span className="ai-step">01</span><div><p className="ai-eyebrow">Before</p><h2>Source material</h2></div></div>
      <h3>{source.title}</h3><p className="ai-filename">{source.name}</p>
      <div className="ai-actions"><a href={url} target="_blank" rel="noreferrer">Open original file ↗</a><a href={`${url}?download=1`}>Download source</a></div>
      {source.kind === 'video' ? <video key={url} controls preload="metadata" crossOrigin="anonymous" aria-label="Original lecture video" src={url}>
        {source.captionSha256 ? <track kind="captions" label="English · MIT OCW" srcLang="en" src={`${base}/demo-ai/files/${source.captionSha256}`} default /> : null}
      </video> : source.kind === 'audio' ? <audio key={url} controls preload="metadata" aria-label="Original lecture audio" src={url} /> : null}
      {source.mimeType === 'application/pdf' ? <object className="ai-pdf" data={url} type="application/pdf" aria-label="Original PDF slides"><p>Use “Open original file” to view the PDF. Extracted slide text is also below.</p></object> : null}
      {source.id === 'slides-pptx' ? <p className="ai-note">Editable PowerPoint adapted from the same MIT lecture slides. Download to view the deck; slide text appears below.</p> : null}
      {previewError ? <div role="alert"><p>{previewError}</p><button onClick={() => { setPreviewError(''); setRetry(value => value + 1); }}>Retry source preview</button></div> : preview ? <details open={source.task === 'syllabus' || source.id === 'slides-pptx'}>
        <summary>{source.kind === 'video' || source.kind === 'audio' ? 'Transcript and timestamps' : 'Source text and locations'}</summary>
        <div className="ai-source-text">{preview.segments.map((segment, index) => <section key={index}><h4>{segment.location}</h4><p>{segment.text}</p></section>)}</div>
      </details> : <p role="status">Loading source preview…</p>}
      <p className="ai-note">MIT 6.0001 · Fall 2016 · Lecture 1: What is Computation?</p>
    </section>
    <section className="ai-panel ai-result" aria-label="After: prepared result" aria-busy={busy}>
      <div className="ai-panel-title"><span className="ai-step">02</span><div><p className="ai-eyebrow">After</p><h2>{source.task === 'syllabus' ? 'Course information & syllabus' : 'Source-grounded flashcards'}</h2></div></div>
      {!result ? <div className="ai-empty">
        <h3>{source.task === 'syllabus' ? 'From syllabus to a populated course' : 'From lesson material to a study set'}</h3>
        <p>{source.task === 'syllabus' ? 'See the extracted course fields, an updated syllabus draft, and the source evidence for each field.' : 'See six question-and-answer cards, try the learner view, and inspect the supporting quotations.'}</p>
        <button className="ai-primary" disabled={busy} onClick={() => void show()}>{busy ? 'Checking source and loading result…' : 'Show prepared result'}</button>
        <p className="ai-muted">Runs the same source upload and validation as course import. No live model call.</p>
      </div> : <>
        <div className="ai-passed" role="status"><strong>Source checks passed</strong><p>File contents, source quotations, locations and output structure checked. Instructor review is still required.</p></div>
        {result.task === 'syllabus' ? <SyllabusResult syllabus={result.syllabus} /> : <FlashcardResult cards={result.cards} title={source.title} />}
        <p className="ai-note" aria-label="Generation attribution">{preparedGenerationAttribution(generation)}</p>
        <details><summary>Processing details</summary><p>Replay engine: {provenance?.model} (not the authoring model)</p><p>Validation prompt version: {provenance?.promptVersion}</p><p>Request: {provenance?.requestId}</p><p className="ai-filename">Source SHA-256: {provenance?.documentSha256}</p><p>The saved output matches its regression baseline. These checks do not measure educational accuracy.</p></details>
        <ResultExports source={source} result={result} generation={generation} />
        <div className="ai-actions"><button onClick={() => { setResult(null); setResultError(''); }}>Reset this example</button></div>
      </>}
      {resultError ? <p role="alert" className="ai-error">{resultError}</p> : null}
    </section>
  </div>;
}

interface ShowcaseNavigation { onNavigate?: (path: '/admin' | '/demo') => void }

function WebShowcase({ onNavigate }: ShowcaseNavigation) {
  const colors = useThemeColors();
  const [sources, setSources] = useState<PreparedDemoSource[]>([]); const [selected, setSelected] = useState('syllabus');
  const [generation, setGeneration] = useState<PreparedDemoGeneration>();
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0); const [reset, setReset] = useState(0);
  const [dropBusy, setDropBusy] = useState(false); const active = useRef(true); const dropFlight = useRef(false);
  useEffect(() => {
    active.current = true; const controller = new AbortController();
    void fetch(`${preparedDemoBaseUrl()}/demo-ai/catalog`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Start npm run demo:multiuser to load the prepared examples.');
      const value = await response.json(); if (!controller.signal.aborted) { setSources(value.entries); setGeneration(value.generation); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Examples could not be loaded.'); });
    return () => { controller.abort(); active.current = false; };
  }, [retry]);
  const selectFile = async (files: File[]) => {
    if (dropFlight.current) return;
    setError(''); if (files.length !== 1 || files[0].size > 50 * 1024 * 1024) { setError('Choose one bundled file no larger than 50 MB.'); return; }
    dropFlight.current = true; setDropBusy(true);
    try {
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await files[0].arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
      const match = sources.find(item => item.sha256 === sha);
      if (!match) throw new Error('No prepared result matches this file. Use a bundled source; renamed copies work.');
      if (active.current) { setSelected(match.id); setReset(value => value + 1); }
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : 'File could not be read.'); }
    finally { dropFlight.current = false; if (active.current) setDropBusy(false); }
  };
  const source = sources.find(item => item.id === selected);
  return <div className="ai-showcase" style={{ '--ai-bg': colors.background, '--ai-card': colors.card, '--ai-text': colors.text, '--ai-muted': colors.textSecondary, '--ai-border': colors.border, '--ai-primary': colors.primary, '--ai-on-primary': colors.buttonText } as React.CSSProperties}>
    <style>{showcaseStyles}</style>
    <main>
      <header className="ai-header"><div><p className="ai-eyebrow">AI teaching tools · prepared demo</p><h1>From source to learning</h1><p>One course bundle. Real prepared outputs. A repeatable preview beside your LMS.</p></div><nav className="ai-actions" aria-label="Demo navigation">{([{ path: '/demo', label: 'Demo guide' }, { path: '/admin', label: 'Back to app →' }] as const).map(item => <a key={item.path} href={item.path} onClick={event => { if (onNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onNavigate(item.path); } }}>{item.label}</a>)}</nav></header>
      <div className="ai-notice"><strong>Same import backend. Temporary preview.</strong><span>Results stay on this screen. Reset and replay without creating or changing a course. Live AI will use the provider configured by each institution.</span></div>
      <nav className="ai-selector" aria-label="Prepared examples">{sources.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setError(''); }}>{sourceLabels[item.id] || item.title}</button>)}<button className="ai-reset" onClick={() => { setReset(value => value + 1); setError(''); }}>Reset preview</button></nav>
      <div className="ai-drop" aria-label="Drop a prepared demo file" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = dropBusy ? 'none' : 'copy'; }} onDrop={event => { event.preventDefault(); void selectFile(Array.from(event.dataTransfer.files)); }}>
        <span>{dropBusy ? 'Matching file contents…' : 'Or drop any bundled syllabus or lesson file here.'}</span><label className="ai-file-label">Choose file<input aria-label="Choose a prepared demo file" type="file" disabled={dropBusy || !sources.length} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) void selectFile(files); }} /></label>
      </div>
      {error ? <div className="ai-error" role="alert">{error}{!sources.length ? <button onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry examples</button> : null}</div> : null}
      {source ? <ShowcaseExample key={`${source.sha256}-${reset}`} source={source} generation={generation} /> : !error ? <p role="status">Loading prepared examples…</p> : null}
      <PreparedDemoEvaluation />
      <footer><p>Prepared results are checked against the sources, not independently approved by an instructor. Historical course policies require review.</p><p>MIT OpenCourseWare · Ana Bell, Eric Grimson & John Guttag · CC BY-NC-SA 4.0 · Adapted materials · No MIT endorsement. <a href="https://ocw.mit.edu/pages/privacy-and-terms-of-use/" target="_blank" rel="noreferrer">Permission or replacement required for commercial presentations.</a></p></footer>
    </main>
  </div>;
}

export function PreparedAIShowcase(props: ShowcaseNavigation) {
  if (Platform.OS !== 'web' || !isPreparedAIDemo()) return <View style={{ padding: 24 }}><Text>This showcase is available in the local web demo. Run npm run demo:multiuser.</Text></View>;
  return <WebShowcase {...props} />;
}

const showcaseStyles = `
.ai-showcase{height:100%;overflow:auto;background:var(--ai-bg);color:var(--ai-text);font-family:Inter_400Regular,system-ui,sans-serif;font-size:15px;line-height:1.55;color-scheme:light dark}
.ai-showcase *{box-sizing:border-box}.ai-showcase main{max-width:1380px;margin:auto;padding:32px}.ai-showcase h1{font-size:36px;line-height:1.15;letter-spacing:-1px;margin:6px 0 12px}.ai-showcase h2{font-size:21px;line-height:1.3;margin:0}.ai-showcase h3{font-size:21px;line-height:1.4;margin:18px 0 12px}.ai-showcase h4{font-size:15px;margin:18px 0 6px}.ai-showcase h5{font-size:14px;margin-bottom:4px}.ai-showcase p{margin:8px 0 14px}.ai-showcase a{color:var(--ai-primary);text-underline-offset:4px}.ai-showcase button:where(:not(.ai-course-study *)),.ai-file-label{font:inherit;font-weight:600;line-height:1.35;padding:11px 15px;border:1px solid var(--ai-border);border-radius:9px;background:var(--ai-card);color:var(--ai-text);cursor:pointer;min-height:44px}.ai-showcase button:where(:not(.ai-course-study *)):hover,.ai-file-label:hover{border-color:var(--ai-primary)}.ai-showcase button:where(:not(.ai-course-study *)):focus-visible,.ai-showcase a:focus-visible,.ai-showcase summary:focus-visible,.ai-file-label:focus-within{outline:3px solid var(--ai-primary);outline-offset:3px}.ai-showcase button:where(:not(.ai-course-study *)):disabled{opacity:.55;cursor:wait}.ai-showcase button:where(:not(.ai-course-study *))[aria-pressed=true],.ai-showcase .ai-primary{background:var(--ai-primary);color:var(--ai-on-primary);border-color:var(--ai-primary)}
.ai-export textarea{width:100%;resize:vertical;background:var(--ai-bg);color:var(--ai-text);border:1px solid var(--ai-border);border-radius:8px;padding:12px;font:12px/1.5 monospace}.ai-header{display:flex;justify-content:space-between;gap:24px;align-items:center}.ai-header>a{white-space:nowrap}.ai-eyebrow{color:var(--ai-primary);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin:0!important}.ai-muted,.ai-note{color:var(--ai-muted)}.ai-note{font-size:13px}.ai-notice{border-left:3px solid var(--ai-primary);padding:12px 18px;margin:16px 0 24px;background:var(--ai-card);display:flex;gap:16px;align-items:baseline}.ai-notice strong{flex-shrink:0}.ai-notice span{font-size:13px;color:var(--ai-muted)}.ai-selector,.ai-actions,.ai-tabs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ai-reset{margin-left:auto}.ai-drop{margin:14px 0 24px;padding:10px 14px;border:1px dashed var(--ai-border);border-radius:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--ai-muted);font-size:13px}.ai-file-label{position:relative;overflow:hidden;flex-shrink:0;font-size:13px}.ai-file-label input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}.ai-comparison{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:24px;align-items:start}.ai-panel{background:var(--ai-card);border:1px solid var(--ai-border);border-radius:16px;padding:26px;min-width:0}.ai-panel-title{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--ai-border);padding-bottom:18px;margin-bottom:20px}.ai-step{border:1px solid var(--ai-border);border-radius:10px;padding:8px 11px;font-size:13px;font-weight:800;color:var(--ai-primary)}.ai-filename{font-size:12px;overflow-wrap:anywhere;color:var(--ai-muted)}.ai-actions{margin:16px 0;gap:12px;font-size:13px}.ai-empty{padding:38px 4px 24px}.ai-empty .ai-primary{margin:12px 0}.ai-empty .ai-muted{font-size:13px}.ai-passed{border:1px solid var(--ai-primary);border-radius:10px;padding:14px;margin-bottom:20px}.ai-passed strong{color:var(--ai-primary)}.ai-passed p{font-size:13px;margin:5px 0 0}.ai-showcase video,.ai-showcase audio{width:100%;margin:14px 0;border-radius:10px}.ai-pdf{width:100%;height:380px;border:1px solid var(--ai-border);margin:14px 0}.ai-showcase details{border-top:1px solid var(--ai-border);padding:15px 0}.ai-showcase summary{cursor:pointer;font-weight:600}.ai-source-text{max-height:640px;overflow:auto;padding-right:12px}.ai-source-text p{white-space:pre-wrap;font-size:13px}.ai-source-text h4{font-size:12px;color:var(--ai-primary)}.ai-tabs{margin-bottom:22px}.ai-tabs button{font-size:12px;padding:9px 12px}.ai-showcase dt{font-weight:700;font-size:13px;margin-top:14px}.ai-showcase dd{margin:4px 0 0;white-space:pre-line}.ai-showcase li{margin:7px 0}.ai-showcase ol,.ai-showcase ul{padding-left:22px}.ai-mapping{border-bottom:1px solid var(--ai-border);padding-bottom:12px}.ai-mapping p{white-space:pre-line}.ai-mapping code{font-size:11px;overflow-wrap:anywhere;color:var(--ai-muted)}.ai-chip{font-size:10px;font-weight:500;border:1px solid var(--ai-border);border-radius:20px;padding:3px 8px;margin-left:8px;white-space:nowrap}.ai-review{margin-top:22px}.ai-review li{font-size:13px}.ai-showcase blockquote{border-left:3px solid var(--ai-border);margin:20px 0;padding:0 0 0 14px;font-size:13px}.ai-showcase cite{font-size:11px;color:var(--ai-muted)}.ai-course-study{color:var(--ai-text)}.ai-study{padding:22px;border:1px solid var(--ai-border);border-radius:14px;background:var(--ai-bg)}.ai-study h3{font-size:25px}.ai-answer{font-size:21px;color:var(--ai-primary);padding:15px 0}.ai-error{border:1px solid var(--ai-primary);padding:14px;margin:14px 0;border-radius:8px}.ai-showcase footer{font-size:11px;color:var(--ai-muted);margin-top:30px;padding-bottom:12px}
@media(max-width:800px){.ai-showcase main{padding:20px 16px}.ai-header{align-items:start}.ai-showcase h1{font-size:28px}.ai-header>a{font-size:12px}.ai-notice{flex-direction:column;gap:5px}.ai-comparison{grid-template-columns:1fr}.ai-panel{padding:20px}.ai-reset{margin-left:0}.ai-drop{align-items:start}.ai-source-text{max-height:340px}}
`;
