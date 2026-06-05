# Documentation / Long-Page Full-Text Extraction

`web_extract` が `Unauthorized: Invalid token` で利用不可、かつブラウザ（browserbase）は通過可能だが browser_snapshot の文字数制限（~8000文字）で内容が切り詰められる状況で、長文ドキュメントページから全文を抽出するテクニック。

## 基本パターン

```javascript
// 1. ページを開く
browser_navigate({ url: "https://docs.example.com/release-notes/" });

// 2. 主要コンテンツ領域を直接抽出
browser_console({
  expression: "document.querySelector('article').innerText.substring(0, 12000)"
});
```

## セレクタの選択（重要）

`document.body.innerText` はナビゲーション・サイドバー・フッターなど非コンテンツ領域を含み、トークン予算を浪費する。以下の優先順位でセレクタを試す：

| セレクタ | 対象ページ例 | 効果 |
|----------|-------------|------|
| `document.querySelector('article')` | Django/docs, InfoQ, 公式ドキュメント | 純粋な記事本文のみ。最も効率的 |
| `document.querySelector('main')` | dev.to, 技術ブログ全般 | article がない場合の代替 |
| `document.querySelector('.content')` | Bootstrap docs, MDN | クラスベースのレイアウト |
| `document.querySelector('#content')` | 古いドキュメント | ID ベースのレイアウト |
| `document.body` | 最終手段 | 全テキスト。ノイズが多い |

確認方法:
```javascript
// ブラウザでどのセレクタが有効か事前確認
document.querySelector('article') !== null  // trueなら article セレクタ使用可能
```

## 段階的抽出（複数呼び出し）

長大なドキュメント（Django 6.0 リリースノートの 20000+ 文字など）は、1回の呼び出しではタイムアウトまたは不完全な結果になる。以下のパターンで分割取得する：

```javascript
// 第1チャンク: 先頭 0〜12000 文字
browser_console({
  expression: "document.querySelector('article').innerText.substring(0, 12000)"
});

// 第2チャンク: 12000〜24000 文字
browser_console({
  expression: "document.querySelector('article').innerText.substring(12000, 24000)"
});

// 第3チャンク（必要なら）: 24000〜
browser_console({
  expression: "document.querySelector('article').innerText.substring(24000, 36000)"
});
```

**チャンクサイズの目安**: 8000〜15000 文字が安定して動作する。20000 超では30秒タイムアウトに達する可能性が高い。

## エラーリカバリ

`browser_console` の戻り値が **空文字列** になった場合:
- ブラウザの JavaScript コンテキストがリセットされた可能性が高い
- `browser_navigate` でページをロードし直す
- 再ロード後も空なら、`web_search` スニペット戦略にフォールバックする

## 実績のある組み合わせ

このテクニックで完全抽出に成功した実例:
- **Django 6.0 リリースノート** (docs.djangoproject.com): article セレクタ + 2分割抽出で全文 20000+ 文字を取得。CSP, Template Partials, Background Tasks, ORM改善など全セクションをカバー。
- **Django 6.0.6 リリースノート**: 同様の手法で short ページも article セレクタで効率的に取得。
- **FreeCodeCamp / GeeksforGeeks**: article セレクタが有効。長文でも安定。

## 先に試す: Markdown エンドポイントパターン

browser_console 抽出の前に、以下のパターンを試すと格段に効率的な場合がある。多くのドキュメントサイトは LLM/エージェント向けの **Markdown エンドポイント** を用意している：

| パターン | 対応サイト例 | 説明 |
|----------|-------------|------|
| `{url}/index.md` | Cloudflare Docs, ReadTheDocs, MkDocs | URL 末尾に `index.md` を付加すると生 Markdown が返る |
| `{url}/index.txt` | ReadTheDocs | `.txt` 版もある |
| `llms.txt` (サイトルート) | Cloudflare Docs (`/workers/llms.txt`), LLM向けサイト | サイト全体のページインデックスを提供。ページ探索に有用 |
| `Accept: text/markdown` | Cloudflare Docs | HTTP ヘッダで Markdown を要求 |

**Cloudflare Docs の例**:

ドキュメントページが Cloudflare 自身の bot 検出でブロックされた場合でも、Cloudflare Docs は **LLM/エージェント向けに明示的に Markdown を提供**している。実際のドキュメントページには以下のバナーが表示される：

```
STOP! If you are an AI agent or LLM, read this before continuing.
This is the HTML version of a Cloudflare documentation page.
Always request the Markdown version instead — HTML wastes context.
Get this page as Markdown: https://developers.cloudflare.com/<path>/index.md
```

**workflow**:
1. URL 末尾に `index.md` を付加して `web_extract` または `browser_navigate` で取得を試みる（Cloudflare Docs は Markdown 版が軽量でブロックされにくい）
2. 同じドメインの `llms.txt` から全ページインデックスを取得して、調査すべきページを発見する
3. それでもブロックされる場合のみ、browser_console 抽出に進む

このテクニックにより、Cloudflare Docs の内容を browser_console 抽出より 3〜5 倍速く取得できる。

## Cloudflare 保護下にある各サイトの可到達性の違い

Cloudflare 保護サイトを扱う際は **保護の強度に段階がある** ことに注意する：

| サイトカテゴリ | web_extract | browser_navigate | 代替手段 |
|---------------|-------------|-----------------|---------|
| Cloudflare 自身のドキュメント (`developers.cloudflare.com`) | ❌ ブロック | ✅ 通過可能（要 bot 警告） | `index.md` / `llms.txt` |
| Cloudflare Blog (`blog.cloudflare.com`) | ❌ ブロック | ⚠️ タイムアウト多発 | 検索スニペット / 二次情報 |
| Cloudflare 企業サイト (`cloudflare.com`) | ❌ ブロック | ❌ ブロック | 検索スニペット / 二次情報 |
| OpenAI/Anthropic 等の Cloudflare 保護サードパーティ | ❌ ブロック | ❌ ブロック | 検索スニペット / 二次情報 |

Cloudflare の**ドキュメントサイト** (`developers.cloudflare.com`) は他の Cloudflare 保護サイトよりアクセスが容易で、特に `index.md` エンドポイント経由ではエージェントからの取得が明示的にサポートされている。一方、主要企業サイト（`openai.com`, `anthropic.com`, `cloudflare.com` のランディングページ等）は browser_navigate もブロックされる。
