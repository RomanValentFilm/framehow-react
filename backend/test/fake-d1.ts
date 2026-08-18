// A real database on the bench.
//
// The server talks to Cloudflare's D1. Node now carries SQLite itself, and D1 is
// SQLite underneath — so this wraps Node's into the shape D1 presents, applies
// the project's real migrations, and lets the actual route code run here with no
// deploy and no network.
//
// Why bother: until now the only way to find out what a push really does was to
// deploy it and pick up an iPad. Every fault that cost a day this week — the
// silently dropped fields, the deleted versions, the 100-value refusal — would
// have shown up in a second against this.
//
// It is not D1. It does not enforce D1's limits or its timing. What it does
// give is the real SQL, the real schema, and the real rows.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface FakeResult<T> { results: T[]; success: boolean; meta: Record<string, unknown> }

class FakeStatement {
  // Written out longhand: Node runs TypeScript by stripping the types, and
  // shorthand constructor properties are not something it can strip.
  private db: DatabaseSync;
  private sql: string;
  private args: unknown[];
  constructor(db: DatabaseSync, sql: string, args: unknown[] = []) {
    this.db = db; this.sql = sql; this.args = args;
  }

  bind(...args: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, args);
  }

  private normalised(): unknown[] {
    // node:sqlite takes null, numbers, strings and bigints. Booleans and
    // undefined arrive from code written for D1, which is more forgiving.
    return this.args.map((a) => {
      if (a === undefined) return null;
      if (typeof a === 'boolean') return a ? 1 : 0;
      return a;
    });
  }

  async all<T>(): Promise<FakeResult<T>> {
    const rows = this.db.prepare(this.sql).all(...this.normalised() as never[]) as T[];
    return { results: rows.map((r) => ({ ...r })), success: true, meta: {} };
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.normalised() as never[]) as T | undefined;
    return row ? { ...row } : null;
  }

  async run(): Promise<FakeResult<never>> {
    this.db.prepare(this.sql).run(...this.normalised() as never[]);
    return { results: [], success: true, meta: {} };
  }

  /** D1 refuses a query naming more than 100 values. Kept here so the bench can
   *  catch that fault instead of discovering it on a device. */
  checkLimit(): void {
    if (this.args.length > 100) {
      throw new Error('D1_ERROR: too many SQL variables at offset 0: SQLITE_ERROR');
    }
  }
}

export class FakeD1 {
  readonly db: DatabaseSync;

  constructor(migrationsDir: string) {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      // One statement at a time, because some of these are only half-applicable
      // to a fresh database. 0019 adds columns that 0018 now creates outright —
      // it exists because the live table predates 0018 gaining them. On a new
      // database that is "already there", not a failure. Anything else is real
      // and stops the bench.
      // Comments go first, then the split: a `--` note containing a semicolon
      // would otherwise cut a statement in half.
      const withoutComments = sql
        .split('\n')
        .map((l) => (l.trim().startsWith('--') ? '' : l.replace(/\s--\s.*$/, '')))
        .join('\n');
      for (const raw of withoutComments.split(';')) {
        const stmt = raw.trim();
        if (!stmt) continue;
        try {
          this.db.exec(stmt);
        } catch (e) {
          const msg = (e as Error).message;
          const alreadyThere = /duplicate column name|already exists/i.test(msg);
          if (!alreadyThere) throw new Error(`migration ${file} failed: ${msg}\n  ${stmt.slice(0, 120)}`);
        }
      }
    }
    // ...and what the live database has that no migration describes.
    this.applyFile(join(migrationsDir, '..', 'test', 'schema-drift.sql'));
  }

  /** Apply a file of statements, ignoring anything already present. */
  private applyFile(path: string): void {
    const sql = readFileSync(path, 'utf8');
    const withoutComments = sql
      .split('\n')
      .map((l) => (l.trim().startsWith('--') ? '' : l.replace(/\s--\s.*$/, '')))
      .join('\n');
    for (const raw of withoutComments.split(';')) {
      const stmt = raw.trim();
      if (!stmt) continue;
      try {
        this.db.exec(stmt);
      } catch (e) {
        const msg = (e as Error).message;
        if (!/duplicate column name|already exists/i.test(msg)) {
          throw new Error(`${path} failed: ${msg}\n  ${stmt.slice(0, 120)}`);
        }
      }
    }
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.db, sql);
  }

  async batch<T>(statements: FakeStatement[]): Promise<Array<FakeResult<T>>> {
    // D1 applies a batch as one transaction. So does this, so a half-applied
    // push cannot pass here and fail there.
    const out: Array<FakeResult<T>> = [];
    this.db.exec('BEGIN');
    try {
      for (const s of statements) {
        s.checkLimit();
        out.push(await s.all<T>());
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return out;
  }

  async exec(sql: string): Promise<void> { this.db.exec(sql); }

  /** Straight to the rows, for checking what a push actually left behind. */
  rows<T>(sql: string, ...args: unknown[]): T[] {
    return this.db.prepare(sql).all(...args as never[]) as T[];
  }
  one<T>(sql: string, ...args: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...args as never[]) as T | undefined;
  }
}
