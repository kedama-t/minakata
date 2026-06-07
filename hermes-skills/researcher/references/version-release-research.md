# バージョン付きソフトウェアリリースの調査（Versioned Release Research）

## 概要

フレームワーク・ライブラリ・ツールの新バージョンがリリースされた際、単一の公式ブログ記事だけでなく、パッチ履歴・セキュリティ修正・先行 canary 開発の全容を調べるための多角的調査パターン。

## 情報源の階層

research / daily_research タスクで「Product X vN.M のアップデート」が主題の場合、以下の情報源を段階的に並列調査する：

| 階層 | 情報源 | 得られるもの | クエリ例 |
|------|--------|------------|---------|
| 1st | 公式リリースブログ | 主要新機能・ハイライト・パフォーマンス数値 | `site:product.dev/blog vN.M release` |
| 2nd | GitHub Releases | 全コミットログ・バグ修正一覧・コントリビューター | `site:github.com/org/repo releases` |
| 3rd | アグリゲーター（Releasebot 等） | パッチ履歴の一覧・時系列・セキュリティ修正の種別 | `releasebot.io/updates/vendor/product` |
| 4th | Canary/Changelog アグリゲーター | 次期バージョンの先行動向 | `next-changelog.vercel.app` / `npmx.dev` |
| 5th | セキュリティアドバイザリ | CVE 一覧・CVSS スコア・影響バージョン | `site:vercel.com/changelog security` |
| 6th | 二次分析・メディア | 実測ベンチマーク・移行体験談 | `"Product X" vN.M benchmark OR review OR comparison` |

## 段階的検索手順

### フェーズ 1: 公式一次情報の取得（並列）

- 公式ブログを検索（`site:product.dev/blog vN.M`）
- GitHub Releases ページを検索（`site:github.com/org/repo release vN.M`）
- 両方を同時に `web_search` + `browser_navigate` で抽出

### フェーズ 2: パッチ履歴の全体像

アグリゲーターサイト（releasebot.io 等）は複数回のパッチリリースを時系列で一覧化している。以下の観点でスキャンする：

- **最新パッチバージョン**（例: v16.2.7）の日付と内容
- **セキュリティリリース**（例: v16.2.6）のアドバイザリ一覧と深刻度
- **各パッチの主要修正カテゴリ**（バグフィックス / セキュリティ / パフォーマンス）
- **パッチ間の期間**（リリース頻度の把握）

**テクニック**: `browser_navigate` でアグリゲーターページを開き、`browser_console` の `document.body.innerText` で全テキストを取得する。多くのアグリゲーターは "Show more" 展開が必要な場合があるため、`browser_scroll(down)` で画面をスクロールしてから innerText を取得するとより多くのデータが得られる。

### フェーズ 3: Canary / Pre-release の先行動向

安定版リリース以降の canary ブランチでは次のメジャーバージョンの機能が先行開発されている。

- **Changelog アグリゲーター**: `next-changelog.vercel.app` は stable / canary のリリースをフィルタリングできる
- **npmx.dev**: `npmx.dev/package-changelog/pkg/vN.M-canary.N` で特定の canary バージョンの変更履歴を確認
- **Dev Brief / 週刊まとめ**: 業界週刊ニュースサイトで canary の主要変更が要約されていることがある
- **検索クエリ例**: `"product" canary "streaming" OR "experimental" <年>` または `"product" "N.M.0-canary"`

**チェックすべき事項**:
- 新機能（Streaming Prerender, Instant Navs, 新しい experimental フラグなど）
- アーキテクチャ変更（キャッシュ統合、コード整理）
- 安定化された機能（experimental → stable への昇格）

### フェーズ 4: セキュリティ修正の詳細

vN.M 未満のバージョンに影響する脆弱性が同時に公開されることがある。

- **ベンダーチャンネル**: `vercel.com/changelog`, `github.com/org/advisories`
- **NVD**: `nvd.nist.gov/vuln/detail/CVE-YYYY-XXXXX`
- **第三者分析**: Strapi, Cloudflare 等のブログで詳細な影響分析が公開されることがある

**記事に含めるべき情報**: CVE 番号、脆弱性タイプ、CVSS スコア、影響を受けるバージョン範囲、修正バージョン。表形式で一覧化するのが効果的。

### フェーズ 5: タイムラインの統合

収集したすべてのパッチを時系列テーブルに整理する：

```markdown
| バージョン | 日付 | 主な内容 |
|-----------|------|---------|
| N.M.0 | YYYY-MM-DD | 初回リリース（主要新機能） |
| N.M.1 | YYYY-MM-DD | バグフィックス（項目を列挙） |
| N.M.2 | YYYY-MM-DD | 機能改善 + バグ修正 |
| N.M.3 | YYYY-MM-DD | セキュリティ修正（該当 CVE 数） |
```

## `browser_navigate` が公式ブログを取得できるかの事前判断

多くの公式ブログ（nextjs.org, vercel.com 等）は web_extract（scraper）をブロックするが、`browser_navigate` は通過できる。以下の優先順位で試行する：

1. **web_extract** → 失敗したら即座に browser_navigate へ
2. **browser_navigate** → `browser_console({ expression: "document.body.innerText" })` で全文取得。ただし一部のページ（特に SPA 系）は innerText が空になる場合がある。その場合は `browser_snapshot(full=true)` のテキストで我慢するか、別ページで代替する
3. **ブラウザも通らない場合** → `web_search` のスニペット多段階検索（researcher skill § web_extractエラー時の対応）

## エッジケース

- **`browser_console(document.body.innerText)` が空文字列を返す**: ページが Shadow DOM や CSR でレンダリングされている可能性。`browser_snapshot(full=true)` または `browser_console("document.querySelector('article')?.innerText")` を試す
- **アグリゲーターの "Show more" 折りたたみ**: `browser_click` で展開してから `browser_scroll` + innerText 取得
- **GitHub Releases ページの分割**: 古いリリースは「Older releases」リンクの先にある。`site:` 検索でバージョン指定（`vN.M.0`、`vN.M.7` 等）で個別にアクセス
