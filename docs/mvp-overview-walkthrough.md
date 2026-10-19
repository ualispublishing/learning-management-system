# LMS MVP overview walkthrough

This is the shortest useful product-review path through the current local demo.
It uses synthetic data only and takes about 10–15 minutes.

## Start

```sh
npm run web
```

Open `http://127.0.0.1:4178` and choose a demo role. The prepared AI before-and-after
showcase is available from the sign-in screen or directly at `/ai-demo`.
For a complete feature map, open **Explore all demo features** or `/demo`.
Selecting a course or learning feature there prompts for a role if needed and
continues to that destination. Returning from AI to the LMS keeps a signed-in
session; refreshing the browser still intentionally signs it out.
The local demo is ready for a product overview;
it is not an institution-production deployment. Production still requires the
gateway, SSO, durable services, approved integrations, signed builds, and the
manual accessibility/device acceptance recorded in the release documents.

## Recommended review order

Use **Demo guide** in the header to move between areas, including from course,
deck, review and statistics screens. AI, institution colour preview and the
institution setup walkthrough can also be opened directly from the guide.

1. **Courses → Institution & business activation → Open activation journey**
   - Complete the six sequential deployment-owner stages: organization, identity,
     learning data, governance, pilot preflight, and activation handoff.
   - Confirm the journey supports education and business contexts, saves a
     browser-local draft, and never claims to create a real tenant or connection.
   - Finish at the simulated pilot workspace, then use Start over if needed.

2. **Courses → Replay role onboarding**
   - Confirm the role tour presents Steps 1, 2, and 3 sequentially.
   - Use Back and Next, then confirm Finish appears only on Step 3.

3. **Resize the desktop canvas**
   - Use either centered side control.
   - Confirm both controls remain outside the app canvas and operate the same
     768–1280 px range by pointer or keyboard.

4. **Courses → Foundations of Programming (Linked Site Demo)**
   - Choose Student Preview.
   - Review the full learning-area portal, then enter and exit Focus mode.
   - Confirm the portal provides its own dashboard, learning path, code pattern,
     due work, and office-hours content without an external network request.

5. **Courses → Foundations of Programming (Learning Workspace Demo)**
   - Choose Student Preview and open Algorithm Studio.
   - Review Dashboard, Code lab, and Visualization.
   - Check a solution, reveal the hint, and generate another deterministic chart.
     Learner code is inspected as text and is never executed or uploaded.

6. **Learn**
   - The four showcase decks appear before the generic sample decks.
   - Open **Foundations of Programming · Concept Ladder** in Study mode.
   - Reveal cards, edit a note, move through progressive layers, and inspect the
     optional MIT OCW video card and its linked text alternative.
   - Briefly compare the Statistics, Scientific Reasoning, and Learn Workflow
     decks to see different pedagogical patterns.

7. **Principal-scoped state**
   - Change a course layout or study position as Dr. Smith.
   - Switch to Student A and confirm teacher-only controls and teacher state are
     absent.
   - Switch back and refresh; the original principal's supported resume state
     should return without crossing identities.

## Deferred MVP roadmap

The course-card notification/announcement row, due-date row, viewed/submitted
colour states, and overall new-content indicator are intentionally excluded
from this review. Their UI/type remnants are not backed by current repository
data and must not be treated as working features.

Generic cross-origin embedded sites also cannot expose internal clicks, answers,
scroll position, or completion to the LMS. Only approved provider integrations
can supply a safe resume token or activity feed. The project-owned demo portal
is deliberately static, sandboxed, and network-free.

## Readiness decision

- **Ready:** local MVP/product overview using synthetic data.
- **Not ready:** production institution pilot or public release until the
  external-service, security/privacy, licensing, deployment, and manual
  device/accessibility gates in `docs/release-closeout-2026-08-20.md` are closed.

The 2026-09-17 overview candidate passed lint, strict TypeScript, four fixture
validations, security/configuration checks, 391 automated tests, 270 synthetic
journeys covering 1,620 ordered steps, dependency alignment, the strict live
dependency-audit policy, SBOM/notices freshness, and exported-web verification.
