import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuthUser { id: string; name: string; email?: string; globalRole: 'admin' | 'user' }
export interface LoginTransaction { state: string; binding: string; verifier: string; nonce: string; expiresAt: number }
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Dedicated single-host reference store. Tokens in cookies are never stored raw. */
export class AuthStore {
  private db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') chmodSync(file, 0o600);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('Unsupported authentication database version.'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identities (
        issuer TEXT NOT NULL, subject TEXT NOT NULL, id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL, email TEXT, global_role TEXT NOT NULL CHECK(global_role IN ('user','admin')),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(issuer, subject)
      );
      CREATE TABLE IF NOT EXISTS logins (
        state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, verifier TEXT NOT NULL,
        nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES identities(id),
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_binding ON sessions(binding_hash);
      CREATE INDEX IF NOT EXISTS login_binding ON logins(binding_hash);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS login_expiry ON logins(expires_at);
      PRAGMA user_version = 1;
    `);
  }

  close() { this.db.close(); }

  provision(issuer: string, subject: string, user: AuthUser) {
    for (const value of [issuer, subject, user.id, user.name]) {
      if (!value || value !== value.trim() || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Identity mapping has an invalid field.');
    }
    // These values are also exposed through the institutional schema. Keep the
    // approved identity valid for both session and learning responses.
    if (user.id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(user.id) || user.name.length > 500) throw new Error('Identity mapping exceeds the LMS identifier/name contract.');
    if (!['admin', 'user'].includes(user.globalRole)) throw new Error('Identity mapping has an invalid role.');
    if (user.email !== undefined && (!user.email.includes('@') || user.email.length > 500 || /\s/.test(user.email))) throw new Error('Identity mapping has an invalid email.');
    // This command creates mappings; it never silently changes identity ownership
    // or reactivates a disabled account during a repeated deployment.
    this.db.prepare('INSERT INTO identities(issuer,subject,id,name,email,global_role) VALUES(?,?,?,?,?,?)')
      .run(issuer, subject, user.id, user.name, user.email ?? null, user.globalRole);
  }

  disable(userId: string) {
    this.transaction(() => {
      this.db.prepare('UPDATE identities SET active=0 WHERE id=?').run(userId);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    });
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private prune(now: number) {
    this.db.prepare('DELETE FROM logins WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
  }

  begin(login: LoginTransaction, now: number) {
    this.transaction(() => {
      this.prune(now);
      if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM logins').get()?.n) >= 1000) throw new Error('Login capacity reached.');
      this.db.prepare('INSERT INTO logins(state_hash,binding_hash,verifier,nonce,expires_at) VALUES(?,?,?,?,?)')
        .run(hash(login.state), hash(login.binding), login.verifier, login.nonce, login.expiresAt);
    });
  }

  claim(state: string, binding: string, now: number): Pick<LoginTransaction, 'verifier' | 'nonce'> | null {
    const row = this.db.prepare(`UPDATE logins SET claimed=1
      WHERE state_hash=? AND binding_hash=? AND expires_at>? AND claimed=0 RETURNING verifier,nonce`)
      .get(hash(state), hash(binding), now);
    return row ? { verifier: String(row.verifier), nonce: String(row.nonce) } : null;
  }

  finish(state: string, binding: string, issuer: string, subject: string, token: string, now: number, expiresAt: number): boolean {
    return this.transaction(() => {
      const login = this.db.prepare('DELETE FROM logins WHERE state_hash=? AND binding_hash=? AND claimed=1 AND expires_at>? RETURNING state_hash')
        .get(hash(state), hash(binding), now);
      if (!login) return false; // Expiry/logout also cancels exchanges already in flight.
      const user = this.db.prepare('SELECT id FROM identities WHERE issuer=? AND subject=? AND active=1').get(issuer, subject);
      if (!user) return false;
      this.prune(now);
      if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n) >= 100_000) throw new Error('Session capacity reached.');
      this.db.prepare('INSERT INTO sessions(token_hash,binding_hash,user_id,expires_at) VALUES(?,?,?,?)')
        .run(hash(token), hash(binding), String(user.id), expiresAt);
      return true;
    });
  }

  cancel(state: string, binding: string) {
    this.db.prepare('DELETE FROM logins WHERE state_hash=? AND binding_hash=?').run(hash(state), hash(binding));
  }

  session(token: string, now: number): { user: AuthUser; expiresAt: number } | null {
    const row = this.db.prepare(`SELECT i.id,i.name,i.email,i.global_role,s.expires_at
      FROM sessions s JOIN identities i ON i.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND i.active=1`).get(hash(token), now);
    if (!row) return null;
    return {
      user: { id: String(row.id), name: String(row.name), ...(row.email ? { email: String(row.email) } : {}), globalRole: row.global_role as AuthUser['globalRole'] },
      expiresAt: Number(row.expires_at),
    };
  }

  logout(token: string | null, binding: string | null) {
    this.transaction(() => {
      if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
      if (binding) {
        this.db.prepare('DELETE FROM logins WHERE binding_hash=?').run(hash(binding));
        // Covers a callback finishing just before a logout request that still
        // carries the login cookie, before the new session cookie was received.
        this.db.prepare('DELETE FROM sessions WHERE binding_hash=?').run(hash(binding));
      }
    });
  }
}
