import MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import katex from 'katex';

function isEscaped(src: string, pos: number): boolean {
  let backslashes = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5c; i--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function renderMath(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: 'warn',
      trust: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<span class="math-error">${MarkdownIt().utils.escapeHtml(message)}</span>`;
  }
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const start = state.pos;

  if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) === 0x24) {
    return false;
  }

  if (isEscaped(state.src, start)) {
    return false;
  }

  let end = start + 1;
  while ((end = state.src.indexOf('$', end)) !== -1) {
    if (!isEscaped(state.src, end)) {
      break;
    }
    end += 1;
  }

  if (end === -1) {
    return false;
  }

  const content = state.src.slice(start + 1, end);
  if (!content.trim()) {
    return false;
  }

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
  }

  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const firstLine = state.src.slice(start, max);

  if (!firstLine.startsWith('$$')) {
    return false;
  }

  if (silent) {
    return true;
  }

  const firstContent = firstLine.slice(2);
  const sameLineEnd = firstContent.indexOf('$$');

  if (sameLineEnd !== -1) {
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = firstContent.slice(0, sameLineEnd).trim();
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  const lines: string[] = [];
  if (firstContent.trim()) {
    lines.push(firstContent);
  }

  let nextLine = startLine + 1;
  for (; nextLine < endLine; nextLine += 1) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    const line = state.src.slice(lineStart, lineEnd);
    const closing = line.indexOf('$$');

    if (closing !== -1) {
      const beforeClosing = line.slice(0, closing);
      if (beforeClosing.trim()) {
        lines.push(beforeClosing);
      }
      break;
    }

    lines.push(line);
  }

  if (nextLine >= endLine) {
    return false;
  }

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = lines.join('\n').trim();
  token.map = [startLine, nextLine + 1];
  state.line = nextLine + 1;
  return true;
}

export function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false
  });

  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list']
  });

  md.renderer.rules.math_inline = (tokens, idx): string => {
    return renderMath(tokens[idx].content, false);
  };

  md.renderer.rules.math_block = (tokens, idx): string => {
    return `<div class="math-display">${renderMath(tokens[idx].content, true)}</div>`;
  };

  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self: Renderer): string => {
    const token = tokens[idx];
    const href = token.attrGet('href');
    if (href && /^(https?:|mailto:)/i.test(href)) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen ? defaultLinkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };

  return md;
}
