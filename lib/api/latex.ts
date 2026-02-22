import katex from 'katex';
import { marked } from 'marked';

const DISPLAY_PATTERNS: Array<{ regex: RegExp; delimiters: [string, string] }> = [
  { regex: /\$\$([\s\S]*?)\$\$/g, delimiters: ['$$', '$$'] },
  { regex: /\\\[([\s\S]*?)\\\]/g, delimiters: ['\\[', '\\]'] },
];

const INLINE_PATTERNS: Array<{ regex: RegExp; delimiters: [string, string] }> = [
  { regex: /\\\(([\s\S]*?)\\\)/g, delimiters: ['\\(', '\\)'] },
  { regex: /\$(?!\$)((?:[^$\\]|\\.)+?)\$/g, delimiters: ['$', '$'] },
];

const MARKDOWN_HINT_REGEX = /^[\s>#*\-|\d.`~\[]/m;

marked.setOptions({ gfm: true, breaks: true });

function renderKatex(latex: string, displayMode: boolean, fallbackDelimiters?: [string, string]): string {
  const value = String(latex || '').trim();
  if (!value) return '';
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    if (!fallbackDelimiters) return latex;
    return `${fallbackDelimiters[0]}${latex}${fallbackDelimiters[1]}`;
  }
}

function renderProtectedMath(content: string): { text: string; tokens: Map<string, string> } {
  let protectedText = content;
  const tokens = new Map<string, string>();
  let tokenIndex = 0;

  const replacePattern = (regex: RegExp, displayMode: boolean, delimiters: [string, string]) => {
    protectedText = protectedText.replace(regex, (_match, latex) => {
      const rendered = renderKatex(String(latex || ''), displayMode, delimiters);
      const token = `@@MATH_TOKEN_${tokenIndex++}@@`;
      tokens.set(token, rendered);
      return token;
    });
  };

  for (const { regex, delimiters } of DISPLAY_PATTERNS) {
    replacePattern(regex, true, delimiters);
  }

  for (const { regex, delimiters } of INLINE_PATTERNS) {
    replacePattern(regex, false, delimiters);
  }

  return { text: protectedText, tokens };
}

function restoreProtectedMath(content: string, tokens: Map<string, string>): string {
  let restored = content;
  for (const [token, value] of tokens.entries()) {
    restored = restored.replaceAll(token, value);
  }
  return restored;
}

function renderMathSegment(segment: string): string {
  if (!segment || segment.startsWith('<')) return segment;

  let rendered = segment;

  for (const { regex, delimiters } of DISPLAY_PATTERNS) {
    rendered = rendered.replace(regex, (_match, latex) => {
      return renderKatex(String(latex || ''), true, delimiters);
    });
  }

  for (const { regex, delimiters } of INLINE_PATTERNS) {
    rendered = rendered.replace(regex, (_match, latex) => {
      return renderKatex(String(latex || ''), false, delimiters);
    });
  }

  return rendered;
}

function looksLikeHtml(input: string): boolean {
  return /<[a-z][\s\S]*>/i.test(input);
}

function looksLikeMarkdown(input: string): boolean {
  return MARKDOWN_HINT_REGEX.test(input) || /\|.+\|/.test(input) || /```/.test(input);
}

export function renderRichTextWithLatex(content: string): string {
  if (!content) return content;

  const normalized = content.trim();
  if (!normalized) return normalized;

  if (looksLikeHtml(normalized)) {
    return renderLatexInHtml(normalized);
  }

  const { text, tokens } = renderProtectedMath(normalized);
  const html = looksLikeMarkdown(text)
    ? marked.parse(text, { async: false })
    : text.replace(/\n/g, '<br />');

  const htmlString = typeof html === 'string' ? html : String(html);
  const withRestoredMath = restoreProtectedMath(htmlString, tokens);
  return renderLatexInHtml(withRestoredMath);
}

export function renderLatexInHtml(html: string): string {
  if (!html) return html;

  return html
    .split(/(<[^>]+>)/g)
    .map((segment) => renderMathSegment(segment))
    .join('');
}
