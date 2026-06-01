# Comparison Research Pattern

複数のツール・ライブラリ・サービスを比較する `research` タスク向けの検索パターン。

## いつ使うか

ペイロードの `goal` や `query` が複数の対象を列挙している場合（例：「Tailwind CSS vs Bootstrap vs MUI」「AWS vs GCP vs Azure」「React vs Vue vs Svelte」など）。

## 二段階検索戦略

### フェーズ1: 個別対象の一次情報収集（並列）

各対象に対して独立した検索クエリを同時に投げる：

```
web_search(query="<対象A> official site documentation 2026")
web_search(query="<対象B> latest features release")
web_search(query="<対象C> documentation changelog")
...
```

**目的**: 公式サイト・GitHubリポジトリ・最新リリースノートを各対象について漏れなく取得する。二次情報に頼らず、各対象の正確な現状を把握する。

**件数**: 対象数だけ並列検索（上限は tool 制限による）。5 対象なら 5 並列で問題ない。

### フェーズ2: 横断比較データの収集（並列）

以下の角度から横断的な検索を追加で投げる：

```
web_search(query="<対象A> vs <対象B> vs <対象C> comparison 2026")
web_search(query="<対象A/B/C> popularity GitHub stars npm downloads 2026")
web_search(query="best <カテゴリ名> 2026 ranking")
```

**目的**: 比較表に必要な横断データ（GitHub Stars、npm DL数、市場シェア、開発者満足度）を取得する。

### 情報抽出順序

1. **公式ソースを優先**: 各対象の公式サイト・ブログ・リリースノートを `web_extract` に最大5URLまでまとめる
2. **比較記事で補完**: 上記抽出で不足したデータ（市場統計、コミュニティ評価）を比較記事・ランキング記事から補完
3. **クロスチェック**: `web_extract` の内容切り詰め（5000文字要約）により欠落した数値・日付は、別ソースと突き合わせて検証する

### 記事構成のヒント

以下のテンプレートが比較系記事で有効：

```
# タイトル：<カテゴリ>比較ガイド<年>

## 概要
## 各対象の詳細（対象ごとにサブセクション）
## 比較表（表形式: 項目×対象のマトリクス）
## 選び方ガイド（ユースケース別推奨）
## 評価・分析（ポジティブ/批判的の両面）
## 出典一覧
```

比較表は縦軸に比較項目、横軸に対象を並べる形式が最も読みやすい。
