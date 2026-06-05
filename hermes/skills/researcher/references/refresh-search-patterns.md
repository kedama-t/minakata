# Refresh Search Patterns

Concrete search queries for the 6 refresh angles defined in the researcher skill.

## 1. 公式フォローアップ (Official Follow-up)

Check the organization's blog/newsroom for new announcements since the last research date.

### マルチアングル並列検索パターン

Refresh の最初の一歩として、以下の **5 角度からの並列 web_search** を同時実行するとカバレッジが確保できる：

```typescript
// 角度1: 公式サイト内の新着ニュース
web_search(query: "site:<org-domain>/news after:<date>")

// 角度2: 特定パッケージの更新（npm/GitHub リリース）
web_search(query: "<package-name> release update <年月>")

// 角度3: フレームワーク/プロダクト本体の新バージョン
web_search(query: "<product> new version release <年月>")

// 角度4: エコシステム技術の進化（関連技術の更新も確認）
web_search(query: "<ecosystem> update <年月>")

// 角度5: コミュニティ全般の話題
web_search(query: "<product> <topic> news <年月>")
```

これにより、単一クエリでは見逃しやすい角度を並列でカバーできる。5 結果中 4 結果が空でも、残り 1 件で重要な更新を発見できるなら十分に価値がある。

### シングルクエリパターン

```
# React — check official blog
web_search(query="site:react.dev/blog 2026")

# GitHub releases page (date-filtered queries often return empty; use simple query instead)
web_search(query="github.com/facebook/react/releases 19.2")
web_search(query="github.com/facebook/react/releases 19.3")

# GitHub releases — check multiple releases at once via version range pattern
web_search(query="React 19.2.7 OR 19.2.8 OR "19.3" release changelog 2026")

# npm — check latest published version
web_search(query="react latest version npm June 2026")

# Official blog with domain-specific site: query
web_search(query="site:<org-domain>/blog after:<date>")
```

⚠️ **Gotcha**: `site:github.com/facebook/react/releases after:2026-05-31` often returns **empty** because GitHub release pages don't have structured date metadata that search engines index well. Use a simpler query like `github.com/facebook/react/releases 19.2` instead.

## 2. コミュニティフィードバック (Community Feedback)

```
# Reddit — recent discussions
web_search(query="React <topic> Reddit 2026")

# Hacker News
web_search(query="React <topic> site:news.ycombinator.com 2026")

# General community sentiment
web_search(query="React ecosystem community reaction <topic> 2026")
```

## 3. プラットフォーム拡大 (Platform Expansion)

```
web_search(query="React <product> new platform support 2026")
web_search(query="React <product> available on <platform> 2026")
```

## 4. 競合リアクション / 独立競合リリース (Competitor Reaction & Independent Releases)

比較・展望系の記事を refresh する場合、元記事の対象とは**独立した競合の新規リリース**も確認する。これは「リアクション」ではなく、競合製品が独自にリリースした新バージョンを指す。

```
# 競合の直接的な応答・リアクション
web_search(query="<topic> vs <competitor> comparison 2026")
web_search(query="<competitor> response to <topic> 2026")

# 競合の独立リリーススキャン（比較表を最新に保つため）
web_search(query="<competitor-name> release <年月>")
web_search(query="<competitor-name> announcement benchmark 2026")
web_search(query="<competitor-name> new version features changelog 2026")
```

**使い分け**: 「競合のリアクション」は元記事の発表に対する競合の応答記事。 refresh の文脈では、元記事の対象がリリースされたことへの反応を探る。「独立競合リリース」は競合が独自にリリースした新バージョンのスキャンであり、比較表の客観的な更新に必須。

## 5. ポストローンチ分析 (Post-launch Analysis)

```
web_search(query="React <product> review analysis deep dive 2026")
web_search(query="React <product> performance benchmark 2026")
```

## 6. エコシステム全体の動向 (Ecosystem Trend)

```
# Best-of/category surveys
web_search(query="best <category> 2026")
web_search(query="<category> comparison 2026")

# Business events
web_search(query="<company> funding OR acquisition OR layoff OR revenue 2026")

# New entrants
web_search(query="new React library tool framework 2026")

# Tooling & integration maturity — official SDKs, monitoring, cloud adapters
# Useful when refreshing framework/library comparison articles: check if any
# product gained a stable SDK from a major observability platform since last research.
web_search(query="<product> Sentry OR Datadog OR OpenTelemetry SDK stable 2026")
web_search(query="<product> official <cloud-provider> adapter integration 2026")

# Version detection — try version range pattern when exact version unknown
web_search(query="ProductName v1.3.12 OR 1.3.13 OR 1.3.14 June 2026")
```

**Tooling/integration maturity example**: When refreshing a framework comparison article (e.g. Hono vs Express vs Fastify), search for `web_search(query="Hono Sentry SDK stable 2026")`. A stable monitoring SDK signals production readiness and can meaningfully change the comparison's "production-readiness" assessment. This is distinct from "new entrants" (competing libraries) — it's about the ecosystem _surrounding_ a product maturing.

## Version Discovery Pattern

For refresh tasks, the most common need is **"did a new version ship?"** The following pattern works for most npm/GitHub-hosted projects:

```
# Simple approach (works best)
web_search(query="<product> <last-known-version-or-higher> release 2026")

# For searching across a range
web_search(query="<product> 1.3.12 OR 1.3.13 OR 1.3.14")
```

When a project publishes release notes on Medium or dev.to, those articles are usually indexed faster than GitHub release pages. Check these as supplementary sources.

## Scraper-down Workflow

When `web_extract` returns `Unauthorized: Invalid token` (Minakata scraper unavailable):

1. **Do not retry** — it's a server-level outage, not a transient failure
2. Use targeted `web_search` queries to gather facts from search snippets
3. Cross-check version numbers and dates across multiple snippets
4. When web_search finds the right URL (e.g. a GitHub releases page, npm page, or Zenn article) but web_extract can't read it, use `browser_navigate` directly — structured content like release notes and changelogs renders well in browser snapshots and is far more detailed than search snippets alone
   - **適用条件**: browser_navigate should only be used for **known-target, structured-content pages** that search already identified (GitHub releases, npm pages, documentation sites). Do NOT use it as a general web exploration tool — the primary search/recall job is still web_search's role
5. Accept that some detail may still be unreachable and report that honestly

### 並列検索 + ブラウザフォールバックの workflow パターン

```typescript
// === フェーズ1: 五角度並列検索（同時実行） ===
// 1. 公式ニュース
web_search(query: "site:<product-domain>/news after:<date>")
// 2. 特定パッケージの更新
web_search(query: "<package-name> release update <年月>")
// 3. フレームワーク本体の新バージョン
web_search(query: "<product> new version release <年月>")
// 4. エコシステム技術
web_search(query: "<ecosystem-tech> update <年月>")
// 5. コミュニティ全般
web_search(query: "<product> <topic> news <年月>")

// === フェーズ1.5: 検索結果のURLを特定 ===
// GitHub releases / npm / ドキュメントページが見つかった場合 → browser_navigate で直接取得
// web_extract が "Unauthorized" を返す場合は browser で読む

// === フェーズ2: ブラウザで構造化データを読む ===
browser_navigate(url: "<identified-release-page-url>")
// browser_snapshot でリリースノート全文（バージョン・変更内容・日付）を取得

// === フェーズ3: フォローアップ検索 ===
web_search(query: "<product> <feature> release <年月>")
web_search(query: "npm <package-name> version latest <年月>")

// === 競合スキャン（比較記事のrefresh時） ===
web_search(query: "<competitor-name> release <年月> new version")
web_search(query: "<competitor-name> new version release <年月>")
```

## GitHub の Markdown ファイル（CHANGELOG, README 等）のブラウザ抽出テクニック

GitHub でホストされている Markdown ベースのドキュメント（CHANGELOG.md, README.md, リリースノート等）は `web_extract` で `Unauthorized` になることが多いが、`browser_navigate` + `browser_console` で確実に全文取得できる。

### 推奨パターン

```typescript
// 1. ページを開く
browser_navigate(url: "https://github.com/<org>/<repo>/blob/master/CHANGELOG.md")

// 2. browser_snapshot で内容を一読（ただし長いファイルは8000文字で切り詰められる）

// 3. browser_console で DOM から全文抽出
//    GitHub はレンダリング済み Markdown を <article> 要素内に配置する
browser_console({
  expression: "document.querySelector('article').innerText.substring(0, 5000)"
})
```

**この手法が有効な理由**:
- GitHub はサーバサイドで Markdown → HTML にレンダリング済みのページを返すため、`document.querySelector('article')` で確実に本文が取得できる
- `document.body.innerText` よりノイズが少ない（GitHub のナビゲーション・UI 要素を含まない）
- `substring(0, N)` で長さ制限を突破できる（browser_console の戻り値にもサイズ制限はあるが snapshot よりはるかに大きい）
- 5000文字〜10万文字の CHANGELOG でも問題なく全文をチャンク分割して取得可能

**代替セレクタ**: 一部のページでは `article` が存在しない場合がある。その場合は `document.querySelector('.markdown-body')?.innerText` や `document.querySelector('[data-testid="readme"]')?.innerText` を試す。

## 7. インダストリースコアカード・アナリストレポート (Industry Scorecard Cross-Reference)

フレームワーク・ライブラリ・ツールの比較記事や俯瞰記事の refresh 時、独立した業界エコシステムスコアカードが元記事で未参照だった場合、第三者評価レイヤーを追加できる。

```
# 汎用パターン
web_search(query="<category> ecosystem scorecard <year>")
web_search(query="<category> comparison ranking <year>")
web_search(query="<category> <product> rating score 2026")
```

**実例（Flask refresh, 2026年6月）**:

```typescript
// スコアカード発見
web_search(query: "python ecosystem scorecard 2026")
// → Uvik Python Ecosystem Scorecard 2026 (April/May 2026) を発見
// Flask 2.5/5 (Specialist), FastAPI 4.5 (Foundational), Django 4.4 (Foundational)

// スコアカード内の決定木も有用な追記材料に
web_search(query: "Python framework decision tree 2026")
```

**注意点**:
- ベンダーが自社製品の優位性を示すために公開したレポートはバイアスがかかっている可能性がある。Uvik Scorecard のように透明な方法論を公開しているものを優先する
- スコアカードは publish 日時を確認し、元記事より**後**に公開または更新されたものだけが真の追記価値を持つ。元記事作成前に存在したスコアカードを追記する場合は、元記事がなぜ参照しなかったかを考慮する
- スコアカードの数値（スコア・ランキング）だけをコピーせず、評価の根拠・文脈も合わせて記述する

## 8. GitHub Milestone 進捗確認 (GitHub Milestone Progress)

オープンソースプロジェクトの場合、次期バージョンの進捗状況を GitHub milestone から取得する。フレームワーク自身に新リリースがなくても、マイルストーン進捗率は記事の「今後の展望」セクションを具体化できる。

```
# リポジトリの milestone を発見
web_search(query="github.com/<org>/<repo>/milestone <version>")

# 直接アクセス（推奨）
browser_navigate(url: "https://github.com/<org>/<repo>/milestone/<number>")
```

**実例（Flask 3.2.0 refresh, 2026年6月）**:

```typescript
// milestone ページを開く
browser_navigate(url: "https://github.com/pallets/flask/milestone/37")

// browser_snapshot から以下を抽出:
// - 進捗率: "94% complete"
// - 未解決: "Open (1)" 残 project
// - 最終更新: "last month"
// - Open issue #5918: "automatic options as separate route" (Feb 12, 2026)
// - Closed issues: 17件
```

**抽出するデータ**: 進捗率（%）・未解決 issue 数とその概要・最終更新日・クローズ済み issue 数。これらを記事の「今後の展望」セクションに追記することで、単なる「リリース日未定」から「94% 完了（1 issue 残）」と具体化できる。

## 9. コア依存ライブラリの更新監査 (Core Dependency Changelog Audit)

フレームワーク自身に新バージョンがなくても、その中核依存ライブラリにセキュリティパッチや改善が蓄積されていることがある。特に refresh タスクでは、元記事の「コア技術」セクションに記載された依存ライブラリを個別にチェックする。

```
# 依存ライブラリの changelog
web_search(query="site:<dependency-domain>/changes/")
web_search(query="github.com/<org>/<dependency>/releases")
web_search(query="<dependency-name> <version> changelog 2026")
```

### 9a. 依存ライブラリの CVE スキャン (Dependency CVE Scan)

依存ライブラリの changelog 確認に加え、**当該依存ライブラリに新たな CVE が公開されていないか**を明示的に検索する。フレームワーク本体に更新がなくても、コア依存に CVE が存在すれば記事読者にとって重要なセキュリティアラートとなる。これは記事作成後 1 週間以内の refresh でも価値がある（作成直前に公開された CVE が記事に未収録のままである可能性が高い）。

```
# パターンA: CVE ID 直接検索（CVE 番号が既知の場合）
web_search(query="CVE-YYYY-XXXXX <dependency-name>")

# パターンB: 汎用 CVE スキャン（番号未定、期間指定）
web_search(query="<dependency-name> CVE security advisory <year>")
web_search(query="<dependency-name> vulnerability <year>")

# パターンC: セキュリティ監査レポート（最近の監査結果）
web_search(query="<dependency-name> security audit OSTIF <year>")
web_search(query="<dependency-name> X41 D-Sec OR Ada Logics OR Trail of Bits")
```

**発見した CVE の記事への反映**: 発見した CVE が記事の対象読者に影響する場合、以下の情報を構造化して新しい「セキュリティ注意喚起」サブセクションに追記する：
- CVE ID と別名（例: CVE-2026-48710 / BadHost）
- CVSS スコアと影響範囲
- 影響するバージョン範囲と修正バージョン
- 対策手順（具体的なアップグレードコマンド）
- 出典（NVD, ベンダーアドバイザリ, 検証済みメディア）

**実例（FastAPI refresh, 2026年6月: Starlette CVE-2026-48710 の発見）**:

```typescript
// FastAPI の refresh タスク。Starlette の CVE を検索
web_search({ query: "Starlette CVE security advisory 2026" })
// → CVE-2026-48710 (BadHost) を発見
// Starlette 1.0.1 未満の全バージョンに影響
// Host ヘッダ未検証により request.url ベースのセキュリティ制限がバイパス可能
// CVSS 3.1: 6.5 MEDIUM

// NVD 詳細をブラウザで取得（web_extract がブロックされるため fallback）
browser_navigate({ url: "https://nvd.nist.gov/vuln/detail/CVE-2026-48710" })

// 技術メディアの記事で深掘り情報を補完
browser_navigate({ url: "https://iototsecnews.jp/2026/05/27/badhost-vulnerability-exposes-sensitive-ai-agent-server-endpoints-to-attackers/" })
```

**実例（Flask refresh, 2026年6月: Werkzeug と Click のチェック）**:

```typescript
// Flask の中核依存 Werkzeug の changelog を確認
browser_navigate(url: "https://werkzeug.palletsprojects.com/en/stable/changes/")

// Werkzeug 3.1.5 (2026-01-08) → 3.1.8 (2026-04-02) の間に複数のセキュリティ修正:
// - 3.1.8: Request.host/get_host のバリデーション強化
// - 3.1.6: safe_join の Windows パス脆弱性修正
// - 3.1.5: safe_join の追加修正

// Click の changelog も確認
web_search(query: "site:click.palletsprojects.com/en/stable/changes/")
// Click 8.3.3 (2026-04-20): shell=True 除去によるサブプロセスセキュリティ改善
```

**記事への反映方法**:
- 開発の経緯セクションに「コア依存ライブラリの更新状況」サブセクションを追加
- バージョン・リリース日・主な変更点（特にセキュリティ修正）を表形式で整理
- ユーザーにとっての実質的な影響（「Flask を更新しなくても pip install --upgrade werkzeug でセキュリティ改善を得られる」等）を付記する
