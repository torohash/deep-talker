import { DurableObject } from "cloudflare:workers";
import { MAX_PARTICIPANTS, roomState } from "../shared/model";
import type { RoomData } from "../shared/model";
import type { Env } from "./env";
import { OperationError } from "./errors";
import { Store } from "./store";
import { cookieToken, sessionCookie, Sessions } from "./session";
import type { Session } from "./session";
import { RoomService } from "./room-service";
import type { Action, ActionInput } from "./room-service";
interface Connection {
  userId: string;
  sessionHash: string;
  expiresAt: number;
}
const json = (body: unknown, headers?: Record<string, string>) =>
  Response.json(body, { headers: { "Cache-Control": "no-store", ...headers } });

export class TalkRoom extends DurableObject<Env> {
  private readonly store: Store;
  private readonly sessions: Sessions;
  private readonly service: RoomService;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new Store(env);
    this.sessions = new Sessions(this.store);
    this.service = new RoomService(this.store);
  }

  // 外部DBへの通信中も、入退室と抽選の確定順序を維持する。
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private connections(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => {
      const connection = socket.deserializeAttachment() as Connection;
      if (connection.expiresAt <= Date.now() && socket.readyState === WebSocket.OPEN)
        socket.close(4401, "ログインの有効期限が切れました。");
      return socket.readyState === WebSocket.OPEN;
    });
  }

  private memberIds(): string[] {
    return [
      ...new Set(
        this.connections().map((socket) => (socket.deserializeAttachment() as Connection).userId),
      ),
    ];
  }

  // 接続中のメンバーをTursoから読み、いまの部屋の状態を組み立てる。
  private snapshot(joining?: string): Promise<RoomData> {
    const ids = this.memberIds();
    if (joining !== undefined && !ids.includes(joining)) ids.push(joining);
    return this.service.snapshot(ids);
  }

  private publish(data: RoomData): void {
    for (const socket of this.connections()) {
      const { userId } = socket.deserializeAttachment() as Connection;
      const viewer = data.members.find((member) => member.id === userId)!;
      socket.send(JSON.stringify(roomState(data, viewer)));
    }
  }

  private async join(request: Request, session: Session): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      throw new OperationError(426, "WebSocketで接続してください。");
    const ids = this.memberIds();
    if (!ids.includes(session.user.id) && ids.length >= MAX_PARTICIPANTS)
      throw new OperationError(409, "部屋は満員です。参加できるのは8人までです。");
    const data = await this.snapshot(session.user.id);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId: session.user.id,
      sessionHash: session.hash,
      expiresAt: session.expiresAt,
    } satisfies Connection);
    this.publish(data);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async route(request: Request): Promise<Response> {
    const path = URL.parse(request.url)!.pathname;
    const secure = this.env.COOKIE_SECURE === "true";
    if (path === "/api/login" && request.method === "POST") {
      const input = (await request.json()) as { id: string; password: string };
      const { session, token } = await this.sessions.login(input.id, input.password);
      // 1人につき1つのセッションなので、前の端末の接続はここで切る。
      for (const socket of this.ctx.getWebSockets()) {
        const info = socket.deserializeAttachment() as Connection;
        if (info.userId === session.user.id && info.sessionHash !== session.hash)
          socket.close(4401, "別の端末でログインしました。");
      }
      return json(session.user, { "Set-Cookie": sessionCookie(token, secure) });
    }
    const session = await this.sessions.require(request);
    if (path === "/api/session" && request.method === "POST") {
      const renewed = await this.sessions.renew(session);
      for (const socket of this.ctx.getWebSockets()) {
        const info = socket.deserializeAttachment() as Connection;
        if (info.sessionHash === session.hash)
          socket.serializeAttachment({ ...info, expiresAt: renewed.expiresAt });
      }
      return json(renewed.user, { "Set-Cookie": sessionCookie(cookieToken(request)!, secure) });
    }
    if (path === "/api/session" && request.method === "GET") return json(session.user);
    if (path === "/api/logout" && request.method === "POST") {
      await this.sessions.logout(session);
      for (const socket of this.connections()) {
        if ((socket.deserializeAttachment() as Connection).sessionHash === session.hash)
          socket.close(4401, "ログアウトしました。");
      }
      this.publish(await this.snapshot());
      return json({ ok: true }, { "Set-Cookie": sessionCookie("", secure, 0) });
    }
    if (path === "/api/room" && request.method === "GET") return this.join(request, session);
    if (path === "/api/state" && request.method === "GET")
      return json(roomState(await this.snapshot(), session.user));
    const action = path.slice("/api/".length);
    if (request.method === "POST" && ["vote", "draw", "finish", "start"].includes(action)) {
      const input = (await request.json()) as ActionInput;
      const data = await this.service.act(action as Action, input, session.user, this.memberIds());
      this.publish(data);
      return json({ ok: true });
    }
    return new Response("見つかりません。", { status: 404 });
  }

  fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      try {
        return await this.route(request);
      } catch (error) {
        if (error instanceof OperationError)
          return new Response(error.message, {
            status: error.status,
            headers: { "Cache-Control": "no-store" },
          });
        throw error;
      }
    });
  }

  webSocketClose(socket: WebSocket): Promise<void> {
    socket.close();
    return this.serial(async () => {
      this.publish(await this.snapshot());
    });
  }

  webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "接続を確認してください。");
    return this.webSocketClose(socket);
  }
}
