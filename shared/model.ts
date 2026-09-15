export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 8;
export const VOTES_PER_PERSON = 3;
export const SESSION_SECONDS = 28 * 24 * 60 * 60;
export const ROOM_NAME = "main";

export type Role = "admin" | "member";
export type Phase = "selecting" | "talking" | "finished";
export type Level = 1 | 2 | 3;

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Topic {
  id: number;
  title: string;
  detail: string;
  level: Level;
  used: boolean;
}

export interface Participant extends User {
  voted: boolean;
}

export interface Round {
  id: number;
  phase: Phase;
  topicId: number | null;
}

export interface RoomState {
  viewer: User;
  round: Round;
  topics: Topic[];
  participants: Participant[];
  ownVotes: number[];
  canVote: boolean;
  canDraw: boolean;
  readyForDraw: boolean;
  canFinish: boolean;
  canStart: boolean;
}

export interface Vote {
  userId: string;
  topicId: number;
}

export interface RoomData {
  round: Round;
  topics: Topic[];
  members: User[];
  votes: Vote[];
}

export function roomState(data: RoomData, viewer: User): RoomState {
  const participants = data.members.map((member) => ({
    ...member,
    voted: data.votes.filter((vote) => vote.userId === member.id).length === VOTES_PER_PERSON,
  }));
  const present = participants.some((member) => member.id === viewer.id);
  const ownVotes = data.votes
    .filter((vote) => vote.userId === viewer.id)
    .map((vote) => vote.topicId);
  const voting = data.round.phase === "selecting" && participants.length >= MIN_PARTICIPANTS;
  const admin = present && viewer.role === "admin";
  const readyForDraw = voting && participants.every((member) => member.voted);
  return {
    viewer,
    round: data.round,
    topics: data.topics,
    participants,
    ownVotes,
    canVote:
      present &&
      voting &&
      ownVotes.length === 0 &&
      data.topics.filter((topic) => !topic.used).length >= VOTES_PER_PERSON,
    readyForDraw,
    canDraw: admin && readyForDraw,
    canFinish: admin && data.round.phase === "talking",
    canStart: admin && data.round.phase === "finished",
  };
}

export function tickets(data: RoomData): number[] {
  const members = new Set(data.members.map((member) => member.id));
  return data.votes.filter((vote) => members.has(vote.userId)).map((vote) => vote.topicId);
}
