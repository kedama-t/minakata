/**
 * 埋め込み生成サービス。Transformers.js を `core` プロセス内で実行(P11)。
 *
 * - モデル: `intfloat/multilingual-e5-base`(768 次元、英日混在に強い)
 * - E5 系の prefix 規約:検索クエリは `query: ...`、本文は `passage: ...`
 * - 初回呼び出しで cold start(1〜3 秒)、以降メモリ常駐
 * - テストでは `setExtractor()` でモック注入可能
 */

import type { FeatureExtractionPipeline } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/multilingual-e5-base'
export const EMBEDDING_DIM = 768

export type Extractor = (text: string) => Promise<Float32Array>

export class EmbeddingService {
  private extractor: Extractor | null = null
  private loadingPromise: Promise<Extractor> | null = null

  /** テスト等で実モデルロードをスキップしたい場合に使う */
  setExtractor(fn: Extractor): void {
    this.extractor = fn
  }

  async warmup(): Promise<void> {
    await this.getExtractor()
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const ex = await this.getExtractor()
    return ex(`query: ${text}`)
  }

  async embedPassage(text: string): Promise<Float32Array> {
    const ex = await this.getExtractor()
    return ex(`passage: ${text}`)
  }

  private async getExtractor(): Promise<Extractor> {
    if (this.extractor) return this.extractor
    if (this.loadingPromise) return this.loadingPromise
    this.loadingPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers')
      const pipe = (await pipeline('feature-extraction', MODEL_ID, {
        dtype: 'q8',
      })) as FeatureExtractionPipeline
      const fn: Extractor = async (text) => {
        const out = await pipe(text, { pooling: 'mean', normalize: true })
        return new Float32Array(out.data as Float32Array)
      }
      this.extractor = fn
      return fn
    })()
    return this.loadingPromise
  }
}
