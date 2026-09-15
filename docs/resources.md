# 本番リソースとデプロイ

この文書の本番向け操作は未実行。Cloudflare・Tursoへのアクセス権を持つ人が実施する。
ローカルではMiniflare／workerdとlibSQLサーバーを使用し、ログインからトーク終了まで動作確認している。
ビルドと`wrangler deploy --dry-run`も確認済み。実際のデプロイとSecret登録は行っていない。

## 用意するもの

| リソース・設定       | 必要な内容                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Cloudflareアカウント | Workersをデプロイできる権限。FreeかPaidかを選択する                                              |
| Worker               | 名前は`deep-talker`。変更する場合は`wrangler.jsonc`も合わせる                                    |
| Durable Object       | `TalkRoom`クラスを`ROOM`へバインド。SQLite方式。初回デプロイ時に`v1`マイグレーションで作成される |
| 静的ファイル         | Viteの成果物を`ASSETS`へバインド。Cloudflare Viteプラグインが出力設定を作る                      |
| TursoのDB            | libSQL互換のHTTP APIを提供するDB。接続用HTTPS URLと、そのDBを読み書きできるトークン              |
| メンバー・題材       | 後述のSQLで直接登録。最低1名は`role = 'admin'`とする                                             |
| 公開URL              | `workers.dev`または独自ドメイン。HTTPSで利用する                                                 |

DBクライアントは`@libsql/client/http`を使用している。TursoでDBを作成する際は、選んだエンジン・プランがこのクライアントとHTTPトランザクションに対応することを確認する。
Turso本番への接続と、そのプランでの利用量はまだ確認していない。

## 環境変数・Secret

| 名前                 | 本番                                 | ローカル                |
| -------------------- | ------------------------------------ | ----------------------- |
| `TURSO_DATABASE_URL` | 対象DBの`https://...` URL            | `http://127.0.0.1:8080` |
| `TURSO_AUTH_TOKEN`   | 対象DBの読み書き用トークン           | 空文字                  |
| `COOKIE_SECURE`      | `true`（`wrangler.jsonc`に設定済み） | `.env`で`false`         |

DBのURLとトークンはCloudflare側でSecretとして設定する。フロントエンド用の`VITE_*`変数には入れない。
ローカルでは`.env.example`を`.env`にコピーして設定する。Workerの開発環境とDB操作コマンドは`.env`を読み込む。
`.env`はGit管理対象外。本番へ手動アップロードするファイルには含めない。

## DBへの直接登録

### スキーマ

`db/schema.sql`を対象のDBに適用する。ユーザー・セッション・題材・回・票のテーブルを作る。

ローカルでは次のコマンドを使える。

```sh
mise exec -- bun run db migrate
```

本番ではTursoのSQLコンソールなどから同じSQLを適用する。アプリの起動時にスキーマ作成やデモ投入を自動実行する処理はない。

`rounds`には、投票からトーク終了までの1回が1行ずつ入る。最新の行が現在の回で、終了した行はいつ何を話したかの記録として残る。最初の回はスキーマ適用時に作られる。以前の構成で作ったDBは、テーブルの内容が変わっているため作り直す。

### パスワードのハッシュ

```sh
mise exec -- bun run db hash-password
```

入力したパスワードのハッシュが標準出力へ表示される。入力中のパスワードは端末の表示に注意して扱う。
このアプリのハッシュ形式は`argon2id$ソルト$ハッシュ`。Argon2idの設定は`worker/password.ts`にまとめている。
他のツールのハッシュを流用せず、このコマンドで生成した値を登録する。

### メンバー

以下の値を実際のID・表示名・生成したハッシュへ置き換える。

```sql
INSERT INTO users (id, name, role, password_hash)
VALUES ('your-id', '表示名', 'admin', '生成したハッシュ');

INSERT INTO users (id, name, role, password_hash)
VALUES ('member-id', 'メンバーの表示名', 'member', '生成したハッシュ');
```

`id`がログインIDになる。アカウントの登録数に8人の制限はなく、同時に部屋へ参加できる人数を8人に制限する。
管理者も参加人数に含まれる。管理者が部屋にいる状態で、抽選の確定・終了・次回開始を操作する。

### 題材

```sql
INSERT INTO topics (title, detail, level)
VALUES (
  '話してみたい題材のタイトル',
  '会話のきっかけになる補足説明。改行も使用できます。',
  1
);
```

`level`は1〜3。新規の題材は`is_used = 0`で登録する。
`created_at`・`updated_at`は省略でき、新規登録時にDBトリガーが設定する。ID・タイトル・詳細・レベルの更新時は、作成日時を保って`updated_at`を更新する。
日時はUTCのUnixミリ秒で保存する（DB時計の秒精度）。DBへの直接登録・編集でも同じ処理が動く。
使用済みかどうかは`is_used`で持つ。トークの終了時に、アプリが`is_used = 1`へ更新する。

ローカルでSQLファイルを適用する場合は、次のように実行できる。

```sh
mise exec -- bun run db apply .data/members.sql
mise exec -- bun run db apply .data/topics.sql
```

`.data/`はGit管理対象外。登録内容やハッシュを置く場合はこのディレクトリを使用できる。
DBに直接追加・変更したあと、ブラウザを再読み込みすると新しいデータを取得する。

`sessions`・`rounds`・`votes`はアプリが管理する。
進行中の回を手作業で変更せず、終了と次回開始はアプリの操作で行う。

## デプロイ

`main`へpushすると、GitHub Actionsが検査とデプロイを実行する。手元からデプロイする必要はない。
ワークフローは`.github/workflows/deploy.yml`。lint・fmt・テスト・ビルドがすべて通った場合だけ、`wrangler deploy`を実行する。

### GitHubのSecrets

リポジトリの`Settings`→`Secrets and variables`→`Actions`に、次の2つを登録する。

| 名前                    | 値                                                                           |
| ----------------------- | ---------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflareで発行したAPIトークン。権限は「Workers スクリプトの編集」を含める  |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareのアカウントID。ダッシュボードのURLやWorkersの概要画面で確認できる |

`TURSO_DATABASE_URL`と`TURSO_AUTH_TOKEN`はGitHubには置かない。Worker側のSecretとしてCloudflareに保存する（後述）。

### 初回だけ手元で行う操作

1. TursoにDBを作成し、スキーマ・メンバー・題材を登録する。
2. Cloudflareの対象アカウントを選び、Worker名と利用プランを確認する。
3. 認証してWorkerのSecretを登録する。Workerが未作成の場合は、CLIの作成確認に従う。

   ```sh
   mise exec -- bun run wrangler login
   mise exec -- bun run wrangler secret put TURSO_DATABASE_URL
   mise exec -- bun run wrangler secret put TURSO_AUTH_TOKEN
   ```

以降は`main`へのpushでデプロイされる。手元からデプロイする場合は次のとおり。

```sh
mise exec -- bun run build
mise exec -- bun run wrangler deploy --config dist/deep_talker/wrangler.json
```

生成されたWrangler設定が、Workerと`dist/client`の静的ファイルをまとめて扱う。
`dist`全体をPagesの画面へドラッグ＆ドロップする方式は使用しない。ビルド時にローカルプレビュー用の設定がWorker側の出力へ書き出される場合があるため、静的公開する範囲は生成された設定に従う。

必要に応じて、Workerに独自ドメインを割り当てる。WebSocketの接続先は現在のホストから組み立てるため、URLをフロントエンドに埋め込む作業は不要。

## デプロイ後に確認すること

- HTTPSでログインでき、CookieにSecure・HttpOnly・SameSite=Strictが付いている。
- ページを開き直すとログイン状態を復元し、有効期限が28日後へ更新される。
- 2人以上で投票できる。途中参加した未投票者がいると、管理者の確定が無効になる。
- 9人目を拒否し、同じユーザーの複数タブは1人として数える。
- 全員の投票後も自動抽選せず、管理者の操作で一度だけ確定する。
- 全員に同じ結果が届き、終了後に使用済み表示になり、次回の投票から選択不可になる。
- 再接続時に投票・抽選結果を復元する。
- ログアウト後のセッションではAPIを操作できない。
- 別の端末でログインすると、前の端末は接続が切れてログインを求められる。

### Hibernationと利用量

ローカルテストではHibernation APIによる接続の受け入れとattachmentの取得を確認している。
Cloudflare本番での実際の休止、CPU使用量、GB秒の計測は未実施。

本番では複数人が接続したまま操作を止め、WebSocketが維持されることと、DOの稼働時間の推移を確認する。その後、投票や途中参加で正常に処理が再開することを確認する。
パスワード照合もDOで実行するため、その処理時間とメモリ使用量も確認する。

- アプリ側には待機中のDBポーリングや定期タイマーがない。
- DBとの通信はHTTPで行い、処理完了後にトランザクションを閉じる。
- 同じ部屋では、人数やタブ数が増えても同じDOを使用する。
- 利用枠はCloudflareアカウント全体で共有される。他のDOの使用量も含めて確認する。
- FreeはDO稼働時間13,000 GB秒／日。超過した種類の操作はエラーになる。
- Paidは月額5米ドルからで、DO稼働時間400,000 GB秒／月などを含む。超過分の料金と請求単位は[公式料金表](https://developers.cloudflare.com/durable-objects/platform/pricing/)で確認する。

## 今後の対応

- 題材・メンバーの登録・編集を行う管理画面。
- 8人を超える運用時の、接続・通知・DB使用量の再評価。
- 利用プランと実測に合わせたCI/CD・運用の設定。
