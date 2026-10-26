// 検証結果を集めて、まとめてコピーできるようにする
const results = new Map<string, string>()

export function setResult(key: string, value: string) {
  results.set(key, value)
}

export function getReportText(): string {
  const lines = [`NoteDock 実機検証レポート ${new Date().toLocaleString('ja-JP')}`]
  for (const [key, value] of [...results.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja', { numeric: true }))) {
    lines.push(`[${key}] ${value}`)
  }
  return lines.join('\n')
}
