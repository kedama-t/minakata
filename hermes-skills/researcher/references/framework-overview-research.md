# Framework / Tool Overview Research (Knowledge Graph Gap-Filling)

`dedup_key` プレフィックスが `gap:` のタスク、または既存記事から参照されているが専用記事がないトピックの調査パターン。このような「ナレッジグラフの穴埋め」調査では、既存の参照記事の文脈を理解した上で、適切な深さと構成で新規記事を作成する。

## ワークフロー

### Phase 1: コンテキスト把握
1. **fulltext_search** + **by_tag** の両方で重複確認（片方だけでは不十分）
2. ヒットした関連記事を `read_article` で読み、どのような文脈で対象トピックが参照されているか把握する
3. 既存記事が比較記事・俯瞰記事の場合、対象トピックにどのような深さのセクションが割かれているか確認
4. 既存記事が直近（数日以内）かつ内容が新鮮で、追記すると変更率が 30% を超えるリスクがあれば、新規記事として独立させる判断を優先

### Phase 2: 多角検索戦略

以下の角度から並列検索する（4〜6本同時が目安）：

| 角度 | クエリ例 | 情報源 |
|------|---------|--------|
| 公式サイト | `<framework> official site` | 一次情報 |
| 最新版リリースノート | `<framework> <latest_version> release notes` | 一次情報 |
| アーキテクチャ解説 | `<framework> architecture pattern explained` | 技術解説記事 |
| エコシステムスコア | `<framework> ecosystem scorecard <year>` | Uvik / 業界レポート |
| GitHub Stars ランキング | `top backend frameworks github stars <year>` | LinkedIn / Reddit 投稿 |
| コミュニティ評価 | `<framework> <year> still relevant` | Reddit / Hacker News |
| 競合比較 | `<framework> vs <competitor> <year>` | 比較記事 |

### Phase 3: 統計データの収集元

`web_extract` が利用不可の場合、以下のソースからスニペットベースで断片的な数値を収集する：

| データ | 検索戦略 |
|--------|---------|
| GitHub Stars | `"<framework>" "stars" "GitHub" <current_year>` → LinkedIn 投稿 (例: "Top Backend Frameworks by GitHub Stars in 2026") が信頼できる。投稿日が直近か確認 |
| エコシステムスコア | `"<category>" "ecosystem scorecard" <year>` → Uvik のスコアカード記事 |
| 開発者採用率 | `"<framework>" "JetBrains" "developer survey" <year>` → JetBrains 年次調査 |
| PyPI 月間DL | `"<package>" "PyPI" "downloads"` → ただしスニペットに数値が出にくい。代替として `"top <category> packages by PyPI downloads"` |
| 最新バージョン | `"<framework>" "<major_version>" "release" <year>` |
| セキュリティアップデート | `"<framework>" "security" "release" <date>` → 公式ブログ + forum のスニペットが最も信頼できる |

### Phase 4: 公式ドキュメント抽出

`web_extract` が利用不可の場合、公式リリースノートは `browser_navigate` → `browser_console` で全文取得を試みる（詳細は `references/documentation-extraction.md`）。

ドキュメントを完全に取得できた場合のメリット:
- 変更履歴・deprecation・後方非互換の完全な一覧が得られる
- コード例が含まれていればそのまま記事で使用できる
- リリース日付・バージョン番号が正確

### Phase 5: 記事構成

ギャップフィリング記事は以下の構成が効果的（シニアエンジニア向け）:

1. **概要** — トピックのポジション（Stars, スコア, 略史）
2. **開発の経緯 / タイムライン** — 主要バージョンのマイルストーン表
3. **コアアーキテクチャ** — 設計パターン・コンポーネント図・リクエストフロー
4. **主要機能の詳細** — コード例付き（公式ドキュメントから抽出）
5. **エコシステム** — 主要パッケージ・ライブラリの一覧表
6. **最新版の新機能** — 注目機能 + 細かい改善 + セキュリティアップデート
7. **比較・対比** — 競合との表形式比較（GitHub Stars・エコシステムスコア・主要機能の有無）
8. **選ぶべき/選ぶべきでないシナリオ** — 具体的な判断基準
9. **批判的評価** — 肯定的評価と批判的評価の両面
10. **出典一覧** — URL + 取得日

## 実例: Django 概要記事（2026年6月）

- **トリガー**: `dedup_key: "gap:django:2026-06-05"` — gap_detector が Python Web フレームワークエコシステム記事から Django が参照されていることを検出
- **Phase 1**: FastAPI・Flask・エコシステム比較記事を読んで Django の参照箇所を確認（GitHub Stars比較・エコシステムスコア・選び方ガイドでの言及）
- **Phase 2**: 公式サイト + Django 6.0 リリースノート + MVTアーキテクチャ解説 + Redditコミュニティ評価 + GitHub Starsランキング を並列検索
- **Phase 3**: LinkedIn 投稿から GitHub Stars 87.4k を取得。Uvik スコアカードから 4.4/5 を取得
- **Phase 4**: Django 6.0 リリースノートを browser_navigate → article セレクタ + 2分割抽出で全文取得
- **Phase 5**: 上記構成に従い 17 出典の包括的記事を作成
