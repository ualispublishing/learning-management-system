/**
 * @fileoverview src/lib/demoEmbeddedCoursePortal.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const PROGRAMMING_COURSE_PORTAL_ID = 'programming-course-v1' as const;

export type DemoEmbeddedCoursePortalId = typeof PROGRAMMING_COURSE_PORTAL_ID;

const PROGRAMMING_COURSE_PORTAL_DOCUMENT = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />
  <title>Foundations Portal</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #07111f; color: #eef7ff; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; min-width: 280px; background: radial-gradient(circle at 76% -12%, #163a58 0, #07111f 38rem); }
    a { color: inherit; }
    a:focus-visible, summary:focus-visible { outline: 3px solid #62d9ff; outline-offset: 4px; border-radius: 6px; }
    header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px clamp(18px, 4vw, 46px); border-bottom: 1px solid #27445c; background: rgba(7,17,31,.94); backdrop-filter: blur(14px); }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 850; letter-spacing: -.02em; }
    .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: #43ccf2; color: #07111f; font-family: ui-monospace, monospace; }
    nav { display: flex; gap: 8px; flex-wrap: wrap; }
    nav a { padding: 8px 11px; border-radius: 9px; color: #b8c9d8; text-decoration: none; font-size: 13px; font-weight: 750; }
    nav a:hover { background: #13283b; color: #fff; }
    main { width: min(1180px, calc(100% - 36px)); margin: 0 auto; padding: 34px 0 60px; }
    .eyebrow { margin: 0 0 10px; color: #62d9ff; font-size: 12px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(240px, .75fr); gap: 22px; align-items: stretch; }
    .panel { border: 1px solid #27445c; border-radius: 20px; background: rgba(13,31,47,.88); box-shadow: 0 24px 70px rgba(0,0,0,.2); }
    .welcome { padding: clamp(24px, 4vw, 44px); }
    h1 { margin: 0; max-width: 15ch; font-size: clamp(32px, 5vw, 58px); line-height: .99; letter-spacing: -.055em; }
    .lede { max-width: 65ch; margin: 18px 0 0; color: #b8c9d8; font-size: 16px; line-height: 1.65; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 11px; background: #43ccf2; color: #07111f; text-decoration: none; font-weight: 850; }
    .button.secondary { border: 1px solid #34536b; background: #102438; color: #eef7ff; }
    .progress { display: grid; align-content: space-between; padding: 26px; background: linear-gradient(145deg, #12334c, #0a1b2b); }
    .progress strong { display: block; margin: 8px 0 0; font-size: 54px; letter-spacing: -.06em; }
    .meter { height: 10px; overflow: hidden; border-radius: 999px; background: #203c52; }
    .meter span { display: block; width: 42%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #43ccf2, #34dda5); }
    .muted { color: #9fb5c6; font-size: 13px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
    .card { grid-column: span 4; padding: 22px; border: 1px solid #27445c; border-radius: 17px; background: #0d1f2f; }
    .card.wide { grid-column: span 8; }
    .card h2 { margin: 4px 0 9px; font-size: 20px; letter-spacing: -.025em; }
    .tag { display: inline-flex; padding: 5px 8px; border-radius: 999px; background: #173b4b; color: #75e3ff; font-size: 11px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
    .list { display: grid; gap: 10px; margin: 15px 0 0; padding: 0; list-style: none; }
    .list li { display: grid; grid-template-columns: 34px 1fr auto; gap: 11px; align-items: center; padding: 12px; border: 1px solid #243e53; border-radius: 12px; background: #0a1927; }
    .number { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: #173b4b; color: #62d9ff; font-weight: 850; }
    .status { color: #59e0af; font-size: 12px; font-weight: 800; }
    pre { overflow: auto; margin: 15px 0 0; padding: 17px; border: 1px solid #213b50; border-radius: 13px; background: #050d17; color: #d9f4ff; font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .accent { color: #71e3ff; }
    .due { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #27445c; }
    details { margin-top: 13px; border: 1px solid #27445c; border-radius: 12px; background: #091826; }
    summary { cursor: pointer; padding: 13px 15px; color: #dff6ff; font-weight: 800; }
    details p { margin: 0; padding: 0 15px 15px; color: #a9bfce; line-height: 1.55; }
    footer { padding: 6px 0 0; color: #7892a5; font-size: 12px; text-align: center; }
    @media (max-width: 760px) { .hero { grid-template-columns: 1fr; } .card, .card.wide { grid-column: 1 / -1; } header { align-items: flex-start; } nav { justify-content: flex-end; } }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  </style>
</head>
<body>
  <header>
    <div class="brand"><span class="brand-mark" aria-hidden="true">&lt;/&gt;</span><span>Foundations Portal</span></div>
    <nav aria-label="Portal sections"><a href="#overview">Overview</a><a href="#modules">Modules</a><a href="#lab">Lab</a></nav>
  </header>
  <main id="overview">
    <section class="hero" aria-labelledby="portal-title">
      <div class="panel welcome">
        <p class="eyebrow">CS 101 · Fall term</p>
        <h1 id="portal-title">Build ideas into programs.</h1>
        <p class="lede">A focused course home for lectures, practice, and weekly milestones. This project-owned portal demonstrates how a complete external learning site can live inside the LMS without inheriting the surrounding course page.</p>
        <div class="actions"><a class="button" href="#lab">Continue Week 4</a><a class="button secondary" href="#modules">View learning path</a></div>
      </div>
      <aside class="panel progress" aria-label="Course progress">
        <div><p class="eyebrow">Your progress</p><strong>42%</strong><p class="muted">8 of 19 activities complete</p></div>
        <div><div class="meter" role="progressbar" aria-label="Course completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42"><span></span></div><p class="muted">On track · next milestone Friday</p></div>
      </aside>
    </section>

    <section class="grid" id="modules" aria-label="Course dashboard">
      <article class="card wide">
        <span class="tag">Learning path</span><h2>This week’s sequence</h2>
        <ol class="list">
          <li><span class="number">1</span><span><strong>Trace state changes</strong><br><span class="muted">Lecture notes · 18 min</span></span><span class="status">Complete</span></li>
          <li><span class="number">2</span><span><strong>Accumulator patterns</strong><br><span class="muted">Guided code lab</span></span><span class="status">Current</span></li>
          <li><span class="number">3</span><span><strong>Complexity checkpoint</strong><br><span class="muted">Five-question practice</span></span><span class="muted">Up next</span></li>
        </ol>
      </article>
      <aside class="card">
        <span class="tag">Next due</span><h2>Compression lab</h2><p class="muted">Explain one invariant, submit two tests, and compare the generated operation counts.</p>
        <div class="due"><strong>Friday · 5:00 PM</strong><span class="status">5 pts</span></div>
        <details><summary>Submission checklist</summary><p>Readable function, edge-case tests, and a two-sentence complexity note.</p></details>
      </aside>
      <article class="card wide" id="lab">
        <span class="tag">Pattern library</span><h2>One-pass accumulator</h2><p class="muted">Keep the output and the state needed to recognize the next run in one structure.</p>
        <pre><span class="accent">def</span> compress(values):
    result = []
    <span class="accent">for</span> value in values:
        <span class="accent">if</span> result and result[-1][0] == value:
            result[-1][1] += 1
        <span class="accent">else</span>:
            result.append([value, 1])
    <span class="accent">return</span> result</pre>
      </article>
      <aside class="card"><span class="tag">Office hours</span><h2>Bring one failing case</h2><p class="muted">Thursday, 2–4 PM · Lab 204. Pair debugging starts every 20 minutes.</p><details><summary>What to prepare</summary><p>Your smallest failing input, current output, and expected output.</p></details></aside>
    </section>
    <footer><p>Project-owned demonstration · static, sandboxed, and network-free</p></footer>
  </main>
</body>
</html>`;

export const getDemoEmbeddedCoursePortalDocument = (value: unknown): string | null => (
  value === PROGRAMMING_COURSE_PORTAL_ID ? PROGRAMMING_COURSE_PORTAL_DOCUMENT : null
);
