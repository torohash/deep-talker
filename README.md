# Deep Talker

ゲーム開発チームで、普段より少し深い話をするきっかけを作るWebアプリ。
題材を3つ選んで投票し、抽選で決まった題材をみんなで話す。本番は <https://deep-talker.torohash.workers.dev> で動いている。

## ローカルで起動する

Linux・macOS、Windowsの場合はWSLを使用する。コマンドはプロジェクトのルートで実行する。

```sh
mise trust
mise install
mise exec -- bun install
cp .env.example .env
```

`.env`はローカルDB向けに次の3つを設定する。開発用のTursoへつなぐ場合は、そのURLとトークンを使う。

```dotenv
TURSO_DATABASE_URL="http://127.0.0.1:8080"
TURSO_AUTH_TOKEN=""
COOKIE_SECURE="false"
```

```sh
mise exec -- bun run dev:db      # 1つ目のターミナルで起動したままにする
mise exec -- bun run db migrate  # 別のターミナルでスキーマを適用する
mise exec -- bun run seed-demo   # 任意。member-1〜member-4と題材の書式サンプル1件を入れる
mise exec -- bun run dev
```

表示されたURLを開く。複数人の動作を見るときは、別のブラウザプロファイルやシークレットウィンドウを使う（同じプロファイルのタブは同じユーザーとして扱う）。
独自のアカウント・題材はDBへ直接登録する。手順は[本番リソースとデプロイ](docs/resources.md#dbへの直接登録)を参照。

## 使い方

1. IDとパスワードでログインすると、部屋へ接続する。
2. 在室者が2人以上になると投票できる。題材を3つ選んで確定すると、その回の選択は変更できない。
3. 在室者全員が投票すると、参加者の誰でも抽選を確定できる。
4. 抽選で決まった題材を全員に表示する。トークを終了するとその題材が使用済みになり、「次の回を始める」で次の投票へ進む。
5. 途中で入った人も同じ回に加わり、その人の投票を待ってから確定する。

- 部屋は最大8人。同じユーザーの複数タブは1人として数える。
- 通信が切れたときは「部屋に接続する」から再接続する。票は回ごとにDBへ残り、再接続で復元する。

## 題材

- 星は3段階。★は気軽に話せる話、★★は少し考えて話す話、★★★はじっくり話す話。
- 題材とメンバーはDBに登録する。管理画面は未作成。題材の投入書式は`db/topics.example.sql`にある。
- 抽選は在室者の3票ずつのくじ。同じ題材を選ぶ人が多いほど当たりやすい。
- 使用済みの題材も一覧に残し、選択できないようにする。

## 開発

```sh
mise exec -- bun run test --run
mise exec -- bun run lint
mise exec -- bun run fmt --check
mise exec -- bun run build
```

- テストはVitest 4と`@cloudflare/vitest-plugin`を使い、実際のWorkers環境で実行する。DBは一時ディレクトリのlibSQLサーバーを使い、開発用・本番用のDBには接続しない。
- 画面はブラウザでも確認する（複数人での投票からトーク終了までと、390px幅の表示）。
- `bun test`はBun自身のテストランナーになるため、Vitestには`bun run test`を使う。

Cloudflare Workers（画面配信とAPI）、Durable Object（部屋の進行）、Turso（回・票・題材）で構成する。
セッションとデータの置き場所は[セッションとデータの配置方針](docs/data-model.md)、本番の設定は[本番リソースとデプロイ](docs/resources.md)に書いている。

## ファイル

| 場所                    | 内容                                                 |
| ----------------------- | ---------------------------------------------------- |
| `src/`                  | ログイン、参加者一覧、題材選択、トーク画面           |
| `shared/model.ts`       | 人数・票数などの共通ルール、状態の型と表示用の計算   |
| `worker/`               | Worker、DO、認証、Tursoへの読み書き                  |
| `db/schema.sql`         | ユーザー・セッション・題材・回・票のテーブル定義     |
| `db/topics.example.sql` | 題材の投入書式のサンプル（実際の題材はDBへ登録する） |
| `scripts/db.ts`         | SQL適用、パスワードハッシュ生成、デモ投入            |
| `tests/`                | WorkersとローカルDBを使うテスト                      |
| `wrangler.jsonc`        | Cloudflareのバインディング・マイグレーション設定     |

- [本番リソースとデプロイ手順](docs/resources.md)
- [セッションとデータの配置方針](docs/data-model.md)
- [開発ツールの選定メモ](docs/tooling.md)
