// Text preprocessing for AI tool results.
// Strips markdown, collapses whitespace, removes filler — reduces token cost
// without losing meaningful travel advice.

export function cleanText(raw: string, maxLen: number): string {
  return raw
    // Strip markdown links — keep display text, drop URL
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Strip bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    // Strip blockquotes and Reddit-style headings
    .replace(/^>\s*/gm, '')
    .replace(/^#{1,6}\s*/gm, '')
    // Strip horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Collapse multiple blank lines → single newline
    .replace(/\n{2,}/g, ' ')
    // Collapse inline whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}
