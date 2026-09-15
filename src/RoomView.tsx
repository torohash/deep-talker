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
  return (
    <>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className={`connection ${connected ? "online" : ""}`}>
            <i />
            {connected ? "接続中" : room.status === "connecting" ? "接続しています" : "未接続"}
          </span>
          <span className="account-name">{user.name}</span>
          <button className="text-button" onClick={logout}>
            ログアウト
          </button>
        </div>
      </header>
      <main className="room-layout">
        <div className="room-heading">
          <div>
            {state?.round.phase === "selecting" ? (
              <h1>3つ選んで投票しよう。</h1>
            ) : (
              <>
                <h1>
                  {state?.round.phase === "talking"
                    ? "今日の、話のきっかけ。"
                    : "話してくれて、ありがとう。"}
                </h1>
                <p className="lead">話せることを、話せる範囲で。</p>
              </>
            )}
          </div>
          {connected && (
            <button className="text-button leave" onClick={room.leave}>
              部屋を退出する ↗
            </button>
          )}
        </div>
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
                {room.status === "connecting"
                  ? "部屋につないでいます…"
                  : room.status === "left"
                    ? "部屋を退出しました"
                    : "接続が切れています"}
              </strong>
              <p>入室すると参加者に加わります。投票内容は再接続後も保持されます。</p>
            </div>
            {room.status !== "connecting" && (
              <button className="secondary" onClick={room.reconnect}>
                部屋に接続する
              </button>
            )}
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
                  {zones.map((zone) => (
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
                      </h3>
                      <div className="zone-topics">
                        {state.topics
                          .filter((topic) => topic.level === zone.level)
                          .map((topic) => {
                            const picked = choice.includes(topic.id);
                            return (
                              <button
                                key={topic.id}
                                type="button"
                                aria-pressed={picked}
                                className={`topic-card level-${topic.level} ${picked ? "picked" : ""} ${topic.used ? "used" : ""}`}
                                disabled={
                                  !connected ||
                                  room.busy ||
                                  !state.canVote ||
                                  topic.used ||
                                  (!picked && choice.length >= VOTES_PER_PERSON)
                                }
                                onClick={() => toggle(topic.id)}
                              >
                                <div className="topic-meta">
                                  <span aria-label={`レベル${topic.level}`}>
                                    {"★".repeat(topic.level)}
                                  </span>
                                  <span className="topic-check">
                                    {topic.used ? "済" : picked ? "✓" : "+"}
                                  </span>
                                </div>
                                <h3>{topic.title}</h3>
                              </button>
                            );
                          })}
                      </div>
                    </section>
                  ))}
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
                    <p>
                      {state.ownVotes.length > 0
                        ? "全員が投票を終えたら、誰でも抽選を確定できます。"
                        : "投票を送信すると、この回の選択は変更できません。"}
                    </p>
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
                <p className="eyebrow">
                  {state.round.phase === "talking" ? "TODAY'S TOPIC" : "THANK YOU FOR SHARING"}
                </p>
                <span className="talk-stars">{"★".repeat(currentTopic!.level)}</span>
                <h2>{currentTopic!.title}</h2>
                <p className="talk-detail">{currentTopic!.detail}</p>
                <div className="talk-rule">急がなくて大丈夫。ひとりずつ、聞いてみよう。</div>
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
        <span>会話の先に、新しいチームのかたち。</span>
      </footer>
    </>
  );
}
