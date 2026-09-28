import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeStaticWidgetCss, sanitizeStaticWidgetHtml, staticWidgetDocument, staticWidgetPlainText } from '../src/lib/staticWidget';

test('static widgets retain semantic content and same-document navigation only', () => {
  const sanitized = sanitizeStaticWidgetHtml('<h1 id="start">Course</h1><a href="#start">Back</a><a href="https://tracker.example">Leave</a>');
  assert.match(sanitized, /<h1 id="start">Course<\/h1>/);
  assert.match(sanitized, /href="#start"/);
  assert.doesNotMatch(sanitized, /tracker|https:/);
  assert.equal(staticWidgetPlainText(sanitized), 'Course\nBack Leave');
});

test('static widgets strip active elements, fetch attributes, handlers, and refresh escapes', () => {
  const document = staticWidgetDocument(
    '<meta http-equiv="refresh" content="0;url=https://evil.example"><script>alert(1)</script><form action="https://evil.example"><input></form><img src="https://evil.example/pixel" onerror="alert(1)"><p onclick="alert(1)">Safe</p>',
    '@import "https://evil.example/a.css"; .x{background:url(https://evil.example/pixel)} </style><script>alert(1)</script>',
    '</title><script>alert(1)</script>',
  );
  assert.doesNotMatch(document, /evil\.example|onerror|onclick|<script|<form|<input/i);
  assert.doesNotMatch(document, /<\/style><script/i);
  assert.match(document, /&lt;\/title&gt;&lt;script&gt;/);
  assert.match(document, />Safe<\/p>/);
});

test('static widgets cannot animate a sanitized fragment into remote navigation', () => {
  const document = staticWidgetDocument(
    '<svg><a href="#safe"><text>Safe link</text><set attributeName="href" to="https://tracker.example/private"></set></a><foreignObject><p>Hidden active subtree</p></foreignObject></svg>',
    '',
  );
  assert.doesNotMatch(document, /<set\b|<foreignObject\b|tracker\.example|Hidden active subtree/i);
  assert.match(document, /href="#safe"/);
  assert.match(document, /<meta name="referrer" content="no-referrer">/);
});

test('static widget CSS removes fetch-capable constructs', () => {
  const sanitized = sanitizeStaticWidgetCss('@import url(https://evil.example); .hero{background:url("https://evil.example/x")}');
  assert.doesNotMatch(sanitized, /https:|@import|url\s*\(/i);
});

test('static widgets cannot reorder focus and preserve image alternatives in native text', () => {
  const sanitized = sanitizeStaticWidgetHtml(
    '<a href="#section" tabindex="9" accesskey="s" autofocus contenteditable="true">Section</a><img src="data:image/png;base64,AA==" alt="A labelled diagram"><img src="data:image/png;base64,AA==">',
  );
  assert.doesNotMatch(sanitized, /tabindex|accesskey|autofocus|contenteditable/i);
  assert.match(sanitized, /alt="A labelled diagram"/);
  assert.match(sanitized, /<img src="data:image\/png;base64,AA==" alt="">/);
  assert.equal(staticWidgetPlainText(sanitized), 'Section A labelled diagram');
});

test('static widget documents expose a main landmark, visible focus, and reduced-motion guardrails', () => {
  const document = staticWidgetDocument('<h2>Module</h2><a href="#module">Jump</a>', 'a:focus{outline:none}');
  assert.match(document, /<main><h2>Module<\/h2>/);
  assert.match(document, /a\[href\]:focus-visible\{outline:3px solid CanvasText!important/);
  assert.match(document, /@media\(prefers-reduced-motion:reduce\)/);
  assert.ok(document.lastIndexOf('focus-visible') > document.lastIndexOf('outline:none'));
});
