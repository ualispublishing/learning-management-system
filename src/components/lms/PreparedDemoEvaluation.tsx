import React, { useState } from 'react';

/** Published evidence is context for a pilot, never a measured result for this app. */
export function PreparedDemoEvaluation() {
  const [open, setOpen] = useState(false);
  return <section className="ai-evaluation" style={{ marginTop: 28 }} aria-label="Demo evaluation">
    <button className="ai-primary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide evaluation' : 'Finish demo · View evaluation'}</button>
    {open && <div className="ai-panel" style={{ marginTop: 16 }}>
      <p className="ai-eyebrow">03 · Evaluation</p>
      <h2>Less authoring. More time for teaching.</h2>
      <p>The workflow turns existing sources into course fields and a study set. The instructor checks the draft, resolves flagged details and publishes it.</p>
      <h3>What this demo establishes</h3>
      <ul><li>Prepared files produce structured, cited drafts through the course import service.</li><li>The previews use the same course information and flashcard components as the LMS.</li><li>Source matching, quotations and response structure are checked. Meaning, coverage and instructor approval still require review.</li></ul>
      <h3>Published research on teacher workload</h3>
      <p className="ai-note">Sources checked October 7, 2026. These studies examine other AI workflows in schools; they do not measure this app, university teaching, or GPT-6 Astra.</p>
      <section className="ai-mapping">
        <h4>31% less preparation time · controlled trial</h4>
        <p>In an EEF trial evaluated by NFER, 259 teachers in 68 English secondary schools were assigned to prepare Year 7–8 science lessons with ChatGPT and a guide, or without generative AI. Reported weekly preparation time for the target lessons averaged 56.2 versus 81.5 minutes—a 25.3-minute reduction.</p>
        <p className="ai-note">Published December 2024. A limited, independently reviewed sample showed no noticeable resource-quality difference; that does not establish equal quality for every lesson or improved student outcomes.</p>
        <a href="https://educationendowmentfoundation.org.uk/news/teachers-using-chatGPT-alongside-a-guide-to-support-them-to-use-it-effectively-can-cut-lesson-planning-time-by-over-30-per-cent" target="_blank" rel="noreferrer">Read the EEF trial findings ↗</a>
      </section>
      <section className="ai-mapping">
        <h4>5.9 hours saved per week · self-reported survey</h4>
        <p>In Gallup and the Walton Family Foundation’s 2025 survey of 2,232 U.S. public K–12 teachers, weekly AI users estimated average savings of 5.9 hours across their work tasks.</p>
        <p className="ai-note">Published June 24, 2025. This is an estimate from respondents, not a randomized test or a claim that every teacher saves this amount.</p>
        <a href="https://news.gallup.com/poll/691967/three-teachers-weekly-saving-six-weeks-year.aspx" target="_blank" rel="noreferrer">Read the Gallup survey and methodology ↗</a>
      </section>
      <h3>How we would evaluate an institution pilot</h3>
      <p>Compare manual authoring with the complete assisted workflow on comparable materials. Include upload, generation, review, corrections and publishing time. Have subject experts check meaning, formulas, exceptions, missing concepts and study usefulness.</p>
      <p><strong>App-specific time savings and educational accuracy: not yet measured.</strong> Prepared replay speed is not live generation speed. The six-card lesson excerpt is a demonstration, not a complete course study set.</p>
    </div>}
  </section>;
}
