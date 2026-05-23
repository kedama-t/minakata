/**
 * monorepo 全体で共有するアンビエント宣言。
 * 各パッケージの tsconfig が `../../types/globals.d.ts` を include する。
 */

// SQL ファイルの `?raw` インポート(Bun / Vite 共通)
declare module '*.sql?raw' {
  const content: string
  export default content
}
