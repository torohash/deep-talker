-- 題材の投入書式のサンプル。実際に使う題材はDBへ直接登録し、このファイルには入れない。
-- levelは1が気軽、2が少し考えて話す、3がじっくり話す。
INSERT INTO topics (title, detail, level, is_used) VALUES
('題材のタイトル', '会話のきっかけになる補足。改行も使えます。', 1, 0);
