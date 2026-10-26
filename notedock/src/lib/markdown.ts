import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

// HTMLタグは無効にし、整形結果も DOMPurify で無害化する
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(md.render(text))
}
