// @vitest-environment jsdom
//
// The post body is attacker-controlled calldata (anyone can publish()), so
// renderMarkdown is the boundary between "bytes a stranger put on chain" and
// HTML injected with dangerouslySetInnerHTML. These tests hold that boundary:
// no stranger's body may become a script, an event handler, or a dangerous URL,
// while the legitimate Markdown subset (spec §8) still renders.
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/lib/renderMarkdown';

/** Parse rendered HTML and report any executable/dangerous sink it contains. */
function sinks(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const found = [];
  if (root.querySelector('script')) found.push('script');
  if (root.querySelector('iframe, object, embed, form')) found.push('embedder');
  for (const el of root.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if (/^on/i.test(attr.name)) found.push(`${el.tagName.toLowerCase()}[${attr.name}]`);
    }
  }
  for (const el of root.querySelectorAll('[href], [src]')) {
    for (const name of ['href', 'src']) {
      const v = el.getAttribute(name);
      if (v && /^\s*(javascript:|vbscript:|data:text\/html|data:image\/svg)/i.test(v)) {
        found.push(`${name}=${v.slice(0, 24)}`);
      }
    }
  }
  return found;
}

describe('renderMarkdown — XSS boundary', () => {
  // The exact proof-of-concept from the security report: marked does not escape
  // the `"` in image alt text, so `alt` breaks out into a live onerror handler.
  // DOMPurify must strip it.
  it('neutralizes the image-alt attribute breakout', () => {
    const html = renderMarkdown('![x" onerror="alert(1)](https://x)');
    expect(html).not.toMatch(/onerror/i);
    expect(sinks(html)).toEqual([]);
    // The image itself may survive; the injected handler must not.
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('img')?.hasAttribute('onerror')).toBeFalsy();
  });

  it.each([
    ['script block', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['img onerror inline', 'hello <img src=x onerror=alert(1)> world'],
    ['svg onload', '<svg onload=alert(1)></svg>'],
    ['svg>script', '<svg><script>alert(1)</script></svg>'],
    ['iframe js', '<iframe src="javascript:alert(1)"></iframe>'],
    ['raw anchor js', '<a href="javascript:alert(1)">x</a>'],
    ['details ontoggle', '<details open ontoggle=alert(1)>x</details>'],
    ['math script', '<math><mtext><script>alert(1)</script></mtext></math>'],
    ['mixed case img', '<ImG sRc=x OnErRoR=alert(1)>'],
    ['newline attrs', '<img\nsrc=x\nonerror=alert(1)>'],
    ['plaintext', '<plaintext><img src=x onerror=alert(1)>'],
    ['form action js', '<form action=javascript:alert(1)><input></form>'],
    ['md link js', '[x](javascript:alert(1))'],
    ['md link js upper', '[x](JAVASCRIPT:alert(1))'],
    ['md link js leading tab', '[x](\tjavascript:alert(1))'],
    ['md link js entity', '[x](&#106;avascript:alert(1))'],
    ['md link vbscript', '[x](vbscript:alert(1))'],
    ['md link data html', '[x](data:text/html,<script>alert(1)</script>)'],
    ['md img js', '![x](javascript:alert(1))'],
    ['md img data html', '![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
    ['md img data svg', '![x](data:image/svg+xml,<svg onload=alert(1)></svg>)'],
    ['img src quote breakout', '![a](https://x/"onerror="alert(1))'],
    ['link href quote breakout', '[a](https://x/"onmouseover="alert(1))'],
    ['img title breakout', '![a](https://x "onerror=alert(1)")'],
    ['img alt onload', '![x" onload="alert(1)](https://x/i.png)'],
    ['link text raw html', '[<img src=x onerror=alert(1)>](https://x)'],
  ])('produces no sink for: %s', (_name, payload) => {
    expect(sinks(renderMarkdown(payload))).toEqual([]);
  });
});

describe('renderMarkdown — the legitimate subset still renders', () => {
  const parse = (md) => {
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(md);
    return root;
  };

  it('keeps a normal https image', () => {
    expect(parse('![a photo](https://example.com/p.png)').querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/p.png',
    );
  });

  it('keeps a blob: image (an on-chain image the reader resolved)', () => {
    expect(parse('![](blob:https://app/abc)').querySelector('img')?.getAttribute('src')).toBe('blob:https://app/abc');
  });

  it('keeps a data:image/ placeholder', () => {
    const src = parse("![](data:image/svg+xml,%3Csvg%3E%3C/svg%3E)").querySelector('img')?.getAttribute('src');
    expect(src).toMatch(/^data:image\/svg\+xml/);
  });

  it('drops an unresolved eth: image source but keeps its alt (matches the post page)', () => {
    const img = parse('![a photograph](eth:0xabc)').querySelector('img');
    expect(img?.getAttribute('src') ?? '').toBe('');
    expect(img?.getAttribute('alt')).toBe('a photograph');
  });

  it('keeps in-app and web links', () => {
    expect(parse('[in app](/taiko/tx/0xabc/0)').querySelector('a')?.getAttribute('href')).toBe('/taiko/tx/0xabc/0');
    expect(parse('[web](https://example.com)').querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('keeps headings, emphasis, tables, code, blockquotes and lists', () => {
    const root = parse(
      '# Title\n\nsome **bold** and *italic*\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n```\ncode\n```\n\n> quote\n\n- item',
    );
    expect(root.querySelector('h1')?.textContent).toBe('Title');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
    expect(root.querySelector('em')?.textContent).toBe('italic');
    expect(root.querySelector('table')).toBeTruthy();
    expect(root.querySelectorAll('td').length).toBe(2);
    expect(root.querySelector('pre code')?.textContent).toContain('code');
    expect(root.querySelector('blockquote')).toBeTruthy();
    expect(root.querySelector('li')?.textContent).toBe('item');
  });
});
