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
