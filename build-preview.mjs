// Builds preview.html by inlining src/styles.css verbatim, so the static
// preview and the React app can never drift on theme.
//   node build-preview.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8');
const body = readFileSync(new URL('./preview.body.html', import.meta.url), 'utf8');

// Preview-only styles. Nothing here belongs in the app: the card bodies are
// collapsed by hand rather than by React state, and the tooltips stand in for
// a hover layer the real app gets from the browser.
const previewOnly = `
/* ---- preview harness only ---- */
.hide { display: none; }
.card .card-body { display: none; }
.card.open .card-body { display: block; }
.seg[data-tip] { cursor: default; }
.seg[data-tip]:hover::after {
  content: attr(data-tip); position: absolute; bottom: calc(100% + 8px); left: 50%;
  transform: translateX(-50%); background: var(--text); color: var(--bg);
  border-radius: var(--radius-sm); padding: 7px 10px; font-size: 12px; font-weight: 500;
  white-space: nowrap; z-index: 9; letter-spacing: 0;
}
.banner {
  background: var(--surface-2); border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: var(--radius-sm); padding: 11px 13px; font-size: 12px; color: var(--quiet);
  margin-bottom: 4px; line-height: 1.5;
}
.banner strong { color: var(--text); }
.note {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 16px; margin-top: 24px; font-size: 13px; color: var(--quiet); line-height: 1.6;
}
.note p { margin: 10px 0 0; }
.note strong { color: var(--text); }
.mono { font-family: var(--mono); font-size: .92em; color: var(--text-soft); }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#faf9f5">
<title>haydens-trainer — Week 1 preview</title>
<style>
${css}
${previewOnly}
</style>
</head>
<body data-palette="#34A853,#FBBC05,#EA4335,#4285F4">
${body}
</body>
</html>
`;

writeFileSync(new URL('./preview.html', import.meta.url), html);
console.log(`preview.html written — ${css.length} bytes of app CSS inlined`);
