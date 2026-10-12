import type { Results } from '../types';

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'video'
  );
}

export function summaryFilename(results: Results, extension: string): string {
  return `video-summary-${slug(results.targetLanguage.name)}.${extension}`;
}

export function buildResultsText(results: Results): string {
  const lines: string[] = [];
  const confidence =
    typeof results.detectedLanguage.confidence === 'number'
      ? ` (confidence ${Math.round(results.detectedLanguage.confidence * 100)}%)`
      : '';

  lines.push('AI VIDEO SUMMARIZER - RESULTS');
  lines.push('='.repeat(48));
  lines.push(`Video            : ${results.video.name}`);
  lines.push(`Duration         : ${results.video.durationLabel}`);
  lines.push(`Detected language: ${results.detectedLanguage.name}${confidence}`);
  lines.push(`Target language  : ${results.targetLanguage.name}`);
  lines.push(`Generated        : ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push('SUMMARY');
  lines.push('-'.repeat(48));
  lines.push(results.summary.summary);
  lines.push('');
  lines.push('KEY POINTS');
  lines.push('-'.repeat(48));
  results.summary.keyPoints.forEach((point, index) => lines.push(`${index + 1}. ${point}`));
  lines.push('');
  lines.push(`TRANSLATED SUMMARY (${results.targetLanguage.name})`);
  lines.push('-'.repeat(48));
  lines.push(results.translation.alreadyTranslated ? `${results.translation.summary}  [already in target language]` : results.translation.summary);
  if (results.translation.keyPoints.length > 0) {
    lines.push('');
    results.translation.keyPoints.forEach((point, index) => lines.push(`${index + 1}. ${point}`));
  }
  lines.push('');
  lines.push('TRANSCRIPT');
  lines.push('-'.repeat(48));
  lines.push(results.transcript);
  if (results.notices.length > 0) {
    lines.push('');
    lines.push('NOTES');
    lines.push('-'.repeat(48));
    results.notices.forEach((n) => lines.push(`- ${n}`));
  }
  return lines.join('\n');
}

export function buildSummaryText(results: Results): string {
  const lines: string[] = [results.summary.summary, '', 'Key points:', ...results.summary.keyPoints.map((p, i) => `${i + 1}. ${p}`)];
  return lines.join('\n');
}

export function buildTranslationText(results: Results): string {
  const lines: string[] = [results.translation.summary, '', 'Key points:', ...results.translation.keyPoints.map((p, i) => `${i + 1}. ${p}`)];
  return lines.join('\n');
}

// --------------------------------------------------------------------- PDF ---

const PAGE_W = 794;
const PAGE_H = 1123;
const MARGIN = 48;
const CONTENT_H = PAGE_H - MARGIN * 2;

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Kannada', Arial, sans-serif";

function el(tag: string, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function heading(text: string): HTMLElement {
  return el(
    'div',
    {
      fontSize: '13px',
      fontWeight: '700',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#4f46e5',
      margin: '26px 0 8px 0',
    },
    text,
  );
}

function paragraph(text: string, size = 14.5): HTMLElement {
  return el('div', { fontSize: `${size}px`, lineHeight: '1.65', color: '#0f172a', margin: '0 0 8px 0', whiteSpace: 'pre-wrap' }, text);
}

function metaRow(label: string, value: string): HTMLElement {
  const row = el('div', { display: 'flex', gap: '10px', fontSize: '13.5px', lineHeight: '1.8', color: '#334155' });
  const l = el('span', { fontWeight: '600', color: '#0f172a', minWidth: '150px', flex: '0 0 auto' }, label);
  const v = el('span', {}, value);
  row.append(l, v);
  return row;
}

function numberedPoints(points: string[], color = '#0f172a'): HTMLElement {
  const wrap = el('div', { margin: '0' });
  points.forEach((point, index) => {
    const item = el('div', { display: 'flex', gap: '10px', fontSize: '14px', lineHeight: '1.6', color, margin: '0 0 6px 0' });
    item.append(el('span', { color: '#4f46e5', fontWeight: '700' }, `${index + 1}.`), el('span', {}, point));
    wrap.appendChild(item);
  });
  return wrap;
}

/** Splits long text into sentence-sized blocks so pages never overflow. */
function sentenceBlocks(text: string): HTMLElement[] {
  const sentences = text.match(/[^.!?।\n]+[.!?।]*\s*|[^.!?।]+$/g) ?? [text];
  const blocks: HTMLElement[] = [];
  let buffer = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer.length > 260) {
      blocks.push(paragraph(buffer));
      buffer = '';
    }
  }
  if (buffer) blocks.push(paragraph(buffer));
  return blocks;
}

function createPage(stage: HTMLElement): HTMLElement {
  const page = el('div', {
    width: `${PAGE_W}px`,
    minHeight: `${PAGE_H}px`,
    boxSizing: 'border-box',
    padding: `${MARGIN}px`,
    background: '#ffffff',
    fontFamily: FONT_STACK,
    color: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
  });
  stage.appendChild(page);
  return page;
}

/**
 * Renders the results onto paginated A4 canvases and saves a PDF.
 *
 * The pages are built inside a lightweight same-origin iframe that contains no
 * application CSS. html2canvas (v1) cannot parse modern color functions such as
 * `oklch()` emitted by Tailwind v4, so isolating the subtree from the app
 * stylesheet keeps the export reliable while still using real page fonts.
 */
export async function downloadResultsPdf(results: Results, filename: string): Promise<void> {
  // Lazy-load the heavy PDF/canvas libraries only when the user asks for a PDF.
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;border:0;`;
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error('iframe unavailable');

    doc.open();
    doc.write(
      '<!doctype html><html><head><meta charset="utf-8">' +
        '<style>html,body{margin:0;padding:0;background:#ffffff;}body{display:block;}</style>' +
        '</head><body></body></html>',
    );
    doc.close();

    const blocks: HTMLElement[] = [];

    const title = el('div', { fontSize: '26px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px 0' }, 'AI Video Summarizer');
    const subtitle = el('div', { fontSize: '13px', color: '#64748b', margin: '0 0 18px 0' }, `Generated ${new Date().toLocaleString()}`);
    const rule = el('div', { height: '3px', background: 'linear-gradient(90deg, #4f46e5, #7c3aed)', borderRadius: '3px', margin: '0 0 18px 0' });
    blocks.push(title, subtitle, rule);

    const confidence =
      typeof results.detectedLanguage.confidence === 'number'
        ? `${results.detectedLanguage.name} (${Math.round(results.detectedLanguage.confidence * 100)}%)`
        : results.detectedLanguage.name;

    blocks.push(
      metaRow('Video', results.video.name),
      metaRow('Duration', results.video.durationLabel),
      metaRow('Detected language', confidence),
      metaRow('Target language', results.targetLanguage.name),
      metaRow('Processing time', `${(results.processingTimeMs / 1000).toFixed(1)}s`),
    );

    blocks.push(heading('AI Summary'), ...sentenceBlocks(results.summary.summary));
    blocks.push(heading('Key Points'), numberedPoints(results.summary.keyPoints));
    blocks.push(
      heading(
        results.translation.alreadyTranslated
          ? `Translation (${results.targetLanguage.name} - already in target language)`
          : `Translated Summary (${results.targetLanguage.name})`,
      ),
      ...sentenceBlocks(results.translation.summary),
    );
    if (results.translation.keyPoints.length > 0 && !results.translation.alreadyTranslated) {
      blocks.push(numberedPoints(results.translation.keyPoints, '#334155'));
    }
    blocks.push(heading('Transcript'), ...sentenceBlocks(results.transcript));
    if (results.notices.length > 0) {
      blocks.push(heading('Notes'));
      results.notices.forEach((notice) =>
        blocks.push(el('div', { fontSize: '12.5px', color: '#64748b', margin: '0 0 6px 0' }, `- ${notice}`)),
      );
    }

    const pages: HTMLElement[] = [createPage(doc.body)];
    let current = pages[0];
    for (const block of blocks) {
      current.appendChild(block);
      const contentHeight = current.scrollHeight - MARGIN * 2;
      if (contentHeight > CONTENT_H) {
        block.remove();
        current = createPage(doc.body);
        pages.push(current);
        current.appendChild(block);
      }
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: PAGE_W,
        windowHeight: PAGE_H,
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, pageHeight);
    }

    pdf.save(filename);
  } finally {
    iframe.remove();
  }
}
