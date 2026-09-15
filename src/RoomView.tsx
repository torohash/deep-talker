import { useEffect, useState } from "react";
import type { RoomState, User } from "../shared/model";
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS, VOTES_PER_PERSON } from "../shared/model";
import { api } from "./api";
import { Brand } from "./Login";
import { useRoom } from "./useRoom";

const zones = [
  { level: 1, title: "気軽に話せる" },
  { level: 2, title: "少し考えて話す" },
  { level: 3, title: "じっくり話す" },
] as const;

function Members({ state }: { state: RoomState }) {
  return (
    <section className="members-panel" aria-label="参加者">
      <div className="section-heading">
        <h2>
          この部屋のメンバー{" "}
          <span className="count">
            {state.participants.length} / {MAX_PARTICIPANTS}
          </span>
        </h2>
      </div>
      <ul className="members">
        {state.participants.map((member) => (
          <li key={member.id} className={member.voted ? "member voted" : "member"}>
            <span className="avatar">{member.name.slice(0, 1)}</span>
            <div className="member-name">
              <strong>
                {member.name}
                {member.id === state.viewer.id && <small>あなた</small>}
              </strong>
              <span>{member.voted ? "投票済み" : "未投票"}</span>
            </div>
            <span className="member-state" aria-hidden="true">
              {member.voted ? "✓" : "·"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// 状態が届くまでの骨格。接続後に中身が入れ替わっても位置がずれにくいように、
// 部屋と同じ並びと大きさで場所を取っておく。
function RoomSkeleton({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="connection">
            <i />
            接続しています
          </span>
          <span className="account-name">{user.name}</span>
          <button className="text-button" onClick={onLogout}>
            ログアウト
          </button>
        </div>
      </header>
      <main className="room-layout" aria-busy="true">
        <div className="room-heading">
          <span className="skeleton skeleton-title" />
        </div>
        <section className="members-panel" aria-label="メンバーを読み込み中">
          <div className="section-heading">
            <span className="skeleton skeleton-heading" />
            <span className="loading-note">
              <span className="spinner" />
              ログインしています…
            </span>
          </div>
          <ul className="members">
            {[0, 1, 2].map((index) => (
              <li key={index} className="skeleton-member">
                <span className="skeleton skeleton-avatar" />
                <span className="member-name">
                  <span className="skeleton skeleton-name" />
                  <span className="skeleton skeleton-state" />
                </span>
              </li>
            ))}
          </ul>
        </section>
        <span className="skeleton skeleton-ballot" />
        <div className="topic-zones">
          {[0, 1, 2].map((zone) => (
            <section key={zone} className="topic-zone">
              <h3 className="zone-heading">
                <span className="skeleton skeleton-zone" />
              </h3>
              <div className="zone-topics">
                {[0, 1, 2, 3, 4, 5].map((item) => (
                  <span key={item} className="topic-item skeleton-item">
                    <span className="skeleton skeleton-item-title" />
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
        <section className="vote-bar">
          <span className="skeleton skeleton-strong" />
          <span className="skeleton skeleton-button" />
        </section>
        <section className="draw-panel">
          <div>
            <span className="skeleton skeleton-h2" />
            <span className="skeleton skeleton-muted" />
          </div>
          <span className="skeleton skeleton-button" />
        </section>
      </main>
      <footer className="footer">
        <span>deep talker</span>
      </footer>
    </>
  );
}

export function RoomView({ user, onSignedOut }: { user: User; onSignedOut: () => void }) {
  const room = useRoom(user, onSignedOut);
  const [selected, setSelected] = useState<number[]>([]);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  useEffect(() => {
    setSelected([]);
  }, [room.state?.round.id]);
  const state = room.state;
  const currentTopic = state?.topics.find((topic) => topic.id === state.round.topicId);
  const connected = room.status === "connected";
  const choice = state && state.ownVotes.length > 0 ? state.ownVotes : selected;
  async function logout() {
    try {
      await api("logout", {});
      onSignedOut();
    } catch (cause) {
      setLogoutError(String(cause));
    }
  }
  function toggle(id: number) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }
  // 接続が終わるまでは骨格を出す。接続前の状態だけが先に届いて、
  // メンバーが空のまま一度描かれるのを避ける。
  if (room.status === "connecting") return <RoomSkeleton user={user} onLogout={logout} />;
  return (
    <>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className={`connection ${connected ? "online" : ""}`}>
            <i />
            {connected ? "接続中" : "未接続"}
          </span>
          <span className="account-name">{user.name}</span>
          <button className="text-button" onClick={logout}>
            ログアウト
          </button>
        </div>
      </header>
      <main className="room-layout">
        {state && (
          <div className="room-heading">
            {state.round.phase === "selecting" && <h1>3つ選んで投票しよう。</h1>}
            {connected && (
              <button className="text-button leave" onClick={room.leave}>
                部屋を退出する ↗
              </button>
            )}
          </div>
        )}
        {(room.error || logoutError) && (
          <div role="alert" className="error">
            {room.error}
            {logoutError}
          </div>
        )}
        {!connected && (
          <div className="notice connection-notice">
            <div>
              <strong>
                {room.status === "left" ? "部屋を退出しました" : "接続が切れています"}
              </strong>
              <p>入室すると参加者に加わります。投票内容は再接続後も保持されます。</p>
            </div>
            <button className="secondary" onClick={room.reconnect}>
              部屋に接続する
            </button>
          </div>
        )}
        {state && (
          <>
            <Members state={state} />
            {state.round.phase === "selecting" ? (
              <>
                {state.participants.length < MIN_PARTICIPANTS && (
                  <div className="notice">
                    もう一人の参加を待っています。2人以上で投票できます。
                  </div>
                )}
                <h2 className="ballot-title">トークアイデア</h2>
                {state.topics.filter((topic) => !topic.used).length < VOTES_PER_PERSON && (
                  <div className="notice">
                    未使用の題材が3件に足りません。DBへの題材の追加をお願いします。
                  </div>
                )}
                <div className="topic-zones">
                  {zones.map((zone) => {
                    const zoneTopics = state.topics.filter((topic) => topic.level === zone.level);
                    return (
                      <section
                        key={zone.level}
                        className={`topic-zone level-${zone.level}`}
                        aria-label={zone.title}
                      >
                        <h3 className="zone-heading">
                          <span className="zone-stars" aria-hidden="true">
                            {"★".repeat(zone.level)}
                          </span>
                          {zone.title}
                          <span className="count">{zoneTopics.length}</span>
                        </h3>
                        <div className="zone-topics">
                          {zoneTopics.map((topic) => {
                            const picked = choice.includes(topic.id);
                            return (
                              <button
                                key={topic.id}
                                type="button"
                                aria-pressed={picked}
                                className={`topic-item ${picked ? "picked" : ""} ${topic.used ? "used" : ""}`}
                                disabled={
                                  !connected ||
                                  room.busy ||
                                  !state.canVote ||
                                  topic.used ||
                                  (!picked && choice.length >= VOTES_PER_PERSON)
                                }
                                onClick={() => toggle(topic.id)}
                              >
                                <span className="topic-title">{topic.title}</span>
                                <span className="topic-check">
                                  {topic.used ? "済" : picked ? "✓" : "+"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
                {state.topics.length === 0 && (
                  <div className="empty">
                    題材がまだありません。DBに登録した題材がここに並びます。
                  </div>
                )}
                <section className="vote-bar">
                  <div>
                    <strong>
                      {state.ownVotes.length > 0
                        ? "投票を受け付けました"
                        : `${selected.length} / ${VOTES_PER_PERSON} 選択中`}
                    </strong>
                    {state.ownVotes.length > 0 && (
                      <p>全員が投票を終えたら、誰でも抽選を確定できます。</p>
                    )}
                  </div>
                  <button
                    className="primary"
                    disabled={
                      !connected ||
                      room.busy ||
                      !state.canVote ||
                      selected.length !== VOTES_PER_PERSON
                    }
                    onClick={() => room.act("vote", selected)}
                  >
                    {state.ownVotes.length > 0
                      ? "投票済み ✓"
                      : room.busy
                        ? "送信しています…"
                        : "この3つに投票する →"}
                  </button>
                </section>
                <section className="draw-panel">
                  <div>
                    <h2>{state.readyForDraw ? "全員の投票が揃いました" : "投票待機中"}</h2>
                    <p className="muted">
                      {state.participants.filter((member) => member.voted).length} /{" "}
                      {state.participants.length} 人が投票済み。
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={!connected || room.busy || !state.canDraw}
                    onClick={() => room.act("draw")}
                  >
                    確定して抽選する ✦
                  </button>
                </section>
              </>
            ) : (
              <section className="talk-panel">
                <span className="talk-stars">{"★".repeat(currentTopic!.level)}</span>
                <h2>{currentTopic!.title}</h2>
                <p className="talk-detail">{currentTopic!.detail}</p>
                <button
                  className="primary"
                  disabled={!connected || room.busy || !(state.canFinish || state.canStart)}
                  onClick={() => room.act(state.round.phase === "talking" ? "finish" : "start")}
                >
                  {room.busy
                    ? "更新しています…"
                    : state.round.phase === "talking"
                      ? "トークを終了する"
                      : "次の回を始める →"}
                </button>
                {state.round.phase === "finished" && (
                  <p className="small muted">この題材を使用済みにしました。</p>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <footer className="footer">
        <span>deep talker</span>
      </footer>
    </>
  );
}
