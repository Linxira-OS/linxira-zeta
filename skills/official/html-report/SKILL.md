---
name: html-report
description: "Build a self-contained visual report for an audit, roadmap, status review, or architecture comparison as one HTML file: executive summary, metrics, status heatmap, inline-SVG diagrams, evidence-cited findings, risks, decisions, and appendices. Use when the user asks for a visual report, dashboard, audit summary, or a browsable/printable artifact delivered at `local://<name>.html`; skip it for small prose answers, a single finding, or anything that fits in chat."
---

# Visual HTML report

A visual report turns several evidence-backed inputs into one browsable artifact: what is true, how bad it is, what it depends on, and what must be decided. It is a summary over evidence, not a source of truth and not a substitute for an ADR, PRD, or test.

## When to use

Use it when the answer is **multi-section and decision-shaped**:

- a full or domain audit with many findings that need severity, evidence, and impact;
- roadmap or release-readiness status across several workstreams;
- an architecture comparison (current vs target, or option A vs option B);
- a status/metrics review for an audience that will skim, browse, or print it;
- a hand-off artifact that must survive without the chat transcript.

Skip it when the answer is a short explanation, a single finding, a code review comment, a bug report, or a change whose result is best expressed as a diff, command output, or a paragraph. Do not build a report to decorate a one-line answer.

## Input contract

Collect these before writing. If one is missing, record it as a gap in the appendix instead of inventing it.

- **Source artifacts** — the files, notes, transcripts, PRs, and prior audits being summarized. List them by name in the appendix; the report must not silently introduce facts that are not in an input.
- **Scope and baseline** — repository, branch, commit SHA, date, and what was explicitly **not** examined.
- **Evidence** — `path:line`, PR/issue number, test name, release/tag, or command output. Every claim needs one.
- **Audience and decision** — who reads it and what they must decide or approve. The executive summary answers the decision, not the methodology.
- **Language and length** — match the user's language; keep the artifact as short as the decision allows.

Work read-only unless the user asks for changes: the report describes the baseline, it does not quietly mutate it.

## Output contract

- **Primary:** `local://<name>.html` — one self-contained file, no build step, no network.
- **Optional:** `local://<name>.md` — the execution version of the same conclusions (lanes, checklists, acceptance gates). Do not duplicate the visual layer in Markdown; keep tables and ordered steps.
- Name both with lowercase kebab-case (`full-audit-report`, not `Report_Final_v2`). Keep the date in the hero and footer, not the filename.
- Deliver the path plus a two-or-three-sentence summary. Never paste the HTML body into chat.
- The report may state recommendations, but it does not claim a release, merge, or approval that has not happened.

## Required structure

Use this order; number sections `01`, `02`, … so readers can cite them.

1. **Hero** — title, one-line purpose, baseline commit, date, and what the report is not (for example "read-only, no release").
2. **Executive summary** — three to five headline metrics, the one-sentence conclusion, and one callout naming the single most important action.
3. **Status / metrics** — counts, percentages, and completion state with the counting rule stated next to the number.
4. **Heatmap** — one row per domain, severity/completion columns, and a legend. Use it for comparison, not for raw detail.
5. **Architecture diagrams** — inline SVG only. Draw confirmed layers and confirmed breakpoints; label each figure and give it a reading instruction.
6. **Findings** — grouped table with `ID`, severity, finding, evidence (`file:line` / PR / test / release), impact, and status.
7. **Risks and decisions** — risk, likelihood/impact, mitigation, and the decision needed with its owner. Separate "needs approval" from "already decided".
8. **Appendices** — input artifacts, counting rules, boundary/uncertainty notes, and unverified items.

Every section must change what a reader understands or decides. Merge or delete sections that only restate the title.

## Visual rules

- **Theme:** dark by default, real light theme via `@media (prefers-color-scheme: light)`, and a white A4 print stylesheet. Keep both themes legible; never hard-code a color that only works on one background.
- **Self-contained:** inline `<style>` and inline `<svg>` only. No `<script>`, no external CSS/JS/fonts/images, no CDN, no base64 payloads, no iframes.
- **Links:** use only in-document anchors (`href="#findings"`) or plain `<code>` paths. External references are text, not live links, so the file stays offline-safe.
- **Layout:** one `max-width` wrapper (~1180px), CSS grid/flex cards, responsive breakpoints at 980px and 720px. Tables scroll or shrink rather than overflowing.
- **Print:** `@page { size: A4; margin: 11mm }`, hide the table of contents, `break-inside: avoid` on cards/tables/figures, and a light palette with readable contrast.
- **Diagrams:** at most about eight lanes or boxes per figure, consistent colors for implemented / partial / missing, arrow markers defined once per SVG, `role="img"` and `aria-label` on every figure.
- **Density:** prefer tables and cards over prose. A metric appears once — not as a number, a chart, and a table row repeating the same value.
- **Accessibility:** `lang`, a unique `<title>`, semantic headings, no color-only status (pair the badge with text), and tabular numbers in metric cells.

## Evidence rules

- Every finding row cites its evidence in the row: `path:line`, PR/issue, test file, release tag, or command output. A claim without a citation is an opinion and must be labeled as one.
- Mark unobserved conclusions as `[INFERENCE]` and say what would confirm them. Never promote a plausible reading of the code to "verified behavior".
- Metrics need a numerator, a denominator, and a counting rule. State how "partial" is scored; do not compare percentages computed with different rules without saying so.
- Never fabricate numbers, dates, authors, test counts, or benchmark results. If a number cannot be derived from an input, omit it or write `not measured`.
- Do not copy secrets: redact tokens, keys, cookies, account IDs, and private URLs. Cite the file and line instead of pasting the value.
- Do not include screenshots, recordings, or browser captures unless the user asks for them; a visual report is not a screenshot dump.

## Validation

Run these checks before delivering. They are cheap and catch the failures readers notice first.

1. **Well-formed HTML** — every tag closed, attributes quoted, nested lists/tables valid. Inline SVG is XML: escape `&`, `<`, and `>` in text, and close every element.
2. **No executable or remote content** — zero `<script`, zero external `src=`, zero `href="http…`. Only `#anchor` links remain.
3. **Unique IDs** — every `id` appears once, and every `href="#…"` resolves to an existing `id`.
4. **Anchors and headings** — the table of contents matches the section IDs, and section numbers are sequential.
5. **Optional headless render** — if a browser is available and the user wants it, render with `chrome --headless=new --screenshot` or open the file locally; check desktop, narrow width, and print preview. Do not install a browser for this.
6. **Print readability** — tables are not clipped, badges remain readable in grayscale, and no dark-only text lands on a white page.
7. **Offline check** — open the file with networking unavailable; it must render identically.

## Workflow

1. **Read the artifacts.** Read every input, then build an evidence table (claim → source → confidence) before writing prose.
2. **Outline.** Choose the three to five conclusions the report must land, then the sections that support them. Cut sections that do not support a conclusion.
3. **Build.** Start from the template below, replace placeholders, and write one section at a time. Keep the HTML readable: one block per section, indented.
4. **Validate.** Run the checks above, fix IDs/links/escaping, and confirm the file opens offline.
5. **Deliver.** Write to `local://<name>.html` (and optionally `local://<name>.md`), then report the path, the headline conclusion, and the items marked `[INFERENCE]` or unverified.

## Template

Copy this skeleton and fill the placeholders. It already carries the dark/light/print themes, metric cards, heatmap, SVG figure, findings table, and appendix, with no scripts or external assets.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>{{TITLE}} · {{DATE}}</title>
<style>
:root{--bg:#0a0f15;--panel:#0f1720;--panel2:#121c27;--line:#223041;--line2:#2d4055;
--text:#e7eef7;--muted:#9db0c4;--dim:#6f8499;--accent:#5eead4;--accent2:#60a5fa;
--warn:#fbbf24;--bad:#fb7185;--ok:#34d399;--radius:12px;--shadow:0 10px 30px rgba(0,0,0,.25)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;color:var(--text);background:var(--bg);
font:14px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","Microsoft YaHei",sans-serif;
-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:36px 28px 64px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;
background:#0a1118;color:#c7d7e6;border:1px solid var(--line);border-radius:5px;padding:1px 5px;
word-break:break-word}
.hero{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:18px;
padding:34px 36px 30px;background:linear-gradient(135deg,rgba(17,28,39,.96),rgba(9,15,22,.96));
box-shadow:var(--shadow)}
.kicker{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:700}
h1{margin:10px 0;font-size:34px;line-height:1.18;letter-spacing:-.02em}
.lede{margin:0;max-width:780px;color:#c3d2e1;font-size:15px}
.hero-meta{margin-top:18px;display:flex;gap:8px 18px;flex-wrap:wrap;color:var(--muted);font-size:12px}
.toc{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 26px}
.toc a{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;
padding:5px 11px;background:rgba(15,23,32,.7)}
.toc a:hover{color:var(--text);border-color:var(--line2);text-decoration:none}
section{margin-top:34px}
h2{display:flex;align-items:baseline;gap:10px;margin:0 0 14px;font-size:23px;line-height:1.25}
h2:before{content:"";width:5px;height:22px;border-radius:3px;
background:linear-gradient(var(--accent),var(--accent2));flex:none}
h2 .n{font:11px/1 ui-monospace,Consolas,monospace;color:var(--dim);letter-spacing:.12em}
h3{margin:22px 0 10px;font-size:15px;color:#d9e6f3}
p{margin:8px 0}
.muted{color:var(--muted)}
.small{font-size:12px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0 12px}
.metric{border:1px solid var(--line);border-radius:var(--radius);padding:16px;
background:linear-gradient(180deg,var(--panel),rgba(15,23,32,.65));box-shadow:var(--shadow)}
.metric .num{font-size:33px;line-height:1;font-weight:750;letter-spacing:-.03em;color:var(--accent);
font-variant-numeric:tabular-nums}
.metric .num.bad{color:var(--bad)}
.metric .label{margin-top:9px;font-size:12px;color:#c5d4e3;font-weight:600}
.metric .sub{margin-top:4px;font-size:11px;color:var(--dim)}
.card{border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;
background:linear-gradient(180deg,var(--panel),var(--panel2));box-shadow:var(--shadow)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.callout{border-left:3px solid var(--accent);border-radius:0 10px 10px 0;padding:13px 16px;
background:rgba(94,234,212,.06);color:#cfe1ee;margin:14px 0}
.callout.warn{border-left-color:var(--warn);background:rgba(251,191,36,.07)}
.callout.bad{border-left-color:var(--bad);background:rgba(251,113,133,.07)}
.callout strong{color:#fff}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin:10px 0 0}
th{text-align:left;font-size:10.5px;letter-spacing:.045em;text-transform:uppercase;color:var(--muted);
background:#111b25;border-bottom:1px solid var(--line2);padding:8px 9px;font-weight:700;white-space:nowrap}
td{border-bottom:1px solid var(--line);padding:8px 9px;vertical-align:top}
tr:hover td{background:rgba(94,234,212,.03)}
tr.group td{background:#0d1721;color:var(--accent);font-weight:700;letter-spacing:.04em;
font-size:11px;text-transform:uppercase}
.num-cell{font-variant-numeric:tabular-nums;white-space:nowrap}
.badge{display:inline-block;font:10.5px/1.4 ui-monospace,Consolas,monospace;font-weight:700;
border-radius:5px;padding:1px 6px;border:1px solid;white-space:nowrap}
.p0{color:#ffd0d8;background:rgba(251,113,133,.18);border-color:rgba(251,113,133,.55)}
.p1{color:#ffe6b0;background:rgba(251,191,36,.14);border-color:rgba(251,191,36,.45)}
.p2{color:#c7d8ea;background:rgba(96,165,250,.12);border-color:rgba(96,165,250,.4)}
.ok{color:#b9f6d9;background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.4)}
.heat td{text-align:center;font-weight:700}
.h4{background:rgba(52,211,153,.22);color:#b8f7da}
.h2{background:rgba(251,191,36,.10);color:#ffe6b0}
.h0{background:rgba(148,163,184,.08);color:#9aa9b9}
.legend{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:10px 0 0;
font-size:11px;color:var(--muted)}
.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-2px}
figure{margin:16px 0 0;background:var(--panel);border:1px solid var(--line);
border-radius:var(--radius);padding:14px;box-shadow:var(--shadow)}
figure svg{width:100%;height:auto;display:block;border-radius:8px;background:#0b1219;border:1px solid var(--line)}
figcaption{margin-top:10px;color:var(--muted);font-size:12px}
figcaption strong{color:#dbe8f4}
.s-box{fill:#111c27;stroke:#2b4056;stroke-width:1.2}
.s-box-bad{fill:#2a1218;stroke:#fb7185;stroke-width:1.3;stroke-dasharray:5 4}
.s-line{stroke:#4b657e;stroke-width:1.4;fill:none}
.s-text{fill:#dbe7f3;font-size:12px;font-family:inherit}
.s-title{fill:#e7eef7;font-size:14px;font-weight:700;font-family:inherit}
.s-small{fill:#9db0c4;font-size:10.5px;font-family:inherit}
.s-bad-text{fill:#fb7185;font-size:10.5px;font-family:inherit}
footer{margin-top:42px;border-top:1px solid var(--line);padding-top:18px;color:var(--dim);font-size:11.5px}
footer strong{color:var(--muted)}
@media(prefers-color-scheme:light){
:root{--bg:#f7f9fb;--panel:#fff;--panel2:#f2f5f8;--line:#dbe3ec;--line2:#c3d0de;
--text:#0f1720;--muted:#4b5d70;--dim:#6b7c8f;--accent:#0f766e;--accent2:#1d4ed8;
--warn:#a16207;--bad:#b91c1c;--ok:#047857;--shadow:0 6px 18px rgba(15,23,32,.08)}
.hero{background:linear-gradient(135deg,#fff,#f2f5f8)}
.kicker{color:var(--accent)}
h1{color:var(--text)}.lede{color:#243447}h3{color:#16232f}
.metric{background:#fff}.metric .label{color:#243447}
.card{background:#fff}
th{background:#eef2f6;color:#3d4c5c}
tr.group td{background:#eef2f6;color:var(--accent)}
figure svg{background:#fff}
.s-box{fill:#f7f8fa;stroke:#8a99a8}
.s-box-bad{fill:#fde8ea;stroke:#b91c1c}
.s-line{stroke:#6b7c8f}
.s-text,.s-title{fill:#0f1720}.s-small{fill:#4b5d70}.s-bad-text{fill:#b91c1c}
}
@media(max-width:980px){.metrics{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}
@media(max-width:720px){.wrap{padding:22px 14px 44px}h1{font-size:27px}h2{font-size:20px}
.metrics{grid-template-columns:1fr}table{font-size:11px}th,td{padding:6px}}
@media print{
@page{size:A4;margin:11mm}
body{background:#fff;color:#111;font-size:9.2pt;line-height:1.42}
.wrap{max-width:none;padding:0}
.toc,.no-print{display:none!important}
.hero{background:#f5f5f5;border:1px solid #ccc;box-shadow:none;padding:16px 18px;border-radius:8px}
h1{font-size:22pt}.lede{color:#222;font-size:10pt}.hero-meta{color:#444}
h2{font-size:14pt;margin-top:16pt;break-after:avoid}h3{font-size:10.5pt;break-after:avoid}
section{margin-top:16pt}
.card,.metric,figure,table{break-inside:avoid;box-shadow:none;background:#fff;border-color:#bbb}
.metric{padding:8px}.metric .num{font-size:20pt}.metric .label,.metric .sub{color:#222}
table{font-size:7.8pt}th{background:#eee;color:#111;border-color:#bbb;font-size:7pt}
td{border-color:#ccc}code{background:#f2f2f2;border-color:#ddd;color:#111}
.badge,.heat td,.h4,.h2,.h0{background:#eee!important;color:#111!important;border-color:#999!important}
.legend i{border:1px solid #999}
svg{background:#fff;border-color:#bbb}
.s-box{fill:#f7f7f7;stroke:#777}.s-box-bad{fill:#fde8ea;stroke:#b91c1c}
.s-text,.s-title{fill:#111}.s-small{fill:#333}.s-line{stroke:#555}.s-bad-text{fill:#b91c1c}
a{color:#111;text-decoration:none}.callout{background:#f4f4f4;border-left-color:#777}
}
</style>
</head>
<body>
<div class="wrap">

<header class="hero">
  <div class="kicker">{{SCOPE}} · {{REPORT_KIND}} · {{DATE}}</div>
  <h1>{{TITLE}}</h1>
  <p class="lede">{{ONE_SENTENCE_PURPOSE}}</p>
  <div class="hero-meta">
    <span>Baseline <code>{{BRANCH}}@{{SHORT_SHA}}</code></span>
    <span>Report date {{DATE}}</span>
    <span>{{NON_GOAL}}</span>
    <span>Scope limited to the listed evidence</span>
  </div>
</header>

<nav class="toc no-print" aria-label="Contents">
  <a href="#summary">Executive summary</a>
  <a href="#status">Status</a>
  <a href="#architecture">Architecture</a>
  <a href="#findings">Findings</a>
  <a href="#risks">Risks and decisions</a>
  <a href="#appendix">Evidence and method</a>
</nav>

<main>
<section id="summary">
  <h2><span class="n">01</span>Executive summary</h2>
  <div class="metrics">
    <div class="metric"><div class="num">{{M1}}</div><div class="label">{{M1_LABEL}}</div><div class="sub">{{M1_RULE}}</div></div>
    <div class="metric"><div class="num">{{M2}}</div><div class="label">{{M2_LABEL}}</div><div class="sub">{{M2_RULE}}</div></div>
    <div class="metric"><div class="num">{{M3}}</div><div class="label">{{M3_LABEL}}</div><div class="sub">{{M3_RULE}}</div></div>
    <div class="metric"><div class="num bad">{{M4}}</div><div class="label">{{M4_LABEL}}</div><div class="sub">{{M4_RULE}}</div></div>
  </div>
  <div class="callout">
    <strong>{{CONCLUSION_ONE_SENTENCE}}</strong>
    {{WHAT_IT_MEANS_AND_WHAT_IT_DOES_NOT_MEAN}}
  </div>
</section>

<section id="status">
  <h2><span class="n">02</span>Status and metrics</h2>
  <table class="heat">
    <thead><tr><th>Domain</th><th>Done</th><th>Partial</th><th>Missing</th><th>Score</th><th>Evidence</th></tr></thead>
    <tbody>
      <tr><td>{{DOMAIN_1}}</td><td class="h4">{{DONE}}</td><td class="h2">{{PARTIAL}}</td><td class="h0">{{MISSING}}</td><td class="num-cell">{{SCORE}}</td><td><code>{{PATH_OR_PR}}</code></td></tr>
      <tr><td>{{DOMAIN_2}}</td><td class="h4">{{DONE}}</td><td class="h2">{{PARTIAL}}</td><td class="h0">{{MISSING}}</td><td class="num-cell">{{SCORE}}</td><td><code>{{PATH_OR_PR}}</code></td></tr>
    </tbody>
  </table>
  <div class="legend">
    <span><i class="h4"></i>Done</span><span><i class="h2"></i>Partial</span><span><i class="h0"></i>Missing</span>
    <span>Counting rule: {{COUNTING_RULE}}</span>
  </div>
</section>

<section id="architecture">
  <h2><span class="n">03</span>Architecture</h2>
  <p class="muted">Draw only confirmed layers and breakpoints. Green = implemented, amber = partial, red dashed = confirmed missing.</p>
  <figure>
    <svg viewBox="0 0 960 420" role="img" aria-label="{{DIAGRAM_ALT}}">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#4b657e"/>
        </marker>
      </defs>
      <text x="24" y="28" class="s-title">{{FIGURE_TITLE}}</text>
      <text x="24" y="46" class="s-small">{{FIGURE_READING_HINT}}</text>
      <rect x="40" y="80" width="220" height="64" rx="8" class="s-box"/>
      <text x="150" y="106" text-anchor="middle" class="s-text">{{NODE_A}}</text>
      <text x="150" y="124" text-anchor="middle" class="s-small">{{NODE_A_DETAIL}}</text>
      <rect x="340" y="80" width="220" height="64" rx="8" class="s-box"/>
      <text x="450" y="106" text-anchor="middle" class="s-text">{{NODE_B}}</text>
      <text x="450" y="124" text-anchor="middle" class="s-small">{{NODE_B_DETAIL}}</text>
      <rect x="640" y="80" width="220" height="64" rx="8" class="s-box-bad"/>
      <text x="750" y="106" text-anchor="middle" class="s-text">{{MISSING_NODE}}</text>
      <text x="750" y="124" text-anchor="middle" class="s-bad-text">{{MISSING_DETAIL}}</text>
      <line x1="260" y1="112" x2="340" y2="112" class="s-line" marker-end="url(#arrow)"/>
      <line x1="560" y1="112" x2="640" y2="112" class="s-line" marker-end="url(#arrow)"/>
      <text x="40" y="200" class="s-bad-text">{{BREAKPOINT_NOTE}}</text>
      <text x="40" y="220" class="s-small">{{SUPPORTING_NOTE}}</text>
    </svg>
    <figcaption><strong>Reading:</strong> {{HOW_TO_READ_THE_DIAGRAM}}</figcaption>
  </figure>
</section>

<section id="findings">
  <h2><span class="n">04</span>Findings</h2>
  <p class="muted">Only evidence-backed items. P0 = shipped behavior is wrong or a security boundary is missing; P1 = main path unusable; P2 = secondary path or experience gap; P3 = cleanup.</p>
  <table>
    <thead><tr><th>ID</th><th>Severity</th><th>Finding</th><th>Evidence</th><th>Impact / status</th></tr></thead>
    <tbody>
      <tr class="group"><td colspan="5">{{FINDING_GROUP}}</td></tr>
      <tr><td>{{F1}}</td><td><span class="badge p1">{{F1_SEVERITY}}</span></td><td><strong>{{F1_TITLE}}</strong> {{F1_DETAIL}}</td><td><code>{{F1_EVIDENCE}}</code></td><td>{{F1_IMPACT}}</td></tr>
      <tr><td>{{F2}}</td><td><span class="badge p0">{{F2_SEVERITY}}</span></td><td><strong>{{F2_TITLE}}</strong> {{F2_DETAIL}}</td><td><code>{{F2_EVIDENCE}}</code></td><td>{{F2_IMPACT}}</td></tr>
    </tbody>
  </table>
</section>

<section id="risks">
  <h2><span class="n">05</span>Risks and decisions</h2>
  <div class="grid2">
    <div class="card">
      <h3>Risks</h3>
      <table>
        <thead><tr><th>Risk</th><th>Likelihood / impact</th><th>Mitigation</th></tr></thead>
        <tbody>
          <tr><td>{{RISK_1}}</td><td>{{RISK_1_LEVEL}}</td><td>{{RISK_1_MITIGATION}}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Decisions needed</h3>
      <table>
        <thead><tr><th>Decision</th><th>Owner</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>{{DECISION_1}}</td><td>{{OWNER_1}}</td><td>{{STATUS_1}}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<section id="appendix">
  <h2><span class="n">06</span>Evidence and method</h2>
  <div class="grid2">
    <div class="card">
      <h3>Input artifacts</h3>
      <table>
        <thead><tr><th>File</th><th>Used for</th></tr></thead>
        <tbody>
          <tr><td><code>{{INPUT_1}}</code></td><td>{{INPUT_1_USE}}</td></tr>
          <tr><td><code>{{INPUT_2}}</code></td><td>{{INPUT_2_USE}}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Boundaries and uncertainty</h3>
      <ul>
        <li><strong>Read-only:</strong> {{WHAT_WAS_NOT_RUN_OR_CHANGED}}</li>
        <li><strong>Counting:</strong> {{COUNTING_RULE_REPEATED}}</li>
        <li><strong>[INFERENCE]:</strong> {{INFERENCE_ITEMS}}</li>
        <li><strong>Not examined:</strong> {{OUT_OF_SCOPE}}</li>
      </ul>
    </div>
  </div>
</section>
</main>

<footer>
  <p><strong>Baseline:</strong> <code>{{BRANCH}}@{{FULL_SHA}}</code> ({{DATE}}). <strong>Changes this run:</strong> {{CHANGES_OR_NONE}}. This report summarizes evidence; it is not a delivery commitment.</p>
</footer>

</div>
</body>
</html>
```

## Anti-patterns

- **Marketing voice.** "Revolutionary", "world-class", and unearned superlatives belong in neither an audit nor a status report. State what is true and what it costs.
- **Section inflation.** A report with twenty sections nobody reads is worse than five that land. If a section does not change a decision, delete it.
- **Unverified numbers.** A percentage without a denominator, a test count without a command, or a date without a tag is noise dressed as evidence.
- **Wall of text.** Long prose paragraphs hide findings. Use a table row, a card, or a labeled callout.
- **Duplicate visuals.** The same metric as a number, a chart, and a table teaches nobody anything; pick the form that answers the reader's question.
- **Broken offline file.** A CDN font, an external image, or a `<script>` turns a durable artifact into a page that fails on a plane or in an archive.
- **Leaking secrets.** Tokens, keys, cookies, private URLs, and account identifiers never belong in an artifact that gets shared.
- **Screenshot dumping.** Unless the user asked, do not paste screenshots; cite the path or draw a diagram.

## Related skills

- `adr` — records a durable architecture or contract decision. The report may recommend one; the ADR is where the decision and its consequences live.
- `prd` — fixes product intent and scope. A roadmap or status report summarizes progress against it; it does not replace it.
- `grill-me` — use it when the report's scope or audience is still unclear and one question at a time would settle it.
