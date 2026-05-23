import { existsSync, mkdirSync } from 'node:fs'
import simpleGit, { type SimpleGit } from 'simple-git'

/**
 * Markdown 記事を保管する Git リポジトリ操作。tech-stack.md §5.7 を参照。
 * - エージェントごとに author を分けてコミット(`agent:researcher@minakata`)
 * - リポが無ければ初期化
 */
export class GitService {
  private readonly git: SimpleGit

  constructor(private readonly repoPath: string) {
    if (!existsSync(repoPath)) mkdirSync(repoPath, { recursive: true })
    this.git = simpleGit(repoPath)
  }

  async ensureRepo(): Promise<void> {
    if (!existsSync(`${this.repoPath}/.git`)) {
      await this.git.init()
      await this.git.addConfig('user.email', 'agent@minakata.local')
      await this.git.addConfig('user.name', 'Minakata')
    }
  }

  /** ファイルをステージしてコミット。author は呼び出し側で渡す */
  async commitFile(input: {
    relativePath: string
    message: string
    author: string
  }): Promise<{ hash: string }> {
    await this.ensureRepo()
    await this.git.add(input.relativePath)
    const author = parseAuthor(input.author)
    const res = await this.git.commit(input.message, [input.relativePath], {
      '--author': `${author.name} <${author.email}>`,
    })
    return { hash: res.commit }
  }

  async log(
    file?: string,
  ): Promise<{ hash: string; date: string; message: string; author_name: string }[]> {
    const log = await this.git.log(file ? { file } : undefined)
    return log.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author_name: c.author_name,
    }))
  }
}

function parseAuthor(s: string): { name: string; email: string } {
  // 例: "agent:researcher@minakata"
  if (s.includes('<')) {
    const m = /^(.+?)\s*<(.+)>$/.exec(s)
    const name = m?.[1]
    const email = m?.[2]
    if (name && email) return { name: name.trim(), email: email.trim() }
  }
  return { name: s, email: `${s.replace(/[^a-zA-Z0-9._-]/g, '_')}@minakata.local` }
}
