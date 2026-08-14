import { describe, expect, it } from 'vitest';

import type { DatasetProfileColumn } from '../../types/dataset.js';

import { generateCreateTableSql } from './schemaInference.js';

function column(name: string, dtype: DatasetProfileColumn['dtype'] = 'string'): DatasetProfileColumn {
  return { name, dtype, nullCount: 0 };
}

/**
 * Remove every double-quoted identifier, then report what is left. A correctly
 * quoted statement leaves no `;` behind, because everything the uploader
 * controls is inside an identifier. Asserting this rather than "does not
 * contain DROP" is what makes the test detect chaining generally.
 */
function outsideQuotedIdentifiers(sql: string): string {
  return sql.replace(/"(?:[^"]|"")*"/g, '');
}

describe('generateCreateTableSql', () => {
  it('quotes ordinary column names and infers types', () => {
    const sql = generateCreateTableSql('mydata', [column('age', 'integer'), column('name')]);

    expect(sql).toBe('CREATE TABLE "mydata" ("age" BIGINT, "name" TEXT)');
  });

  // A CSV/XLSX header row reaches this function verbatim - csv-parse with
  // columns:true uses the header text as the key, and sanitizeDatasetRows only
  // strips NUL bytes and repairs surrogates. datasetLoader runs the result
  // through client.query() with no values array, i.e. the simple query
  // protocol, which executes semicolon-separated statements as a batch.
  it('escapes a header that closes the column list and chains a statement', () => {
    const sql = generateCreateTableSql('mydata', [column('x" TEXT); DROP TABLE users; --')]);

    expect(sql).toBe('CREATE TABLE "mydata" ("x"" TEXT); DROP TABLE users; --" TEXT)');
    expect(outsideQuotedIdentifiers(sql)).not.toContain(';');
  });

  it('escapes a header containing a double quote', () => {
    const sql = generateCreateTableSql('mydata', [column('we"ird')]);

    expect(sql).toBe('CREATE TABLE "mydata" ("we""ird" TEXT)');
    expect(outsideQuotedIdentifiers(sql)).not.toContain(';');
  });

  it('escapes a header containing );', () => {
    const sql = generateCreateTableSql('mydata', [column('a); DROP TABLE t; --')]);

    expect(sql).toBe('CREATE TABLE "mydata" ("a); DROP TABLE t; --" TEXT)');
    expect(outsideQuotedIdentifiers(sql)).not.toContain(';');
  });

  it('escapes a header containing a semicolon', () => {
    const sql = generateCreateTableSql('mydata', [column('id; SELECT 1')]);

    expect(sql).toBe('CREATE TABLE "mydata" ("id; SELECT 1" TEXT)');
    expect(outsideQuotedIdentifiers(sql)).not.toContain(';');
  });

  it('escapes a table name carrying a quote without renaming sanitized ones', () => {
    expect(generateCreateTableSql('a"b', [column('c')]))
      .toBe('CREATE TABLE "a""b" ("c" TEXT)');
    expect(generateCreateTableSql('mydata_ab12cd34', [column('c')]))
      .toBe('CREATE TABLE "mydata_ab12cd34" ("c" TEXT)');
  });
});
