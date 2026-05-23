import { ulid } from 'ulid'

/** ULID(時系列ソート可能、26 文字)を生成する */
export const newId = (): string => ulid()

/** ISO 8601 (UTC) 形式の現在時刻 */
export const now = (): string => new Date().toISOString()
