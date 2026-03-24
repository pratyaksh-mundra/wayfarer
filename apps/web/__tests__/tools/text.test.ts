import { describe, it, expect } from 'vitest'
import { cleanText } from '../../app/api/tools/text'

describe('cleanText', () => {
  it('strips markdown links, keeps display text', () => {
    expect(cleanText('[visit here](https://example.com)', 200)).toBe('visit here')
  })

  it('strips bold markers', () => {
    expect(cleanText('**bold text**', 200)).toBe('bold text')
  })

  it('strips italic markers', () => {
    expect(cleanText('*italic text*', 200)).toBe('italic text')
  })

  it('strips blockquotes', () => {
    expect(cleanText('> This is a quote', 200)).toBe('This is a quote')
  })

  it('strips markdown headings', () => {
    expect(cleanText('## Section Title\nsome text', 200)).toBe('Section Title some text')
  })

  it('strips horizontal rules', () => {
    expect(cleanText('before\n---\nafter', 200)).toBe('before after')
  })

  it('collapses multiple blank lines into a space', () => {
    expect(cleanText('line1\n\n\n\nline2', 200)).toBe('line1 line2')
  })

  it('collapses inline whitespace', () => {
    expect(cleanText('too   many    spaces', 200)).toBe('too many spaces')
  })

  it('truncates to maxLen', () => {
    expect(cleanText('hello world', 5)).toBe('hello')
  })

  it('returns empty string for empty input', () => {
    expect(cleanText('', 200)).toBe('')
  })

  it('handles combined markdown in real reddit text', () => {
    const raw = '**Pondicherry** is great! Check out [Promenade Beach](https://maps.google.com).\n\n> Locals say: arrive early.\n\n---\n\nMore text here.'
    const result = cleanText(raw, 200)
    expect(result).not.toContain('**')
    expect(result).not.toContain('](')
    expect(result).not.toContain('---')
    expect(result).toContain('Pondicherry')
    expect(result).toContain('Promenade Beach')
  })
})
