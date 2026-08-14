import { describe, expect, it } from 'vitest';

import { quoteIdentifier } from './sqlIdentifier.js';

describe('quoteIdentifier', () => {
  it('wraps a plain identifier in double quotes', () => {
    expect(quoteIdentifier('age')).toBe('"age"');
  });

  it('is byte-identical to the previous hand-written quoting for sanitized names', () => {
    // sanitizeTableName only ever emits [a-z0-9_], so routing existing table
    // names through the quoter cannot rename a table.
    for (const name of ['mydata_ab12cd34', 'table_data', 'sales_2026']) {
      expect(quoteIdentifier(name)).toBe(`"${name}"`);
    }
  });

  it('doubles an embedded double quote', () => {
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });

  it('escapes the statement-chaining payload into a single identifier', () => {
    expect(quoteIdentifier('x" TEXT); DROP TABLE users; --'))
      .toBe('"x"" TEXT); DROP TABLE users; --"');
  });

  it('leaves semicolons and parens inert inside the quotes', () => {
    expect(quoteIdentifier('a); DROP TABLE t; --')).toBe('"a); DROP TABLE t; --"');
    expect(quoteIdentifier('id; SELECT 1')).toBe('"id; SELECT 1"');
  });
});
