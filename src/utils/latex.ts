import katex from 'katex';

export function renderLatexInHtml(html: string): string {
  if (!html) return html;

  let result = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        displayMode: true,
        throwOnError: false,
        output: 'html'
      });
    } catch {
      return `$$${latex}$$`;
    }
  });

  result = result.replace(/\\\[((?:[\s\S]*?))\\\]/g, (_, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        displayMode: true,
        throwOnError: false,
        output: 'html'
      });
    } catch {
      return `\\[${latex}\\]`;
    }
  });

  result = result.replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        displayMode: false,
        throwOnError: false,
        output: 'html'
      });
    } catch {
      return `\\(${latex}\\)`;
    }
  });

  result = result.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g, (_, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        displayMode: false,
        throwOnError: false,
        output: 'html'
      });
    } catch {
      return `$${latex}$`;
    }
  });

  result = result.replace(/\\boxed\{([^}]+)\}/g, (_, content) => {
    try {
      return katex.renderToString(`\\boxed{${content}}`, {
        displayMode: false,
        throwOnError: false,
        output: 'html'
      });
    } catch {
      return `\\boxed{${content}}`;
    }
  });

  return result;
}
