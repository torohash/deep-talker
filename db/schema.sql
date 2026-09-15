PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

-- 1人につき1つのセッションだけを持つ。ログインし直すと前のトークンは使えなくなる。
CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  is_used INTEGER NOT NULL CHECK (is_used IN (0, 1)),
  created_at INTEGER,
  updated_at INTEGER
);

-- SQLで直接登録・編集した場合も、DBの時計で日時を記録する。
CREATE TRIGGER IF NOT EXISTS topics_timestamps_insert
AFTER INSERT ON topics
BEGIN
  UPDATE topics
  SET created_at = COALESCE(NEW.created_at, unixepoch() * 1000),
      updated_at = COALESCE(NEW.updated_at, unixepoch() * 1000)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS topics_timestamps_update
AFTER UPDATE OF id, title, detail, level, is_used ON topics
BEGIN
  UPDATE topics SET updated_at = unixepoch() * 1000 WHERE id = NEW.id;
END;

-- 投票からトーク終了までの1回を1行で表す。
-- 最新の行が現在の回で、終了した行はいつ何を話したかの記録として残る。
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT NOT NULL CHECK (phase IN ('selecting', 'talking', 'finished')),
  topic_id INTEGER REFERENCES topics(id),
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS votes (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (round_id, user_id, topic_id)
);

INSERT INTO rounds (phase, created_at)
SELECT 'selecting', unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM rounds);

-- 誰が部屋にいるかは、TalkRoom（Durable Object）が接続から求める。テーブルには持たない。
