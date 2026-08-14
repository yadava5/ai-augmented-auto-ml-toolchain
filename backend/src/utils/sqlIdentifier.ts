/**
 * SQL identifier quoting - the single place identifiers are made safe for
 * interpolation into generated SQL.
 *
 * Postgres escapes a double quote inside a double-quoted identifier by
 * doubling it, so `x" TEXT); DROP TABLE users; --` becomes the single
 * identifier `"x"" TEXT); DROP TABLE users; --"` rather than a chained
 * statement. Anything that interpolates a table or column name into SQL must
 * go through this function: dataset column names come straight from the
 * uploaded CSV/XLSX header row and are never sanitised.
 *
 * Quoting is additive - a name already restricted to [a-z0-9_] comes back
 * byte-identical to `"name"`, so applying this to already-sanitised table
 * names cannot rename an existing table.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
