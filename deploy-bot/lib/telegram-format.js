// LAMP AI — turns the model's Markdown into safe Telegram HTML and splits long texts.
// Telegram refuses messages over 4096 characters and broken Markdown: both caused "erreur technique".

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toTelegramHtml(md) {
  let s = esc(String(md || ''));
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');                    // titles → bold
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');                   // **bold**
  s = s.replace(/__([^_\n]+?)__/g, '<b>$1</b>');
  s = s.replace(/(^|[\s(«])\*([^*\n]+?)\*(?=[\s).,;:!?»]|$)/g, '$1<i>$2</i>');   // *italic*
  s = s.replace(/(^|[\s(«])_([^_\n]+?)_(?=[\s).,;:!?»]|$)/g, '$1<i>$2</i>');     // _italic_
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  s = s.replace(/^&gt;\s?/gm, '▎ ');                                   // > quote
  s = s.replace(/^\s*[-*]\s+/gm, '• ');                               // bullets
  return s;
}

/** Plain text version (fallback when Telegram still rejects the HTML). */
export function toPlain(md) {
  return String(md || '').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '▎ ');
}

/** Splits on paragraph / line / sentence boundaries, each chunk ≤ max characters. */
export function splitMessage(text, max = 3800) {
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut < max * 0.3) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Text for the voice note: no Arabic script (the voice can't read it), no Markdown, ~900 chars. */
export function toSpeech(md, max = 900) {
  let s = String(md || '')
    .replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g, ' ')
    .replace(/\*\*|__|[*_`#>▎•]/g, '')
    .replace(/\((?:\d{1,3}:\d{1,3}|[^)]*n°\s*\d+[^)]*)\)/g, '')     // references are for reading, not hearing
    .replace(/«\s*»/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    s = end > max * 0.5 ? cut.slice(0, end + 1) : cut + '…';
  }
  return s;
}
