import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomState, User } from "../shared/model";
import { MAX_PARTICIPANTS } from "../shared/model";
import { api, ApiError } from "./api";

export function useRoom(user: User, signedOut: () => void) {
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "left">(
    "connecting",
  );
  const [attempt, setAttempt] = useState(0);
  const [joined, setJoined] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const receive = useCallback((next: RoomState) => setState(next), []);
  const onSignedOut = useRef(signedOut);
  onSignedOut.current = signedOut;

  useEffect(() => {
    if (!joined) {
      setStatus("left");
      setState(null);
      return;
    }
    let live = true;
    let socket: WebSocket | undefined;
    setStatus("connecting");
    setError(null);
    void (async () => {
      try {
        const snapshot = await api<RoomState>("state");
        if (!live) return;
        receive(snapshot);
        if (
          snapshot.participants.length >= MAX_PARTICIPANTS &&
          !snapshot.participants.some((member) => member.id === user.id)
        ) {
          setStatus("disconnected");
          setError(`部屋は満員です。参加できるのは${MAX_PARTICIPANTS}人までです。`);
          return;
        }
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${location.host}/api/room`);
        socket.onopen = () => {
          if (live) setStatus("connected");
        };
        socket.onmessage = (event) => {
          if (live) receive(JSON.parse(event.data) as RoomState);
        };
        socket.onerror = () => {
          if (live) setError("接続できませんでした。部屋の定員と接続状況をご確認ください。");
        };
        socket.onclose = (event) => {
          if (!live) return;
          setStatus("disconnected");
          if (event.code === 4401) onSignedOut.current();
        };
      } catch (cause) {
        if (!live) return;
        if (cause instanceof ApiError && cause.status === 401) onSignedOut.current();
        else {
          setError(String(cause));
          setStatus("disconnected");
        }
      }
    })();
    return () => {
      live = false;
      socket?.close(1000, "退室");
    };
  }, [user.id, joined, attempt, receive]);

  async function act(action: "vote" | "draw" | "finish" | "start", topicIds?: number[]) {
    if (state === null) return;
    setBusy(true);
    setError(null);
    try {
      const payload =
        topicIds === undefined
          ? { roundId: state.round.id }
          : { roundId: state.round.id, topicIds };
      // 状態はWebSocketで届く。応答の本文は使わない。
      await api(action, payload);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onSignedOut.current();
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return {
    state,
    status,
    error,
    busy,
    act,
    leave: () => setJoined(false),
    reconnect: () => {
      setJoined(true);
      setAttempt((value) => value + 1);
    },
  };
}
