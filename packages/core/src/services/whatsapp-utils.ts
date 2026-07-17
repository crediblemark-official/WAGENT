/**
 * Strip markdown formatting for WhatsApp output.
 * WhatsApp only supports *bold*, _italic_, ~strikethrough~, `code`.
 * Everything else (###, -, >, [text](url)) shows as raw characters.
 */
export function stripMarkdown(text: string): string {
  let result = text;
  // Remove headers: ### Title → Title
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Convert bullet points: - item → • item
  result = result.replace(/^[\s]*[-*]\s+/gm, '• ');
  // Remove blockquotes: > text → text
  result = result.replace(/^>\s*/gm, '');
  // Remove links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Remove images: ![alt](url) → (empty)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  // Remove horizontal rules: --- or *** or ___
  result = result.replace(/^[\s]*[-*_]{3,}\s*$/gm, '');
  // Remove code blocks: ```...``` → (content only)
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/```\w*\n?/g, '').replace(/```/g, '').trim();
  });
  // Collapse multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}
