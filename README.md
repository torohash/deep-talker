# Deep Talker

ゲーム開発チームで、普段より少し深い話をするきっかけを作るWebアプリ。
用意された題材から各自が話したいものを選び、抽選で今回の題材を決める。

現在はReact + Vite + TypeScriptの初期セットアップまで。画面はViteの初期サンプルで、アプリの機能とCloudflare・Tursoへの接続はこれから実装する。

## 開発環境

| 用途                             | 採用するもの                                                  |
| -------------------------------- | ------------------------------------------------------------- |
| 開発用ランタイムのバージョン管理 | mise                                                          |
| 開発用ランタイム・パッケージ管理 | Bun                                                           |
| フロントエンド                   | React + Vite + TypeScript                                     |
| 画面の構成                       | SPA                                                           |
| 公開先・API                      | Cloudflare Workers                                            |
| WebSocketの接続管理・通知        | Cloudflare Durable Objects                                    |
| アプリの状態の保存               | Turso                                                         |
| リンター                         | Oxlint                                                        |
| フォーマッター                   | Oxfmt                                                         |
| テスト                           | Vitest 4。採用経緯は[開発ツールの検討](docs/tooling.md)を参照 |

Bunのバージョンは`mise.toml`、依存パッケージのバージョンは`bun.lock`で管理する。
`bunfig.toml`の`run.bun`により、パッケージのスクリプトもBunで実行する。
CloudflareにデプロイしたWorkerとDurable Objectは、Cloudflareのランタイム（workerd）で動作する。

## セットアップ

[mise](https://mise.jdx.dev/getting-started.html)をインストールしたうえで、プロジェクトのディレクトリで実行する。

```sh
mise trust
mise install
mise exec -- bun install
mise exec -- bun run dev
```

miseをシェルに組み込んでいる場合は、`bun install`や`bun run dev`を直接実行できる。

### ビルドとプレビュー

```sh
mise exec -- bun run build
mise exec -- bun run preview
```

`build`ではTypeScriptの型チェックとViteのビルドを実行する。

### テスト

```sh
mise exec -- bun run test
```

一度だけ実行する場合は`mise exec -- bun run test --run`を使う。
`bun test`はBun自身のテストランナーを起動するため、Vitestには`bun run test`を使う。

Vitestは既存の`vite.config.ts`を読み込む。テストは機能実装時に`.test.ts`や`.test.tsx`として追加する。
現時点ではテストファイルは未追加で、`--run`でテストが見つからない場合はVitest標準の終了コード1になる。
Workers向けのテスト設定は、Workersのコードを実装する段階で追加する。

### リントと整形

```sh
mise exec -- bun run lint
mise exec -- bun run fmt
```

整形結果を確認する場合は`mise exec -- bun run fmt --check`を実行する。
ルールと整形スタイルは各ツールの標準設定を使う。

## 採用する構成

```text
各メンバーのブラウザ
    │ HTTPS / WebSocket
    ▼
Cloudflare Workers
    ├─ SPAの配信・認証・API
    └─ Durable Object：同じ部屋のWebSocket接続と通知を管理
            │
            ▼
          Turso：題材・参加者・選択・抽選結果などを保存
```

- 同じチームのトークルームに1個のDurable Objectを対応させる。
- メンバーやタブが増えた場合も、同じ部屋のDurable Objectへ接続する。
- DO側では、現在の接続とそのユーザーを対応付ける。
- 題材、参加者名簿、選択内容、抽選結果、使用済みフラグ、認証情報はTursoに保存する。
- DOはSQLite方式で作成する。付属ストレージの形式を指定するもので、アプリの状態の保存先はTursoとする。
- 状態の変更をWebSocketで通知する。再接続時にも保存済みの状態を取得する。

DB更新を担当する箇所と、通知に状態全体を含めるか更新通知だけにするかは、機能実装時に決める。

## 機能要件

### メンバーと題材

- メンバー数は可変。現在は4人で、今後もアカウントを追加できるようにする。
- トークの題材はプロジェクトオーナーが集める。
- 題材ごとにタイトル、詳細、話しやすさを表す星の段階を持たせる。
- 選択画面ではタイトルをカードとして並べる。2〜3列を想定し、画面幅に応じた列数は今後決める。
- 使用済みフラグを持たせ、使用済みのカードも一覧に残してグレーアウトする。

### トークの流れ

1. 配布されたIDとパスワードでログインする。
2. 各自が題材を3件選ぶ。
3. その回の参加者全員の選択が完了したら、自動で抽選する。
4. 全員の画面に同じ題材を表示し、その題材について話す。
5. 「トーク終了」操作で終了する。

参加者はユーザーIDで扱い、接続数で人数を数えない。
抽選結果はサーバー側で一度だけ確定し、全員が同じ結果を参照する。

### 認証

- チーム向けにIDとパスワードを配布する。
- パスワードを平文で保存しない。
- ログイン時にトークンを発行し、有効期限は28日間とする。
- ページを新規に開いた際は、SPAのログイン・認証処理を経由する。
- 既存のリフレッシュトークンが有効なら更新し、有効期限をその時点から28日後に設定する。

### Hibernationによる稼働時間の管理

**WebSocket Hibernation APIを使用し、接続を維持したまま、待機中のDOが休止できることを機能要件とする。**

- WebSocket接続は`ctx.acceptWebSocket()`で受け入れる。
- 状態確認のための定期取得や、DO内の常設タイマーで稼働し続ける構成にはしない。
- 外向きのWebSocket・TCP接続を開いたままにするなど、休止を妨げる処理を避ける。
- 接続とユーザーの対応はWebSocketのattachmentで保持し、休止後に取り出せるようにする。
- 休止・再接続後も、Tursoに保存した選択と抽選結果をもとに処理を再開する。
- デプロイ後に、待機中の接続維持とDOの稼働時間を確認する。

## 機能実装時に決める詳細

- 星の段階数と意味、画面幅ごとのカードの列数。
- その回の参加者の決め方、選択の確定方法、確定後の変更可否。
- 抽選で同じ題材に複数票が入った場合の扱い。
- 終了操作の管理者権限と、次の回の開始方法。
- 使用済みフラグを立てるタイミングと、使用済みの題材の再選択可否。
- 題材とアカウントの登録方法、トークンの具体的な構成。

## 利用枠とデプロイ

Cloudflareの利用枠はアカウント全体で共有する。利用プランとCI/CDの構成は今後決める。

- Workers FreeのDO稼働時間枠は13,000 GB秒／日。超過した種類の操作はエラーになり、超過を理由に自動で有料プランへ切り替わることはない。
- Workers Paidは月額5米ドルからで、DO稼働時間400,000 GB秒／月などが含まれる。超過分は従量課金となる。
- 同じアカウントにある他のDOの使用量も合算される。Tursoの料金・制限は別に確認する。
- Tursoの認証トークンはCloudflareのSecretに置き、フロントエンドの`VITE_*`変数には入れない。

## 参考資料

- [mise：Bun](https://mise.jdx.dev/lang/bun.html)
- [Bun：Viteとの利用](https://bun.com/docs/guides/ecosystem/vite)
- [Cloudflare：React SPAとAPI](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- [Cloudflare：WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare：Durable Objectsのライフサイクル](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Cloudflare：Durable Objectsの料金](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Turso：TypeScript SDK](https://docs.turso.tech/sdk/ts/reference)
