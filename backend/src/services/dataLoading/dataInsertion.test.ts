import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import type { DatasetProfileColumn } from '../../types/dataset.js';

import { insertRows } from './dataInsertion.js';

function column(name: string, dtype: DatasetProfileColumn['dtype'] = 'string'): DatasetProfileColumn {
  return { name, dtype, nullCount: 0 };
}

function outsideQuotedIdentifiers(sql: string): string {
  return sql.replace(/"(?:[^"]|"")*"/g, '');
}

/** Captures the SQL insertRows generates without touching a database. */
function createRecordingClient(): { client: PoolClient; statements: string[] } {
  const statements: string[] = [];
  const client = {
    query: (sql: string) => {
      statements.push(sql);
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  } as unknown as PoolClient;

  return { client, statements };
}

describe('insertRows SQL generation', () => {
  it('quotes ordinary column names in the INSERT column list', async () => {
    const { client, statements } = createRecordingClient();

    await insertRows(client, 'mydata', [column('age', 'integer'), column('name')], [{ age: 1, name: 'a' }], false);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('INSERT INTO "mydata" ("age", "name")');
  });

  // Same tainted header as the CREATE TABLE path. The INSERT is issued with a
  // values array so it uses the extended protocol and cannot chain statements,
  // but the identifier is still built by string interpolation and is the same
  // defect.
  it('escapes a header that closes the column list and chains a statement', async () => {
    const { client, statements } = createRecordingClient();
    const header = 'x" TEXT); DROP TABLE users; --';

    await insertRows(client, 'mydata', [column(header)], [{ [header]: 'v' }], false);

    expect(statements[0]).toContain('INSERT INTO "mydata" ("x"" TEXT); DROP TABLE users; --")');
    expect(outsideQuotedIdentifiers(statements[0])).not.toContain(';');
  });

  it('escapes headers containing a double quote, ); and a semicolon', async () => {
    for (const [header, expected] of [
      ['we"ird', '("we""ird")'],
      ['a); DROP TABLE t; --', '("a); DROP TABLE t; --")'],
      ['id; SELECT 1', '("id; SELECT 1")'],
    ] as const) {
      const { client, statements } = createRecordingClient();

      await insertRows(client, 'mydata', [column(header)], [{ [header]: 'v' }], false);

      expect(statements[0]).toContain(`INSERT INTO "mydata" ${expected}`);
      expect(outsideQuotedIdentifiers(statements[0])).not.toContain(';');
    }
  });

  it('escapes a table name carrying a quote', async () => {
    const { client, statements } = createRecordingClient();

    await insertRows(client, 'a"b', [column('c')], [{ c: 'v' }], false);

    expect(statements[0]).toContain('INSERT INTO "a""b" ("c")');
    expect(outsideQuotedIdentifiers(statements[0])).not.toContain(';');
  });
});
