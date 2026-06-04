# Refresh Search Patterns

Concrete search queries for the 6 refresh angles defined in the researcher skill.

## 1. 公式フォローアップ (Official Follow-up)

Check the organization's blog/newsroom for new announcements since the last research date.

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

## 4. 競合リアクション (Competitor Reaction)

```
web_search(query="React <topic> comparison analysis 2026")
web_search(query="React vs <competitor> 2026")
```

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

# Version detection — try version range pattern when exact version unknown
web_search(query="ProductName v1.3.12 OR 1.3.13 OR 1.3.14 June 2026")
```

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
4. Accept that some detail (full changelog text) may be unreachable and report that honestly
