import { useState } from "react";
import type { SubmitEvent } from "react";
import { api } from "./api";
import type { User } from "../shared/model";

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Deep Talker ホーム">
      <span className="brand-mark" aria-hidden="true">
        d<span>t</span>
      </span>
      <span>
        deep talker<span className="brand-caption">A LITTLE DEEPER, TOGETHER.</span>
      </span>
    </a>
  );
}

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api<User>("login", { id, password }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-story">
        <Brand />
        <div>
          <p className="eyebrow">LET'S GET TO KNOW EACH OTHER</p>
          <h1>
            いつもの仲間と、
            <br />
            もう少し深い話を。
          </h1>
          <p className="lead">
            正解のない問いから、
            <br />
            まだ知らないお互いが見えてくる。
          </p>
          <div className="story-cards" aria-hidden="true">
            <div>
              最近、夢中になったことは？<span>★</span>
            </div>
            <div>
              どんな瞬間に
              <br />
              自分らしさを感じる？<span>★★★</span>
            </div>
          </div>
        </div>
        <p className="muted small">話せることを、話せる範囲で。</p>
      </section>
      <section className="login-card">
        <p className="eyebrow">WELCOME BACK</p>
        <h2>おかえりなさい</h2>
        <p className="muted">配布されたアカウントでログインしてください。</p>
        <form onSubmit={submit}>
          <label>
            ログインID
            <input
              value={id}
              onChange={(event) => setId(event.target.value)}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              required
              disabled={busy}
            />
          </label>
          <label>
            パスワード
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "ログインしています…" : "部屋に入る →"}
          </button>
        </form>
        <p className="small muted login-note">
          ログインは28日間保持されます。
          <br />
          アプリを開くと、有効期限が更新されます。
        </p>
      </section>
    </div>
  );
}
