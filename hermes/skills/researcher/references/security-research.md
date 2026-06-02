# Security & Vulnerability News Research Pattern

ゼロデイ攻撃・CVE・脆弱性インシデントを扱う `daily_research` または `research` タスク向けの検索パターン。トピックの性質上、一次情報のバリデーションと時系列の正確性が特に重要。

## いつ使うか

ペイロードに以下のシグナルが含まれる場合:
- キーワード: `ゼロデイ`, `CVE`, `脆弱性`, `vulnerability`, `exploit`, `security advisory`, `zero-day`
- `payload.keywords` がセキュリティ分野の用語を含む（例: `["ゼロデイ攻撃", "CVE"]`）
- 購読トピック名がセキュリティ関連（例: 「Webアプリケーション関連のセキュリティニュース」）

## 一次情報の信頼性階層

セキュリティニュースでは情報の誤伝播・誇張が頻発するため、以下の優先順位でソースを扱う:

| 優先度 | ソース種別 | 例 |
|--------|-----------|-----|
| **1 (最高)** | CISA KEV カタログ | `cisa.gov/known-exploited-vulnerabilities-catalog` |
| **1 (最高)** | ベンダー公式セキュリティアドバイザリ | MSRC, Google Project Zero, F5 Security Advisory, Apache mailing list |
| **2** | NVD (National Vulnerability Database) | `nvd.nist.gov/vuln/detail/CVE-XXXX-XXXXX` |
| **3** | 検証済みセキュリティメディア | Malwarebytes, BleepingComputer, The Hacker News |
| **4** | 一般技術ニュース | 窓の杜, ITmedia, MyNavi, Forbes JAPAN |
| **5 (最低)** | 一次情報なしの二次ブログ・Qiita・個人記事 | 出典不明のまとめ記事は**使用しない** |

**ルール**: CISA KEV > ベンダーアドバイザリ > NVD > 検証済みメディア の順に抽出し、遡って検証する。CISA KEV に記載があれば「実環境での悪用が確認された」と断言できる。ベンダーアドバイザリのみの場合は「悪用は未確認」と注釈する。

## 検索クエリ構築パターン

### パターン1: バイリンガル検索（日本語 + 英語）

日本語キーワードだけでは不足することが多い。同じ意図で日英両方のクエリを並列に投げる:

```text
# 日本語
web_search(query="ゼロデイ攻撃 Webアプリケーション 脆弱性 2026年5月")

# 英語
web_search(query="CVE critical vulnerability web application June 2026")

# 攻撃キャンペーン
web_search(query="最近のサイバー攻撃 ゼロデイ CVE 2026")
```

**なぜ必要か:** 日本語検索は国内影響（日本法人の発表、日本語報道）を捕捉する。英語検索はCISA KEV・NVD・グローバルなセキュリティ研究機関の情報を捕捉する。両方をカバーしないと重要な脆弱性を見落とす。

### パターン2: 時間スコープの付与

キーワードだけが与えられた場合（payload.keywords）、直近の情報に絞るため時間スコープを明示する:

```text
# payload.keywords = ["ゼロデイ攻撃", "CVE"] の場合
# ↓ 以下のように時間スコープを付与

web_search(query="ゼロデイ攻撃 2026年5月")           # 日本語＋月指定
web_search(query="latest zero-day exploits 2026")     # 英語＋年指定
```

時間スコープがないと、古い脆弱性や過去の分析記事が混入する。

### パターン3: 製品/カテゴリ別の分散検索

セキュリティトピックは特定の製品カテゴリにまたがることが多い。以下の軸で検索を分散する:

```
# 軸A: ブラウザ脆弱性
web_search(query="Chrome Edge zero-day vulnerability 2026")

# 軸B: Webサーバー/ミドルウェア
web_search(query="NGINX Apache critical CVE 2026")

# 軸C: CMS/アプリケーション
web_search(query="WordPress Ghost CMS vulnerability exploit 2026")

# 軸D: ネットワーク機器/エンタープライズ
web_search(query="Cisco Fortinet zero-day active exploitation 2026")
```

### パターン4: 攻撃キャンペーン・インシデント

特定の脆弱性が実攻撃で使われているかを確認する:

```text
web_search(query="active exploitation zero-day campaign 2026")
web_search(query="大規模サイバー攻撃 ゼロデイ 悪用 2026")
```

## 抽出情報のクロスチェック手順

1. **CVE ID が記事中にあるか確認**: ない場合は要約が不正確な可能性。別ソースで確認するか、NVD で CVE ID を直接検索する。
2. **CVSS スコアと影響範囲の一致**: 2つのソース間で CVSS スコアが一致するか確認。ズレがある場合は NVD の公式スコアを採用。
3. **「悪用確認済み」の根拠**: CISA KEV に記載されているか、ベンダーアドバイザリに "exploited in the wild" と明記されているかを確認。ニュースサイトだけの「悪用確認」は注意が必要。
4. **日付の前後関係**: 脆弱性報告日 > パッチ公開日 > CISA KEV追加日 > ニュース報道日 の順序を確認。時系列が逆転している場合は誤報の可能性がある。

## shallow depth の注意点

セキュリティダイジェスト（複数の脆弱性をまとめる記事）の場合、`depth: "shallow"` でも **5-8 URL 程度の抽出が必要になる**ことが多い。これは1記事でカバーすべき製品カテゴリが複数にわたるため（ブラウザ、Webサーバー、CMS、ネットワーク機器など）。

- ガイドラインの「3-5 URL」は単一トピックの調査を想定
- セキュリティダイジェストは複数の脆弱性を束ねる記事形式なので、ダイジェスト内の各項目につき最低1ソース必要
- 目安: カバーする脆弱性の数 × 1ソース + 全体像把握用のCISA KEVやPatch Tuesdayまとめ

## 記事構成のヒント

セキュリティダイジェスト向けの構成:

```
# <期間> Webアプリケーションセキュリティダイジェスト

## 概要
期間内のハイライトと総件数

## <各脆弱性/インシデント>（項目ごとにセクション）
### 件名
| 項目 | 値 |
| CVSS | スコア |
| 影響バージョン | 範囲 |
| 修正バージョン | バージョン番号 |
### 詳細
### 対応
### 出典

## まとめ（トレンド分析と推奨アクション）
## 出典一覧
```

Markdown テーブル形式で CVSS や影響範囲を整理するとスキャンしやすい。
