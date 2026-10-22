const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ARTICLE_TITLE_MAX_LENGTH,
  ARTICLE_BODY_MAX_LENGTH,
  countArticleCharacters,
  normalizeArticleText,
  WritingStyleProfileSchema,
  WritingStyleSourceManifestSchema,
} = require("../dist/index.js");

test("article counts grapheme clusters after NFC and newline normalization", () => {
  assert.equal(ARTICLE_TITLE_MAX_LENGTH, 25);
  assert.equal(ARTICLE_BODY_MAX_LENGTH, 1000);
  assert.equal(normalizeArticleText("e\u0301\r\n下一行\r"), "é\n下一行\n");
  assert.equal(countArticleCharacters("e\u0301， A\r\n👩‍👩‍👧‍👦"), 6);
  assert.equal(countArticleCharacters("中".repeat(25)), 25);
  assert.equal(countArticleCharacters("中".repeat(26)), 26);
  assert.equal(countArticleCharacters("🙂".repeat(1000)), 1000);
  assert.equal(countArticleCharacters("🙂".repeat(1001)), 1001);
});

test("style profile is structured and does not inherit first-build sample limits", () => {
  const method = {
    structure: "先交代场景，再分步骤讲经验",
    opening: "从个人经历切入",
    transitions: "按时间顺序",
    ending: "给出实用总结",
    tone: "自然、克制",
    viewpoint: "第一人称",
    diction: "短句、少用套话",
  };
  const profile = {
    schemaVersion: 1,
    summary: "以亲历经验和步骤展开",
    common: method,
    topics: [{ key: "travel", label: "旅行", sampleCount: 21, method }],
    authorLockedPaths: ["common.tone"],
  };
  assert.equal(WritingStyleProfileSchema.safeParse(profile).success, true);
  assert.equal(WritingStyleProfileSchema.safeParse({
    ...profile,
    topics: [profile.topics[0], profile.topics[0]],
  }).success, false);
  assert.equal(WritingStyleProfileSchema.safeParse({ ...profile, unexpected: "source facts" }).success, false);
  assert.equal(WritingStyleSourceManifestSchema.safeParse(
    Array.from({ length: 21 }, (_, index) => ({ contentId: `post-${index}`, contentHash: `hash-${index}` })),
  ).success, true);
  assert.equal(WritingStyleSourceManifestSchema.safeParse([
    { contentId: "post-1", contentHash: "first-hash" },
    { contentId: "post-1", contentHash: "second-hash" },
  ]).success, false);
});
