/**
 * Escape a user-supplied search term for use inside a SQL `LIKE`/`ILIKE`
 * pattern. Pure — no imports — so it is unit-testable on its own.
 *
 * `%` and `_` are LIKE wildcards, and `\` is the escape character itself. Left
 * unescaped, a client searching for "50%" would match far more rows than they
 * asked for, and a term of just "%" would match everything. Escaping keeps a
 * typed wildcard a literal character.
 *
 * This is NOT a defence against SQL injection — values still travel as
 * parameters through PostgREST. It is about the pattern meaning what the user
 * typed.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
