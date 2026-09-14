# 開発ツールの検討

調査日：2026-09-15

リンターはOxlint、フォーマッターはOxfmt、テストランナーはVitestを採用した。現在のReact・Vite環境にVitest 4を導入済み。

## テスト

### Vitestを採用

確認した公式資料からは、「Vitestが標準から外れた」と判断する根拠は見つからなかった。
このプロジェクトでは、Viteとの組み合わせとCloudflareの公式連携を理由にVitestを採用した。

- CloudflareはWorkersの単体・結合テストにVitest連携を推奨している。
- 現在の公式連携は`@cloudflare/vitest-plugin`。テストをWorkersのランタイム内で実行でき、APIやバインディングへアクセスできる。
- Vite+の`vp test`もVitestを使用している。
- ReactのコンポーネントはVitestのBrowser Modeで実ブラウザを使って確認できる。

### Cloudflare連携のバージョンに注意

調査時点のnpmのメタデータは次のとおり。

| パッケージ                                                 | 確認したバージョン・条件 |
| ---------------------------------------------------------- | ------------------------ |
| Vitestの最新版                                             | `5.0.0`                  |
| `@cloudflare/vitest-plugin`の最新版                        | `1.1.9`                  |
| 同プラグインが要求するVitest                               | `^4.1.0`                 |
| 同プラグインが要求する`@vitest/runner`・`@vitest/snapshot` | それぞれ`^4.1.0`         |

Cloudflareの導入ガイドも`vitest@^4.1.0`を案内している。
`vitest@^4.1.0`を追加し、解決された`4.1.11`で動作確認した。最新版のVitest 5をそのまま組み合わせると、要求バージョンの範囲から外れる。
古い記事では`@cloudflare/vitest-pool-workers`が紹介されているため、Workersの実装時は現行の公式ガイドを参照する。

### 今回のセットアップ

- `test`スクリプトでVitestを起動する。単発の実行は`bun run test --run`を使う。
- 設定は既存の`vite.config.ts`を使用する。
- 一時テストで、Bun上のVitest実行、ReactコンポーネントとCSS・画像の読み込み、画面の描画を確認した。
- 検証用のテストは確認後に削除した。機能のテストは、実装に合わせて追加する。
- Cloudflareのテストプラグインと設定は、Workersのコードを実装する段階で追加する。

### 速度を理由にした代替候補

速度を重視する場合は、Bunの組み込みテストやRstestも候補になる。

- Bunの組み込みテストは、BunのランタイムでTypeScript・JSXを直接実行できる。
- RstestはRspack系のテストランナーで、Vitestからの移行ガイドを公開している。Rsbuild・Rslibなどと構成を揃える用途にも向く。
- Vitestも性能改善を続けており、環境の初期化・変換・importなどの処理時間を確認する方法を公式に案内している。

Vitestでは、テストファイルごとに実行環境を分離する設定や、DOM環境の初期化に時間がかかる場合がある。
比較する際は、起動だけでなく、実際のテスト、ファイル間の分離、DOM環境、カバレッジ、キャッシュの条件を揃える。
Vitest側の公開ベンチマークでも、実行環境やキャッシュの条件によって結果が変わることを確認できる。今回のアプリでの速度差はまだ測定していない。

Workers・DOのテストは、実装時にCloudflareの公式連携を加える方針とする。

### 選定時に比較した候補

| 候補                | このプロジェクトでの用途                                   | 確認したい点                                                        |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Vitest              | 抽選などの処理、Reactのコンポーネント、Workers・DOのテスト | Cloudflare連携との対応バージョン、Bunからの起動と実行環境の互換性   |
| Bunの組み込みテスト | Bun上で動く処理や、外部環境に依存しない関数のテスト        | Bunの実行結果だけではWorkers固有のAPIやDOの動作を確認できない       |
| Rstest              | Rspack系の構成を使うテスト、Vitestからの移行先の比較       | Viteの設定・プラグインとの対応、Workers向けの実行環境を用意できるか |
| Playwright          | ログインから題材選択・通知まで、ブラウザでの一連の操作     | ブラウザの導入と起動が必要。機能ができた段階で追加を検討する        |

BunのテストランナーはTypeScript・JSXやDOMテストに対応しており、Reactにも使える。Jest互換を目指しているが、完全互換ではないと公式に明記されている。
Bunをパッケージ管理と開発用ランタイムに使うことは、テストランナーもBunに統一する理由にはならない。

`bun test`はBun自身のテストランナーを起動する。Vitestは`bun run test`から実行する。
Hibernationの実際の休止や稼働量は、テストランナー上の確認に加えてCloudflareへのデプロイ後にも確認する。

## リンター・フォーマッター

### Viteの標準テンプレートには変化がある

今回使用した`create-vite@9.2.1`のReact + TypeScriptテンプレートには、`oxlint`と`lint`スクリプトが含まれていた。
CLIにも、ReactテンプレートでOxlintの代わりにESLintを選ぶ`--eslint`オプションがある。
初期セットアップ時には選定を保留していたため除外したが、その後OxlintとOxfmtの採用を決め、`lint`・`fmt`スクリプトを追加した。

Vite+もリンターにOxlint、フォーマッターにOxfmtを使用している。Vite周辺でOxcのツールが採用されていることは確認できる。
一方、Biomeも2026年6月に2.5を公開し、ルールや機能を追加している。「Biomeが使われなくなった」とは判断できない。

### 比較

| 候補                   | 特徴                                                                                | このプロジェクトで検討する点                                       |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Biome                  | リントと整形を1つのツール・設定にまとめられる。React・TypeScript・CSS・JSONを扱える | 初期構成を小さく保ちやすい。必要なルールと整形対象が揃うか確認する |
| Oxlint + Oxfmt（採用） | Vite周辺で採用が進む組み合わせ。OxlintにはReactなどのルールと型情報を使う検査がある | Oxfmtは安定版1.0前。現在はツールの標準設定で使用する               |
| Oxlint + Prettier      | Oxlintを使いつつ、整形はPrettierに任せる                                            | Oxfmtの安定化を待つ場合の候補。設定は2つのツールで管理する         |
| ESLint + Prettier      | 既存のプラグインや設定例が豊富                                                      | 特定のESLintプラグインが必要な場合に検討する                       |

速度については各ツールがベンチマークを公開しているが、今回の小規模なアプリでは、必要な検査・設定の数・安定性を優先して選ぶ。

### OxlintとOxfmtの安定性は別に確認する

- Oxlintは2025年6月に1.0を公開している。
- Oxfmtは2026年2月にBetaを発表した。調査時点のnpmの最新版は`0.68.0`で、1.0には達していない。
- OxfmtはPrettier互換の整形を目指し、多数の形式に対応している。
- OxlintのJavaScriptプラグイン互換機能にはalphaの扱いが残る。既存のESLintプラグインを使う場合は個別に確認する。
- Biomeのnpmの最新版は調査時点で`2.5.13`。

## 採用状況

- **テスト：Vitest 4を採用。** 既存のVite設定で実行する。Workersの実装時に公式連携を追加し、画面全体の確認が必要になった段階でPlaywrightを検討する。
- **リント・整形：Oxlint + Oxfmtを採用。** スクリプトは`lint`と`fmt`を追加し、整形の確認は`fmt --check`で行う。独自のルールや整形設定は追加していない。

## 参考資料

- [Cloudflare：Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare：Write your first test](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [Vitest：Browser Mode](https://vitest.dev/guide/browser/)
- [Bun：Test runner](https://bun.com/docs/test)
- [Rstest：Vitestからの移行](https://rstest.rs/guide/migration/vitest)
- [Vitest：Improving Performance](https://vitest.dev/guide/improving-performance)
- [Vitest：公開ベンチマーク](https://github.com/vitest-dev/benchmarks)
- [Playwright：Installation](https://playwright.dev/docs/intro)
- [Vite+：Test](https://www.viteplus.dev/guide/test)
- [Vite+：Lint](https://www.viteplus.dev/guide/lint)
- [Vite+：Format](https://www.viteplus.dev/guide/fmt)
- [Oxlint](https://oxc.rs/docs/guide/usage/linter)
- [Oxlint 1.0](https://oxc.rs/blog/2025-06-10-oxlint-stable)
- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter)
- [Oxfmt Beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta)
- [Biome：Getting Started](https://biomejs.dev/guides/getting-started/)
- [Biome 2.5](https://biomejs.dev/blog/biome-v2-5/)

npmのバージョンと互換条件は`bun pm view <package> version`と`bun pm view <package> peerDependencies`で確認した。
