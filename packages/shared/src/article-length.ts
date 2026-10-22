/** Counts the text a reader sees, including punctuation, spaces, and line breaks. */
export const ARTICLE_TITLE_MAX_LENGTH = 25;
export const ARTICLE_BODY_MAX_LENGTH = 1000;

const graphemeSegmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });

export function normalizeArticleText(text: string): string {
  return text.replace(/\r\n?/g, "\n").normalize("NFC");
}

export function countArticleCharacters(text: string): number {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(normalizeArticleText(text))) {
    count += 1;
  }
  return count;
}
