import { useCallback, useEffect, useState } from "react";
import type { User } from "../shared/model";
import { api, ApiError } from "./api";
import { Brand, Login } from "./Login";
import { RoomView } from "./RoomView";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const signedOut = useCallback(() => setUser(null), []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    void api<User>("session", {})
      .then((current) => {
        if (live) setUser(current);
      })
      .catch((cause) => {
        if (!live) return;
        if (cause instanceof ApiError && cause.status === 401) setUser(null);
        else setError(String(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  if (loading)
    return (
      <div className="boot">
        <Brand />
        <span className="spinner" />
        <p>ログイン状態を確認しています…</p>
      </div>
    );
  if (error)
    return (
      <div className="boot">
        <Brand />
        <h1>接続を確認してください</h1>
        <p className="error" role="alert">
          {error}
        </p>
        <button className="primary" onClick={() => setAttempt((value) => value + 1)}>
          もう一度接続する
        </button>
      </div>
    );
  return user ? (
    <RoomView key={user.id} user={user} onSignedOut={signedOut} />
  ) : (
    <Login onLogin={setUser} />
  );
}
