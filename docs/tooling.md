# 開発ツールの検討

調査日：2026-09-15

テスト、リンター、フォーマッターは選定中。今回の初期セットアップでは導入を保留している。

## テスト

### Vitestは引き続き有力な候補

確認した公式資料からは、「Vitestが標準から外れた」と判断する根拠は見つからなかった。
このプロジェクトでは、Viteとの組み合わせとCloudflareの公式連携があるため、第一候補にする。

- CloudflareはWorkersの単体・結合テストにVitest連携を推奨している。
- 現在の公式連携は`@cloudflare/vitest-plugin`。テストをWorkersのランタイム内で実行でき、APIやバインディングへアクセスできる。
- Vite+の`vp test`もVitestを使用している。
- ReactのコンポーネントはVitestのBrowser Modeで実ブラウザを使って確認できる。

### Cloudflare連携のバージョンに注意

調査時点のnpmのメタデータは次のとおり。

| パッケージ | 確認したバージョン・条件 |
| --- | --- |
| Vitestの最新版 | `5.0.0` |
| `@cloudflare/vitest-plugin`の最新版 | `1.1.9` |
| 同プラグインが要求するVitest | `^4.1.0` |
| 同プラグインが要求する`@vitest/runner`・`@vitest/snapshot` | それぞれ`^4.1.0` |

Cloudflareの導入ガイドも`vitest@^4.1.0`を案内している。
現在導入するなら、Cloudflare連携に合わせてVitest 4.1系を評価する。最新版のVitest 5をそのまま組み合わせると、要求バージョンの範囲から外れる。
古い記事では`@cloudflare/vitest-pool-workers`が紹介されているため、実装時は現行の公式ガイドを参照する。

### 比較する候補

| 候補 | このプロジェクトでの用途 | 確認したい点 |
| --- | --- | --- |
| Vitest | 抽選などの処理、Reactのコンポーネント、Workers・DOのテスト | Cloudflare連携との対応バージョン、Bunからの起動と実行環境の互換性 |
| Bunの組み込みテスト | Bun上で動く処理や、外部環境に依存しない関数のテスト | Bunの実行結果だけではWorkers固有のAPIやDOの動作を確認できない |
| Playwright | ログインから題材選択・通知まで、ブラウザでの一連の操作 | ブラウザの導入と起動が必要。機能ができた段階で追加を検討する |

BunのテストランナーはTypeScript・JSXやDOMテストに対応しており、Reactにも使える。Jest互換を目指しているが、完全互換ではないと公式に明記されている。
Bunをパッケージ管理と開発用ランタイムに使うことは、テストランナーもBunに統一する理由にはならない。

`bun test`はBun自身のテストランナーを起動する。Vitestを採用した場合は、Vitestを呼ぶスクリプトなどから実行する。
Hibernationの実際の休止や稼働量は、テストランナー上の確認に加えてCloudflareへのデプロイ後にも確認する。

## リンター・フォーマッター

### Viteの標準テンプレートには変化がある

今回使用した`create-vite@9.2.1`のReact + TypeScriptテンプレートには、`oxlint`と`lint`スクリプトが含まれていた。
CLIにも、ReactテンプレートでOxlintの代わりにESLintを選ぶ`--eslint`オプションがある。
今回はツールの選定を保留しているため、生成されたOxlintの依存と`lint`スクリプトを取り除いた。

Vite+もリンターにOxlint、フォーマッターにOxfmtを使用している。Vite周辺でOxcのツールが採用されていることは確認できる。
一方、Biomeも2026年6月に2.5を公開し、ルールや機能を追加している。「Biomeが使われなくなった」とは判断できない。

### 比較

| 候補 | 特徴 | このプロジェクトで検討する点 |
| --- | --- | --- |
| Biome | リントと整形を1つのツール・設定にまとめられる。React・TypeScript・CSS・JSONを扱える | 初期構成を小さく保ちやすい。必要なルールと整形対象が揃うか確認する |
| Oxlint + Oxfmt | Vite周辺で採用が進む組み合わせ。OxlintにはReactなどのルールと型情報を使う検査がある | Oxfmtがまだ安定版1.0前であることを受け入れるか |
| Oxlint + Prettier | Oxlintを使いつつ、整形はPrettierに任せる | Oxfmtの安定化を待つ場合の候補。設定は2つのツールで管理する |
| ESLint + Prettier | 既存のプラグインや設定例が豊富 | 特定のESLintプラグインが必要な場合に検討する |

速度については各ツールがベンチマークを公開しているが、今回の小規模なアプリでは、必要な検査・設定の数・安定性を優先して選ぶ。

### OxlintとOxfmtの安定性は別に確認する

- Oxlintは2025年6月に1.0を公開している。
- Oxfmtは2026年2月にBetaを発表した。調査時点のnpmの最新版は`0.68.0`で、1.0には達していない。
- OxfmtはPrettier互換の整形を目指し、多数の形式に対応している。
- OxlintのJavaScriptプラグイン互換機能にはalphaの扱いが残る。既存のESLintプラグインを使う場合は個別に確認する。
- Biomeのnpmの最新版は調査時点で`2.5.13`。

## 採用案

- **テスト：Vitestを第一候補とする。** Workers・DOの公式連携に合わせて対応バージョンを選び、画面全体の確認が必要になった段階でPlaywrightを検討する。
- **リント・整形：構成をまとめるならBiome、Vite周辺の採用に合わせるならOxlint + Oxfmtを候補とする。** OxfmtのBetaを避けたい場合はOxlint + Prettierも比較する。
- テストや整形のスクリプトは、ツールを選んだ段階で必要なものだけ追加する。

## 参考資料

- [Cloudflare：Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare：Write your first test](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [Vitest：Browser Mode](https://vitest.dev/guide/browser/)
- [Bun：Test runner](https://bun.com/docs/test)
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
