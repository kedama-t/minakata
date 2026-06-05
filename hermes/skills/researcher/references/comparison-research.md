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

## Refresh / Update of Comparison Articles

既存の比較記事を refresh する場合、新規調査とは異なるパターンが必要。以下の手順で並列検索する：

### フェーズ1: 個別対象のバージョンチェック（並列）

記事内で言及されている各ライブラリ・ツールについて、最新バージョンと新機能を確認する：

```typescript
// 対象ごとに同時実行（上限まで並列可能）
web_search(query: "<libraryA> new version release <年月>")
web_search(query: "<libraryB> new version release <年月>")
web_search(query: "<libraryC> changelog latest 2026")
// ...
```

**目的**: 記事内の各セクションに「更新すべき内容」（新バージョン・新機能・メンテ終了など）がないか確認する。

### フェーズ2: エコシステム全体の新規参入者スキャン（並列）

前回調査以降に登場した**新しい競合・代替品**を確認する。これはフェーズ1と並列実行可能：

```typescript
// カテゴリ全体の新しい選択肢
web_search(query: "new <category> library tool 2026")
web_search(query: "best <category> 2026")
web_search(query: "<category> comparison 2026")

// 特定スタイル/パラダイムの新参
web_search(query: "<style-keyword> library component 2026")
```

**例**: 本セッションでは `cute-pop-ui-libraries-2026` の refresh 時に `web_search(query: "neobrutalism OR cute UI OR pop UI component library 2026 new")` を投げ、記事未収録の **Neobrutal UI** を発見した。

### フェーズ3: 既存記事内の「見落とし」の検出

元記事作成時より**前**に存在していたが、初回調査でカバーされていなかった機能・リリース・企業イベントを確認する。特に以下の観点：

- 各ライブラリの CHANGELOG で、元記事作成日より前（かつ記事で未言及）の重要な新機能
- 元記事で比較対象として挙げられていなかった既存の競合
- 開発元の経営状況・ビジネスイベント（レイオフ・買収・資金調達）で元記事から省略されたもの

発見した内容は元記事の該当セクションに追記するか、新規セクションとして追加する。

### フェーズ4: 比較表の更新

- 発見した新バージョン番号で該当行を更新
- **新規参入ライブラリ**の行を追加（対応状況・特徴・v4互換性など）
- メンテ終了・非推奨になったライブラリのステータスを更新
- 結論/おすすめ表も忘れずに更新

### フェーズ5: クロスチェック

複数ソースで数値（GitHub Stars、npm DL数）や日付（最新リリース日）を確認する。適宜 `browser_navigate` で GitHub リリースページや公式サイトを直接確認する。

### 注意点

- **変更率**: 比較記事は通常本文が長く、各対象への小さな追記の合計でも変更率が 30% を超えにくい。ただし「新規ライブラリを 1 セクション追加」は比較的大きな変更量になるため、`update_article` 後は `status` を確認する（`pending_approval` でも正常フロー）。
- **検索クエリ設計**: `site:github.com/.../releases` + date フィルタは多くの場合空を返す。`"<library>" version release <年月>` のシンプルなクエリの方が確実。`browser_navigate` で GitHub Releases ページを直接確認するのが最も信頼できる。
- **新規参入の判断**: 記事内に言及されていなかった既存ライブラリであっても、それが「元記事作成時点で存在していたが調査漏れ」なのか「元記事作成後に登場した新規参入」なのかを区別する。後者は**追記モチベーションが強い**（新鮮な情報の追加）。前者は重要度に応じて取捨選択する。
