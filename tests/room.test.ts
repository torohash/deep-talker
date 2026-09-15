import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, test } from "vitest";
import { createClient } from "@libsql/client/http";
import type { Env } from "../worker/env";
import type { RoomState } from "../shared/model";
import { ROOM_NAME, SESSION_SECONDS, tickets } from "../shared/model";
import { tokenHash, hashPassword, verifyPassword } from "../worker/password";
import type {} from "./provided";

const bindings = env as Env;
const database = createClient({ url: bindings.TURSO_DATABASE_URL, authToken: "" });
const clients: WebSocket[] = [];
const cookies = new Map<string, string>();

function request(
  id: string,
  path: string,
  body?: Record<string, string | number | number[]>,
  extra?: HeadersInit,
) {
  const headers = new Headers(extra);
  headers.set("Cookie", cookies.get(id)!);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return bindings.ROOM.getByName(ROOM_NAME).fetch(
    new Request(`https://app.test/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function connect(id: string) {
  const response = await request(id, "room", undefined, { Upgrade: "websocket" });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  clients.push(socket);
  let latest: RoomState | undefined;
  const waiters: {
    predicate: (state: RoomState) => boolean;
    resolve: (state: RoomState) => void;
  }[] = [];
  socket.addEventListener("message", (event) => {
    void new Response(String(event.data)).json<RoomState>().then((state) => {
      latest = state;
      // 解決時に元の配列を更新するため、コピーを走査する。
      for (const waiter of waiters.slice())
        if (waiter.predicate(state)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(state);
        }
    });
  });
  socket.accept();
  function wait(predicate: (state: RoomState) => boolean): Promise<RoomState> {
    if (latest && predicate(latest)) return Promise.resolve(latest);
    return new Promise((resolve) => waiters.push({ predicate, resolve }));
  }
  await wait((state) => state.participants.some((member) => member.id === id));
  return { socket, wait };
}

async function snapshot(id = "admin") {
  const response = await request(id, "state");
  expect(response.status).toBe(200);
  return response.json<RoomState>();
}

beforeEach(async () => {
  await database.batch(
    [
      "DELETE FROM votes",
      "DELETE FROM rounds",
      "DELETE FROM sessions",
      "DELETE FROM topics",
      "DELETE FROM users",
      "DELETE FROM sqlite_sequence WHERE name = 'rounds'",
      "INSERT INTO rounds (phase, created_at) VALUES ('selecting', 0)",
    ],
    "write",
  );
  cookies.clear();
  for (let index = 0; index < 9; index++) {
    const id = index === 0 ? "admin" : `member-${index}`;
    await database.execute({
      sql: "INSERT INTO users (id, name, password_hash) VALUES (?, ?, ?)",
      args: [id, `メンバー${index}`, inject("passwordHash")],
    });
    const token = crypto.randomUUID();
    cookies.set(id, `deep_talker_session=${token}`);
    await database.execute({
      sql: "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
      args: [id, await tokenHash(token), Date.now() + SESSION_SECONDS * 1000],
    });
  }
  for (let index = 1; index <= 12; index++)
    await database.execute({
      sql: "INSERT INTO topics (id, title, detail, level, is_used) VALUES (?, ?, ?, ?, 0)",
      args: [index, `題材${index}`, `詳しい説明${index}`, (index % 3) + 1],
    });
});

afterEach(async () => {
  await Promise.all(
    clients.splice(0).map((socket) => {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.close(1000, "テスト終了");
      });
    }),
  );
  await request("admin", "session");
});

describe("参加・投票・抽選", () => {
  test("2人目から投票でき、全員の投票後は参加者の誰でも一度だけ抽選を確定できる", async () => {
    const admin = await connect("admin");
    expect((await snapshot()).canVote).toBe(false);
    expect((await request("admin", "vote", { roundId: 1, topicIds: [1, 2, 3] })).status).toBe(409);
    const member = await connect("member-1");
    await admin.wait((state) => state.participants.length === 2 && state.canVote);
    expect((await request("admin", "vote", { roundId: 1, topicIds: [1, 2, 3] })).status).toBe(200);
    expect((await snapshot()).canDraw).toBe(false);
    expect((await request("member-1", "vote", { roundId: 1, topicIds: [1, 4, 5] })).status).toBe(
      200,
    );
    const ready = await admin.wait((state) => state.canDraw);
    expect(ready.round.phase).toBe("selecting");
    expect(ready.round.topicId).toBeNull();
    const own = await member.wait((state) => state.ownVotes.length === 3);
    expect(own.ownVotes).toEqual([1, 4, 5]);
    expect(own.canDraw).toBe(true);
    expect((await request("member-1", "draw", { roundId: 1 })).status).toBe(200);
    expect((await request("admin", "draw", { roundId: 1 })).status).toBe(409);
    const talking = await admin.wait((state) => state.round.phase === "talking");
    const delivered = await member.wait((state) => state.round.phase === "talking");
    expect(delivered.round.topicId).toBe(talking.round.topicId);
    expect(talking.topics.find((topic) => topic.id === talking.round.topicId)!.used).toBe(false);
  });

  test("途中参加の未投票者がいると確定不可になり、その人の投票後に再度確定できる", async () => {
    const admin = await connect("admin");
    await connect("member-1");
    await request("admin", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    await request("member-1", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    await admin.wait((state) => state.canDraw);
    await connect("member-2");
    await admin.wait((state) => state.participants.length === 3 && !state.canDraw);
    expect((await request("admin", "draw", { roundId: 1 })).status).toBe(409);
    await request("member-2", "vote", { roundId: 1, topicIds: [4, 5, 6] });
    await admin.wait((state) => state.canDraw);
    expect((await request("admin", "draw", { roundId: 1 })).status).toBe(200);
  });

  test("複数タブは1人として扱い、9人目を拒否する", async () => {
    await connect("admin");
    const duplicate = await connect("admin");
    expect((await snapshot()).participants).toHaveLength(1);
    for (let index = 1; index < 8; index++) await connect(`member-${index}`);
    expect((await snapshot()).participants).toHaveLength(8);
    expect((await request("member-8", "room", undefined, { Upgrade: "websocket" })).status).toBe(
      409,
    );
    duplicate.socket.close(1000);
    expect((await snapshot()).participants).toHaveLength(8);
  });

  test("確定後の投票変更・重複・存在しない題材を拒否し、投票を部分保存しない", async () => {
    await connect("admin");
    await connect("member-1");
    for (const picks of [
      [1, 1, 2],
      [1, 2],
      [1, 2, 3, 4],
      [1, 2, 99],
    ])
      expect((await request("admin", "vote", { roundId: 1, topicIds: picks })).status).toBe(400);
    expect((await snapshot()).ownVotes).toEqual([]);
    expect((await request("admin", "vote", { roundId: 1, topicIds: [1, 2, 4] })).status).toBe(200);
    expect((await request("admin", "vote", { roundId: 1, topicIds: [5, 6, 7] })).status).toBe(409);
    expect((await snapshot()).ownVotes).toEqual([1, 2, 4]);
  });

  test("使用済みの題材は次の回に選べない", async () => {
    await connect("admin");
    await connect("member-1");
    await request("admin", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    await request("member-1", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    await request("admin", "draw", { roundId: 1 });
    const used = (await snapshot()).round.topicId!;
    await request("admin", "finish", { roundId: 1 });
    await request("admin", "start", { roundId: 1 });
    const others = [1, 2, 3, 4, 5, 6].filter((id) => id !== used).slice(0, 2);
    expect(
      (await request("admin", "vote", { roundId: 2, topicIds: [...others, used] })).status,
    ).toBe(400);
    expect((await request("admin", "vote", { roundId: 2, topicIds: [...others, 7] })).status).toBe(
      200,
    );
  });

  test("二重の確定で再抽選せず、終了時に使用済みにして次回へ進む", async () => {
    const admin = await connect("admin");
    await connect("member-1");
    await request("admin", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    await request("member-1", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    const responses = await Promise.all([
      request("admin", "draw", { roundId: 1 }),
      request("admin", "draw", { roundId: 1 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const talking = await snapshot();
    expect((await request("member-1", "finish", { roundId: 1 })).status).toBe(200);
    expect((await request("admin", "finish", { roundId: 1 })).status).toBe(409);
    const finished = await admin.wait((state) => state.round.phase === "finished");
    expect(finished.topics.find((topic) => topic.id === talking.round.topicId)!.used).toBe(true);
    expect((await request("member-1", "start", { roundId: 1 })).status).toBe(200);
    const next = await admin.wait((state) => state.round.id === 2);
    expect(next.round).toEqual({ id: 2, phase: "selecting", topicId: null });
    expect(next.ownVotes).toEqual([]);
    expect(next.participants.every((member) => !member.voted)).toBe(true);
    expect((await request("member-1", "start", { roundId: 1 })).status).toBe(409);
  });

  test("再接続で確定済みの票が戻り、接続に付けた本人情報をDOから取り出せる", async () => {
    await connect("admin");
    const member = await connect("member-1");
    await request("member-1", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    member.socket.close(1000);
    const reopened = await connect("member-1");
    const state = await reopened.wait((value) => value.ownVotes.length === 3);
    expect(state.ownVotes).toEqual([1, 2, 3]);
    const identities = await runInDurableObject(bindings.ROOM.getByName(ROOM_NAME), (_, ctx) =>
      ctx
        .getWebSockets()
        .filter((socket) => socket.readyState === WebSocket.OPEN)
        .map((socket) => socket.deserializeAttachment().userId),
    );
    expect(identities).toContain("admin");
    expect(identities).toContain("member-1");
  });

  test("最後の接続が切れると退室し、2人未満では確定できなくなる", async () => {
    const admin = await connect("admin");
    const member = await connect("member-1");
    await request("admin", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    await request("member-1", "vote", { roundId: 1, topicIds: [1, 2, 3] });
    await admin.wait((state) => state.canDraw);
    member.socket.close(1000);
    await admin.wait((state) => state.participants.length === 1 && !state.canDraw);
    expect((await request("member-1", "vote", { roundId: 1, topicIds: [4, 5, 6] })).status).toBe(
      403,
    );
    expect((await request("admin", "draw", { roundId: 1 })).status).toBe(409);
  });

  test("重複を除かず、在室メンバーの票だけを抽選対象にする", () => {
    const data = {
      round: { id: 1, phase: "selecting" as const, topicId: null },
      topics: [],
      members: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      votes: [
        { userId: "a", topicId: 1 },
        { userId: "a", topicId: 2 },
        { userId: "a", topicId: 3 },
        { userId: "b", topicId: 1 },
        { userId: "b", topicId: 4 },
        { userId: "b", topicId: 5 },
        { userId: "left", topicId: 9 },
      ],
    };
    expect(tickets(data)).toEqual([1, 2, 3, 1, 4, 5]);
  });
});

test("SQLから題材を登録・編集すると日時を記録し、作成日時を保持する", async () => {
  const before = Math.floor(Date.now() / 1000) * 1000;
  const inserted = await database.execute({
    sql: "INSERT INTO topics (title, detail, level, is_used) VALUES (?, ?, 1, 0) RETURNING id",
    args: ["日時の確認", "詳細"],
  });
  const id = inserted.rows[0].id;
  try {
    const read = async () =>
      (await database.execute({ sql: "SELECT * FROM topics WHERE id = ?", args: [id] })).rows[0];
    const created = await read();
    expect(Number(created.created_at)).toBeGreaterThanOrEqual(before);
    expect(Number(created.created_at)).toBeLessThanOrEqual(Date.now());
    expect(created.updated_at).toBe(created.created_at);

    await database.execute({ sql: "UPDATE topics SET updated_at = 1 WHERE id = ?", args: [id] });
    await database.execute({
      sql: "UPDATE topics SET title = ?, detail = ?, level = 3 WHERE id = ?",
      args: ["編集後", "編集した詳細", id],
    });
    const edited = await read();
    expect(edited.created_at).toBe(created.created_at);
    expect(Number(edited.updated_at)).toBeGreaterThan(1);

    await database.execute({ sql: "UPDATE topics SET updated_at = 1 WHERE id = ?", args: [id] });
    await database.execute({ sql: "UPDATE topics SET is_used = 1 WHERE id = ?", args: [id] });
    const used = await read();
    expect(used.created_at).toBe(created.created_at);
    expect(Number(used.updated_at)).toBeGreaterThan(1);
  } finally {
    await database.execute({ sql: "DELETE FROM topics WHERE id = ?", args: [id] });
  }
});

describe("ログインとセッション", () => {
  test("パスワードを照合し、平文トークンをDBへ保存せずCookieを発行する", async () => {
    const response = await request("admin", "login", { id: "admin", password: "test-password" });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain(`Max-Age=${SESSION_SECONDS}`);
    const raw = decodeURIComponent(cookie.split(";")[0].slice("deep_talker_session=".length));
    const row = (
      await database.execute({
        sql: "SELECT * FROM sessions WHERE token_hash = ?",
        args: [await tokenHash(raw)],
      })
    ).rows[0];
    expect(row.user_id).toBe("admin");
    expect(row.token_hash).not.toBe(raw);
    expect((await request("admin", "login", { id: "admin", password: "wrong" })).status).toBe(401);
    expect((await request("admin", "login", { id: "missing", password: "wrong" })).status).toBe(
      401,
    );
  });

  test("新規アクセス時に28日へ延長し、期限切れトークンの延長は拒否する", async () => {
    const hash = await tokenHash(cookies.get("admin")!.split("=")[1]);
    await database.execute({
      sql: "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
      args: [Date.now() + 60_000, hash],
    });
    const before = Date.now();
    expect((await request("admin", "session", {})).status).toBe(200);
    const expiry = Number(
      (
        await database.execute({
          sql: "SELECT expires_at FROM sessions WHERE token_hash = ?",
          args: [hash],
        })
      ).rows[0].expires_at,
    );
    expect(expiry).toBeGreaterThanOrEqual(before + SESSION_SECONDS * 1000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + SESSION_SECONDS * 1000);
    await database.execute({
      sql: "UPDATE sessions SET expires_at = 0 WHERE token_hash = ?",
      args: [hash],
    });
    expect((await request("admin", "session", {})).status).toBe(401);
  });

  test("別の端末でログインすると前のトークンは使えなくなり、行は1つだけになる", async () => {
    const pc = await request("admin", "login", { id: "admin", password: "test-password" });
    const phone = await request("admin", "login", { id: "admin", password: "test-password" });
    const pcCookie = pc.headers.get("Set-Cookie")!.split(";")[0];
    const phoneCookie = phone.headers.get("Set-Cookie")!.split(";")[0];
    expect(pcCookie).not.toBe(phoneCookie);
    // 端末名はテスト内のラベル。実際の識別にはCookieだけを使用する。
    cookies.set("pc", pcCookie);
    cookies.set("phone", phoneCookie);
    expect((await request("pc", "session")).status).toBe(401);
    expect((await request("phone", "session")).status).toBe(200);
    expect(
      (await database.execute("SELECT count(*) AS count FROM sessions WHERE user_id = 'admin'"))
        .rows[0].count,
    ).toBe(1);
    expect((await request("phone", "logout", {})).status).toBe(200);
    expect((await request("phone", "session")).status).toBe(401);
  });

  test("別の端末でログインすると、前の端末のWebSocket接続を切る", async () => {
    const admin = await connect("admin");
    const closed = new Promise<CloseEvent>((resolve) =>
      admin.socket.addEventListener("close", (event) => resolve(event), { once: true }),
    );
    expect(
      (await request("admin", "login", { id: "admin", password: "test-password" })).status,
    ).toBe(200);
    const event = await closed;
    expect(event.code).toBe(4401);
    expect((await request("admin", "state")).status).toBe(401);
  });

  test("ログアウトでセッションを失効させる", async () => {
    await connect("admin");
    const response = await request("admin", "logout", {});
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await request("admin", "state")).status).toBe(401);
  });

  test("同じパスワードでも異なるソルトを使い、長い日本語パスワードも照合できる", async () => {
    const password = "長いパスワード".repeat(12);
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(`${password}違う`, first)).toBe(false);
  });
});
