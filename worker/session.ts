import type { User } from "../shared/model";
import { SESSION_SECONDS } from "../shared/model";
import { OperationError } from "./errors";
import { newToken, tokenHash, verifyPassword } from "./password";
import { Store, userFromRow } from "./store";

export const COOKIE_NAME = "deep_talker_session";
export interface Session {
  user: User;
  hash: string;
  expiresAt: number;
}

export function cookieToken(request: Request): string | null {
  const pair = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return pair ? decodeURIComponent(pair.slice(COOKIE_NAME.length + 1)) : null;
}

export function sessionCookie(token: string, secure: boolean, seconds = SESSION_SECONDS): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
}

export class Sessions {
  constructor(
    private store: Store,
    private now: () => number = Date.now,
  ) {}

  async require(request: Request): Promise<Session> {
    const token = cookieToken(request);
    if (token === null) throw new OperationError(401, "ログインしてください。");
    const hash = await tokenHash(token);
    const result = await this.store.client.execute({
      sql: "SELECT u.id, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
      args: [hash],
    });
    const row = result.rows[0];
    if (!row || Number(row.expires_at) <= this.now())
      throw new OperationError(
        401,
        "ログインの有効期限が切れました。もう一度ログインしてください。",
      );
    return { user: userFromRow(row), hash, expiresAt: Number(row.expires_at) };
  }

  async login(id: string, password: string): Promise<{ session: Session; token: string }> {
    const row = (
      await this.store.client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] })
    ).rows[0];
    if (!row || !(await verifyPassword(password, String(row.password_hash))))
      throw new OperationError(401, "IDまたはパスワードが正しくありません。");
    const token = newToken();
    const session = {
      user: userFromRow(row),
      hash: await tokenHash(token),
      expiresAt: this.now() + SESSION_SECONDS * 1000,
    };
    // 1人につき1つのセッションだけを持つ。別の端末でログインすると前のトークンは使えなくなる。
    await this.store.client.execute({
      sql: `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
      args: [session.user.id, session.hash, session.expiresAt],
    });
    return { session, token };
  }

  async renew(session: Session): Promise<Session> {
    const expiresAt = this.now() + SESSION_SECONDS * 1000;
    await this.store.client.execute({
      sql: "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
      args: [expiresAt, session.hash],
    });
    return { ...session, expiresAt };
  }

  async logout(session: Session): Promise<void> {
    await this.store.client.execute({
      sql: "DELETE FROM sessions WHERE token_hash = ?",
      args: [session.hash],
    });
  }
}
