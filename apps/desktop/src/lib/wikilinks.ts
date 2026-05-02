/**
 * Wikilink utilities: parse and transform [[slug]] / [[slug|text]] syntax.
 */

/** Extract all slug references from [[slug]] and [[slug|text]] patterns. */
export function extractWikilinks(text: string): string[] {
  const slugs: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    slugs.push(m[1].trim());
  }
  return slugs;
}

/**
 * Preprocess markdown content: convert [[slug]] / [[slug|text]] to
 * [text](wiki://slug) links that ReactMarkdown can render.
 */
export function preprocessWikilinks(content: string): string {
  return content.replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g, // [[slug|display text]]
    (_, slug, text) => `[${text.trim()}](wiki://${slug.trim()})`,
  ).replace(
    /\[\[([^\]|]+)\]\]/g, // [[slug]]
    (_, slug) => `[${slug.trim()}](wiki://${slug.trim()})`,
  );
}
