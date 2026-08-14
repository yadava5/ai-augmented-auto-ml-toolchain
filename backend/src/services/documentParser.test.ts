import { describe, it, expect, vi, beforeEach } from 'vitest';

import { parseDocument, stripMarkup } from './documentParser.js';

const { extractRawTextMock } = vi.hoisted(() => ({
  extractRawTextMock: vi.fn()
}));

vi.mock('mammoth', () => ({
  extractRawText: extractRawTextMock
}));

describe('documentParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractRawTextMock.mockReset();
  });

  describe('parseDocument', () => {
    describe('docx files', () => {
      it('parses DOCX by mime type', async () => {
        extractRawTextMock.mockResolvedValue({
          value: 'Docx extracted text',
          messages: []
        });

        const buffer = Buffer.from('fake-docx');
        const result = await parseDocument(
          buffer,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );

        expect(result.text).toBe('Docx extracted text');
        expect(result.type).toBe('docx');
        expect(result.parseError).toBeUndefined();
      });

      it('parses DOCX by filename fallback when mime is generic', async () => {
        extractRawTextMock.mockResolvedValue({
          value: 'Filename-based docx parse',
          messages: []
        });

        const buffer = Buffer.from('fake-docx');
        const result = await parseDocument(buffer, 'application/octet-stream', 'report.docx');

        expect(result.text).toBe('Filename-based docx parse');
        expect(result.type).toBe('docx');
      });

      it('returns parseError when DOCX extraction fails', async () => {
        extractRawTextMock.mockRejectedValue(new Error('mammoth failed'));

        const buffer = Buffer.from('fake-docx');
        const result = await parseDocument(
          buffer,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );

        expect(result.text).toBe('');
        expect(result.type).toBe('docx');
        expect(result.parseError).toContain('mammoth failed');
      });
    });

    describe('text files', () => {
      it('parses plain text', async () => {
        const buffer = Buffer.from('Hello, world!');
        const result = await parseDocument(buffer, 'text/plain');

        expect(result.text).toBe('Hello, world!');
        expect(result.mimeType).toBe('text/plain');
        expect(result.type).toBe('text');
      });

      it('parses markdown as markdown type', async () => {
        const buffer = Buffer.from('# Heading\n\nSome text');
        const result = await parseDocument(buffer, 'text/markdown');

        expect(result.text).toBe('# Heading\n\nSome text');
        expect(result.type).toBe('markdown');
      });

      it('parses text/md as text type (does not contain "markdown")', async () => {
        // Note: text/md doesn't include 'markdown' in the string,
        // so it returns 'text' type per current implementation
        const buffer = Buffer.from('# Title');
        const result = await parseDocument(buffer, 'text/md');

        expect(result.type).toBe('text');
      });

      it('parses text/x-markdown as markdown type', async () => {
        const buffer = Buffer.from('## Subtitle');
        const result = await parseDocument(buffer, 'text/x-markdown');

        expect(result.type).toBe('markdown');
      });

      it('parses HTML with tags stripped', async () => {
        const buffer = Buffer.from('<html><body><h1>Title</h1><p>Content</p></body></html>');
        const result = await parseDocument(buffer, 'text/html');

        expect(result.text).toContain('Title');
        expect(result.text).toContain('Content');
        expect(result.text).not.toContain('<h1>');
        expect(result.text).not.toContain('<p>');
        expect(result.type).toBe('text');
      });

      it('strips script and style tags from HTML', async () => {
        const buffer = Buffer.from('<html><head><style>body{color:red}</style></head><body><script>alert(1)</script>Hello</body></html>');
        const result = await parseDocument(buffer, 'text/html');

        expect(result.text).toContain('Hello');
        expect(result.text).not.toContain('alert');
        expect(result.text).not.toContain('color:red');
      });

      it('strips XML tags from XML documents', async () => {
        const buffer = Buffer.from('<root><item attr="val">Data</item></root>');
        const result = await parseDocument(buffer, 'text/xml');

        expect(result.text).toContain('Data');
        expect(result.text).not.toContain('<root>');
        expect(result.text).not.toContain('<item');
      });

      it('parses JSON as text', async () => {
        const buffer = Buffer.from('{"key": "value"}');
        const result = await parseDocument(buffer, 'application/json');

        expect(result.text).toBe('{"key": "value"}');
        expect(result.type).toBe('text');
      });
    });

    describe('UTF-8 handling', () => {
      it('handles UTF-8 encoded text', async () => {
        const buffer = Buffer.from('Hello UTF-8!', 'utf8');
        const result = await parseDocument(buffer, 'text/plain');

        expect(result.text).toBe('Hello UTF-8!');
      });

      it('handles empty buffer', async () => {
        const buffer = Buffer.from('');
        const result = await parseDocument(buffer, 'text/plain');

        expect(result.text).toBe('');
      });

      it('handles buffer with newlines', async () => {
        const buffer = Buffer.from('Line 1\nLine 2\nLine 3');
        const result = await parseDocument(buffer, 'text/plain');

        expect(result.text).toContain('Line 1');
        expect(result.text).toContain('Line 2');
      });
    });

    describe('fallback behavior', () => {
      it('falls back to text for unknown mime type', async () => {
        const buffer = Buffer.from('Some content');
        const result = await parseDocument(buffer, 'application/unknown');

        expect(result.text).toBe('Some content');
        expect(result.type).toBe('text');
      });

      it('falls back to text when no mime type provided', async () => {
        const buffer = Buffer.from('Default content');
        const result = await parseDocument(buffer);

        expect(result.text).toBe('Default content');
        expect(result.mimeType).toBe('text/plain');
      });

      it('returns unknown type for empty content without mime', async () => {
        const buffer = Buffer.from('');
        const result = await parseDocument(buffer);

        expect(result.type).toBe('unknown');
      });
    });

    describe('special characters', () => {
      it('preserves special characters', async () => {
        const text = 'Special: @#$%^&*()';
        const buffer = Buffer.from(text);
        const result = await parseDocument(buffer, 'text/plain');

        expect(result.text).toBe(text);
      });

      it('preserves tabs and spaces', async () => {
        const text = 'Tab:\tSpace:   End';
        const buffer = Buffer.from(text);
        const result = await parseDocument(buffer, 'text/plain');

        expect(result.text).toBe(text);
      });
    });
  });

  describe('stripMarkup', () => {
    it('still strips script, style and ordinary tags and decodes entities', () => {
      const html = '<html><head><style type="text/css">.a{color:red}</style>'
        + '<script src="x.js" defer async>var a = 1 < 2;</script></head>'
        + '<body><p class="x">Hello &amp; &lt;world&gt;</p><!-- note --></body></html>';

      expect(stripMarkup(html)).toBe('Hello & <world>');
    });

    it('still strips tags with long-but-realistic attribute lists', () => {
      const attrs = Array.from({ length: 12 }, (_, i) => `data-attr-${i}="value-${i}"`).join(' ');

      expect(stripMarkup(`<div ${attrs}>Body</div>`)).toBe('Body');
    });

    // `[^>]` matches `<`, so every `<` in a run of unclosed tags is a match start
    // whose scan runs to end of input - quadratic in the input length. Unfixed,
    // these shapes measured 83s-308s at only 448KB, so 4MB is hours of blocked
    // event loop. Bounded quantifiers plus MAX_MARKUP_LENGTH hold this to tens of
    // milliseconds; past the cap, cost stops growing with input size at all.
    //
    // The gate sits ~1000x away from the defect in both directions, so the bound
    // is deliberately loose rather than pinned to the measured value - a tighter
    // one would buy no detection power and would flake on loaded CI.
    it.each([
      ['unclosed script tags', '<script'],
      ['bare open angles', '<'],
      ['unclosed style tags', '<style'],
      ['two-char open tags', '<a'],
    ])('completes quickly on 4MB of %s', (_label, unit) => {
      const input = unit.repeat(Math.floor((4 * 1024 * 1024) / unit.length));

      const started = Date.now();
      stripMarkup(input);
      const elapsed = Date.now() - started;

      expect(elapsed).toBeLessThan(3000);
    });
  });

  // The ReDoS bound truncates, and truncation is invisible by construction:
  // ingestDocument chunks and embeds whatever text it is handed and caps
  // nothing itself, so a dropped tail surfaces only as a smaller chunkCount.
  // parseError is the field the upload route already returns to the client as
  // parseWarning, so these assert the loss is *reported*, not just bounded.
  describe('oversized markup reports the truncation', () => {
    const MAX_MARKUP_LENGTH = 262_144;

    it('sets parseError naming the number of characters dropped', async () => {
      const overBy = 5_000;
      const filler = 'a'.repeat(MAX_MARKUP_LENGTH + overBy - '<p></p>'.length);
      const buffer = Buffer.from(`<p>${filler}</p>`, 'utf8');

      const result = await parseDocument(buffer, 'text/html');

      expect(result.parseError).toBeDefined();
      expect(result.parseError).toContain(String(overBy));
      expect(result.parseError).toContain('not searchable');
    });

    it('leaves parseError undefined for markup under the limit', async () => {
      const buffer = Buffer.from('<p>Short enough to survive whole.</p>', 'utf8');

      const result = await parseDocument(buffer, 'text/html');

      expect(result.parseError).toBeUndefined();
      expect(result.text).toBe('Short enough to survive whole.');
    });

    // Plain text and markdown never reach stripMarkup, so a large upload of
    // either must keep every character and report nothing.
    it('does not truncate or warn on non-markup text of the same size', async () => {
      const body = 'b'.repeat(MAX_MARKUP_LENGTH + 5_000);

      const result = await parseDocument(Buffer.from(body, 'utf8'), 'text/plain');

      expect(result.parseError).toBeUndefined();
      expect(result.text).toHaveLength(body.length);
    });
  });
});
