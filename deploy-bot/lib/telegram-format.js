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
// Spoken version of an answer. Arabic text is NEVER given to the voice engine: a speech model
// does not read sacred text faithfully (it can change or invent verses). The voice says instead
// that the Arabic is in the written message.
const ARABIC_NOTE = {
  fr: ' — citation en arabe : voir le message écrit.\n',
  wo: ' — mbind mi ci araab : mu ngi ci bataaxal bi.\n',
  en: ' — Arabic quotation: see the written message.\n',
};
const RECITED_NOTE = {
  fr: " — citation en arabe : écoute l'audio suivant.\n",
  wo: ' — mbind mi ci araab : dégglul kàddu gi ci topp.\n',
  en: ' — Arabic quotation: listen to the next audio.\n',
};
const MORE_NOTE = { fr: ' La suite est dans le message écrit.', wo: ' Li ci des, mu ngi ci bataaxal bi.', en: ' The rest is in the written message.' };
export function toSpeech(md, lang = 'fr', recited = false, max = 2500) {
  const note = (recited ? RECITED_NOTE : ARABIC_NOTE)[lang] || (recited ? RECITED_NOTE : ARABIC_NOTE).fr;
  const AR = '؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿';
  const pbuh = { fr: 'paix et salut sur lui', wo: 'sallalaahu alayhi wa sallam', en: 'peace be upon him' }[lang] || 'paix et salut sur lui';
  let s = String(md || '')
    .replace(/\(?\s*ﷺ\s*\)?/g, ` (${pbuh}) `)
    .replace(new RegExp(`\\s*:?\\s*[«"]?\\s*[${AR}](?:[${AR}\\s/|]|[A-Za-z](?=[${AR}]))*\\s*[»"]?`, 'g'), (run) =>
      (run.replace(new RegExp(`[^${AR}]`, 'g'), '').length > 12 ? note : ' '))
    .replace(/[’‘ʼ`]/g, "'").replace(/[“”]/g, '"')       // the voice stumbles on typographic apostrophes (L’exemple → « L… »)
    .replace(/\bn°\s*/gi, { fr: 'numéro ', wo: 'numéro ', en: 'number ' }[lang] || 'numéro ')
    .replace(/\*\*|__|[*_`#>▎•]/g, '')
    .replace(/\((?:\d{1,3}:\d{1,3}|[^)]*n°\s*\d+[^)]*)\)/g, '')     // references are for reading, not hearing
    .replace(/\([^)]*(?:distique|b[ëe]yit|verset|sourate|\d+\s*:\s*\d+)[^)]*\)/gi, '')
    .replace(/\s—\s*(?=\n|$)/g, '')
    .replace(/(\([^)]*\)\s*){2,}/g, (m) => m.match(/\([^)]*\)/)[0] + ' ')
    .replace(/«\s*»|\(\s*\)/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    s = (end > max * 0.5 ? cut.slice(0, end + 1) : cut) + (MORE_NOTE[lang] || MORE_NOTE.fr);
  }
  return s;
}
