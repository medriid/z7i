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
      output: 'html'
    });
  } catch {
    if (!fallbackDelimiters) return latex;
    return `${fallbackDelimiters[0]}${latex}${fallbackDelimiters[1]}`;
  }
}

function normalizeMathOperator(value: string): string {
  switch (value) {
    case '×':
      return '\\times';
    case '÷':
      return '\\div';
    case '·':
      return '\\cdot';
    case '±':
      return '\\pm';
    case '∓':
      return '\\mp';
    case '≤':
      return '\\leq';
    case '≥':
      return '\\geq';
    case '≠':
      return '\\neq';
    case '∑':
      return '\\sum';
    case '∫':
      return '\\int';
    default:
      return value;
  }
}

function mathMlChildren(node: Element): Element[] {
  return Array.from(node.children);
}

function mathMlText(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function convertMathMlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').trim();
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  switch (tag) {
    case 'math':
    case 'mrow':
      return mathMlChildren(element).map(convertMathMlNode).join('');
    case 'mi':
    case 'mn':
    case 'mtext':
      return mathMlText(element);
    case 'mo': {
      const value = mathMlText(element);
      return normalizeMathOperator(value || '');
    }
    case 'msup': {
      const [base, sup] = mathMlChildren(element);
      if (!base || !sup) return '';
      return `{${convertMathMlNode(base)}}^{${convertMathMlNode(sup)}}`;
    }
    case 'msub': {
      const [base, sub] = mathMlChildren(element);
      if (!base || !sub) return '';
      return `{${convertMathMlNode(base)}}_{${convertMathMlNode(sub)}}`;
    }
    case 'msubsup': {
      const [base, sub, sup] = mathMlChildren(element);
      if (!base || !sub || !sup) return '';
      return `{${convertMathMlNode(base)}}_{${convertMathMlNode(sub)}}^{${convertMathMlNode(sup)}}`;
    }
    case 'mfrac': {
      const [num, den] = mathMlChildren(element);
      if (!num || !den) return '';
      return `\\frac{${convertMathMlNode(num)}}{${convertMathMlNode(den)}}`;
    }
    case 'msqrt': {
      const body = mathMlChildren(element).map(convertMathMlNode).join('');
      return `\\sqrt{${body}}`;
    }
    case 'mroot': {
      const [base, degree] = mathMlChildren(element);
      if (!base || !degree) return '';
      return `\\sqrt[${convertMathMlNode(degree)}]{${convertMathMlNode(base)}}`;
    }
    case 'mfenced': {
      const open = element.getAttribute('open') ?? '(';
      const close = element.getAttribute('close') ?? ')';
      const body = mathMlChildren(element).map(convertMathMlNode).join('');
      return `${open}${body}${close}`;
    }
    case 'mover': {
      const [base, accent] = mathMlChildren(element);
      if (!base || !accent) return '';
      const accentText = mathMlText(accent);
      const content = convertMathMlNode(base);
      if (accentText.includes('→')) return `\\vec{${content}}`;
      if (accentText.includes('^')) return `\\hat{${content}}`;
      if (accentText.includes('¯')) return `\\bar{${content}}`;
      return `${content}`;
    }
    case 'mtable': {
      const rows = mathMlChildren(element)
        .filter((child) => child.tagName.toLowerCase() === 'mtr')
        .map((row) => {
          const cells = mathMlChildren(row)
            .filter((cell) => cell.tagName.toLowerCase() === 'mtd')
            .map((cell) => convertMathMlNode(cell));
          return cells.join(' & ');
        });
      if (rows.length === 0) return '';
      return `\\begin{matrix}${rows.join(' \\ ')}\\end{matrix}`;
    }
    case 'mtr':
    case 'mtd':
      return mathMlChildren(element).map(convertMathMlNode).join('');
    case 'mspace':
      return '';
    default:
      return mathMlChildren(element).map(convertMathMlNode).join('');
  }
}

function renderMathMlInHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  if (!/<math[\s>]/i.test(html)) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const mathNodes = Array.from(doc.querySelectorAll('math'));

  mathNodes.forEach((mathNode) => {
    const latex = convertMathMlNode(mathNode);
    if (!latex.trim()) return;
    const display = mathNode.getAttribute('display');
    const displayMode = display === 'block' || display === 'true';
    const rendered = renderKatex(latex, displayMode);
    const wrapper = doc.createElement('span');
    wrapper.innerHTML = rendered;
    mathNode.replaceWith(...Array.from(wrapper.childNodes));
  });

  return doc.body.innerHTML;
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

function normalizeLatexEntities(html: string): string {
  return html
    .replace(/\\\$/g, '$')
    .replace(/&dollar;|&#36;/g, '$')
    .replace(/&bsol;|&#92;/g, '\\')
    .replace(/&sol;|&#47;/g, '/');
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
  const normalized = normalizeLatexEntities(html);
  const withMathMl = renderMathMlInHtml(normalized);

  return withMathMl
    .split(/(<[^>]+>)/g)
    .map((segment) => renderMathSegment(segment))
    .join('');
}
