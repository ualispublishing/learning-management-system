/**
 * @fileoverview src/lib/staticWidget.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
const escapeHtmlText = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/** Removes CSS constructs that can fetch content or escape the generated style block. */
export const sanitizeStaticWidgetCss = (css: string): string => css
  .replace(/@import\s+(?:url\s*\([^)]*\)|"[^"]*"|'[^']*'|[^;]*);?/gi, '')
  .replace(/url\s*\([^)]*\)/gi, 'none')
  .replace(/expression\s*\([^)]*\)/gi, '')
  .replace(/(?:behavior|-moz-binding)\s*:[^;}]*;?/gi, '')
  // Angle brackets are not required by CSS and could otherwise terminate the
  // generated raw-text style element.
  .replace(/[<>]/g, '');

const BLOCKED_CONTAINER_ELEMENTS = 'script|style|iframe|frame|frameset|object|embed|applet|form|button|select|textarea|video|audio|foreignobject';
// SVG animation elements can mutate a sanitized fragment href into an external
// navigation after parsing. Static widgets do not need that active behavior.
const BLOCKED_VOID_ELEMENTS = 'meta|base|link|input|source|track|animate|animatemotion|animatetransform|set';
const ATTRIBUTE_VALUE = '(?:"[^"]*"|\'[^\']*\'|[^\\s>]+)';

const readAttributeValue = (rawValue: string): string => rawValue.replace(
  /^(?:"([\s\S]*)"|'([\s\S]*)')$/,
  (_match, double, single) => double ?? single ?? '',
);

/**
 * Conservative static-widget sanitizer. It retains headings, text, lists,
 * tables, data-image markup, and same-document fragment links, while removing
 * active controls, document navigation, event handlers, and fetch-capable
 * attributes. The iframe sandbox/CSP remains a second independent boundary.
 */
export const sanitizeStaticWidgetHtml = (html: string): string => {
  let result = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\?(?:.|\n)*?\?>/g, '')
    .replace(new RegExp(`<\\s*(${BLOCKED_CONTAINER_ELEMENTS})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\s*\\/?\\s*(?:${BLOCKED_CONTAINER_ELEMENTS}|${BLOCKED_VOID_ELEMENTS})\\b[^>]*>`, 'gi'), '')
    .replace(/<\s*\/?\s*(?:html|head|body)\b[^>]*>/gi, '');

  result = result.replace(new RegExp(`\\s(?:on[a-z0-9_:-]+|srcdoc|srcset|poster|action|formaction|ping|target|download|nonce|integrity|http-equiv|data)\\s*=\\s*${ATTRIBUTE_VALUE}`, 'gi'), '');
  // Authored static content cannot move focus, create an alternate tab order,
  // or reserve application-wide access keys.
  result = result.replace(new RegExp(`\\s(?:autofocus|contenteditable|accesskey|tabindex)(?:\\s*=\\s*${ATTRIBUTE_VALUE})?`, 'gi'), '');
  // Images may use bounded authored data URIs, but all other src attributes
  // are removed so a widget cannot trigger requests or tracking pixels.
  result = result.replace(new RegExp(`\\ssrc\\s*=\\s*(${ATTRIBUTE_VALUE})`, 'gi'), (attribute, rawValue: string) => {
    const unquoted = readAttributeValue(rawValue);
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(unquoted) && unquoted.length <= 1_000_000
      ? attribute
      : '';
  });
  result = result.replace(new RegExp(`\\s(?:href|xlink:href)\\s*=\\s*(${ATTRIBUTE_VALUE})`, 'gi'), (attribute, rawValue: string) => {
    const unquoted = readAttributeValue(rawValue);
    return /^#[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(unquoted) ? attribute : '';
  });
  result = result.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (_attribute, value: string) => ` style="${sanitizeStaticWidgetCss(value).replace(/"/g, '&quot;')}"`);
  result = result.replace(/\sstyle\s*=\s*'([^']*)'/gi, (_attribute, value: string) => ` style="${sanitizeStaticWidgetCss(value).replace(/"/g, '&quot;')}"`);
  // Without an explicit alt value browsers may announce the entire data URI.
  // Missing alternative text is therefore treated as intentionally decorative
  // until the author supplies a meaningful description.
  result = result.replace(/<img\b([^>]*)>/gi, (tag, attributes: string) => /\salt\s*=/i.test(attributes) ? tag : `<img${attributes} alt="">`);
  return result;
};

export const staticWidgetDocument = (html: string, css: string, title = 'Course widget') => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; navigate-to 'none'">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlText(title)}</title>
<style>html,body{box-sizing:border-box;max-width:100%;overflow:auto;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:inherit}${sanitizeStaticWidgetCss(css)}a[href]{text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.12em}a[href]:focus-visible{outline:3px solid CanvasText!important;outline-offset:3px!important}@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}</style>
</head><body style="margin:0;padding:10px"><main>${sanitizeStaticWidgetHtml(html)}</main></body></html>`;

export const staticWidgetPlainText = (html: string) => sanitizeStaticWidgetHtml(html)
  .replace(new RegExp(`<img\\b[^>]*\\salt\\s*=\\s*(${ATTRIBUTE_VALUE})[^>]*>`, 'gi'), (_tag, rawValue: string) => {
    const alt = readAttributeValue(rawValue).trim();
    return alt ? ` ${alt} ` : ' ';
  })
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n[ \t]+/g, '\n')
  .replace(/\n\s*\n+/g, '\n\n')
  .trim()
  .slice(0, 100_000);
