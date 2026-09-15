import { createClient } from "@libsql/client/http";
import type { Row, Transaction } from "@libsql/client";
import type { Env } from "./env";
import type { Level, Phase, RoomData, User } from "../shared/model";

export const userFromRow = (row: Row): User => ({
  id: String(row.id),
  name: String(row.name),
});

// 永続する状態を持つTursoへの読み書き。
// 接続に紐づく在室者はTalkRoom（DO）が接続から求める。
export class Store {
  readonly client;
  constructor(env: Pick<Env, "TURSO_DATABASE_URL" | "TURSO_AUTH_TOKEN">) {
    this.client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  }

  async transaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction("write");
    try {
      const result = await operation(tx);
      await tx.commit();
      return result;
    } finally {
      tx.close();
    }
  }

  // 在室者・題材・現在の回・その回の票をまとめて読む。
  async read(tx: Transaction, ids: string[]): Promise<RoomData> {
    const round = (
      await tx.execute("SELECT id, phase, topic_id FROM rounds ORDER BY id DESC LIMIT 1")
    ).rows[0];
    const topics = await tx.execute(
      "SELECT id, title, detail, level, is_used FROM topics ORDER BY level, id",
    );
    const members =
      ids.length === 0
        ? []
        : (
            await tx.execute({
              sql: `SELECT id, name FROM users WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY name, id`,
              args: ids,
            })
          ).rows.map(userFromRow);
    const votes = await tx.execute({
      sql: "SELECT user_id, topic_id FROM votes WHERE round_id = ?",
      args: [round.id],
    });
    return {
      round: {
        id: Number(round.id),
        phase: round.phase as Phase,
        topicId: round.topic_id === null ? null : Number(round.topic_id),
      },
      topics: topics.rows.map((row) => ({
        id: Number(row.id),
        title: String(row.title),
        detail: String(row.detail),
        level: row.level as Level,
        used: row.is_used === 1,
      })),
      members,
      votes: votes.rows.map((row) => ({
        userId: String(row.user_id),
        topicId: Number(row.topic_id),
      })),
    };
  }
}
