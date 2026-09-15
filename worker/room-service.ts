import type { RoomData, User } from "../shared/model";
import { MIN_PARTICIPANTS, VOTES_PER_PERSON, roomState, tickets } from "../shared/model";
import { OperationError } from "./errors";
import { Store } from "./store";

export type Action = "vote" | "draw" | "finish" | "start";
export interface ActionInput {
  roundId: number;
  topicIds?: number[];
}

export function randomIndex(length: number): number {
  const ceiling = 2 ** 32 - (2 ** 32 % length);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= ceiling);
  return value[0] % length;
}

export class RoomService {
  constructor(
    private store: Store,
    private choose: (length: number) => number = randomIndex,
  ) {}

  snapshot(ids: string[]): Promise<RoomData> {
    return this.store.transaction((tx) => this.store.read(tx, ids));
  }

  // 読み取りから書き込みまでを1つのトランザクションで行う。
  act(action: Action, input: ActionInput, user: User, ids: string[]): Promise<RoomData> {
    return this.store.transaction(async (tx) => {
      const data = await this.store.read(tx, ids);
      if (!data.members.some((member) => member.id === user.id))
        throw new OperationError(403, "部屋に入ってから操作してください。");
      if (data.round.id !== input.roundId)
        throw new OperationError(409, "次の回に進んでいます。現在の画面を確認してください。");
      const state = roomState(data, user);
      if (action === "vote") {
        if (data.round.phase !== "selecting")
          throw new OperationError(409, "この回の投票は終了しています。");
        if (data.members.length < MIN_PARTICIPANTS)
          throw new OperationError(409, "2人以上の参加で投票できます。");
        if (state.ownVotes.length > 0) throw new OperationError(409, "投票は確定済みです。");
        const picks = input.topicIds;
        if (
          !Array.isArray(picks) ||
          picks.length !== VOTES_PER_PERSON ||
          new Set(picks).size !== VOTES_PER_PERSON
        )
          throw new OperationError(400, "異なる題材を3つ選んでください。");
        if (picks.some((id) => !data.topics.some((topic) => topic.id === id && !topic.used)))
          throw new OperationError(400, "未使用の題材から選んでください。");
        await tx.execute({
          sql: "INSERT INTO votes (round_id, user_id, topic_id) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
          args: picks.flatMap((id) => [data.round.id, user.id, id]),
        });
      } else {
        if (action === "draw") {
          if (!state.canDraw)
            throw new OperationError(409, "2人以上が参加し、全員の投票が完了すると抽選できます。");
          const pool = tickets(data);
          await tx.execute({
            sql: "UPDATE rounds SET phase = 'talking', topic_id = ? WHERE id = ? AND phase = 'selecting'",
            args: [pool[this.choose(pool.length)], data.round.id],
          });
        } else if (action === "finish") {
          if (!state.canFinish) throw new OperationError(409, "トーク中の回を終了できます。");
          await tx.execute({
            sql: "UPDATE topics SET is_used = 1 WHERE id = ?",
            args: [data.round.topicId],
          });
          await tx.execute({
            sql: "UPDATE rounds SET phase = 'finished', finished_at = ? WHERE id = ?",
            args: [Date.now(), data.round.id],
          });
        } else if (action === "start") {
          if (!state.canStart)
            throw new OperationError(409, "トーク終了後に次の回を開始できます。");
          await tx.execute({
            sql: "INSERT INTO rounds (phase, created_at) VALUES ('selecting', ?)",
            args: [Date.now()],
          });
        }
      }
      return this.store.read(tx, ids);
    });
  }
}
