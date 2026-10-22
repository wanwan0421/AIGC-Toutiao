const path = require("node:path");
const zlib = require("node:zlib");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
require("dotenv").config({ path: path.resolve(process.cwd(), "apps/api/.env"), override: false });

const apiKey = process.env.ARK_API_KEY;
const model = process.env.ARK_MODEL_ID || process.env.ARK_MODEL || "doubao-seed-evolving";
const endpoint = (process.env.ARK_CHAT_COMPLETIONS_API_URL || process.env.ARK_API_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3/chat/completions").replace(/\/$/, "");
if (!apiKey) throw new Error("ARK_API_KEY is not configured");

const schema = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    level: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string" },
    types: { type: "array", items: { type: "string", enum: ["pornography", "gambling", "drug", "sensitive", "violence", "fraud", "none"] } },
  },
  required: ["pass", "level", "reason", "types"],
  additionalProperties: false,
};
const policy = "You are a safety reviewer. Inspect only visible image evidence. Reject visible pornography, graphic violence, weapons, drugs, gambling, fraud, politically sensitive imagery, or scam/diversion QR codes. Otherwise approve. Return only the requested structured result.";
const png = solidPng(128, 128, 44, 130, 210);
const dataUri = `data:image/png;base64,${png.toString("base64")}`;

async function call(messages, structured) {
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      thinking: { type: "disabled" },
      ...(structured ? { response_format: { type: "json_schema", json_schema: { name: "image_moderation", strict: true, schema } } } : {}),
    }),
  });
  const elapsedMs = Date.now() - started;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ark returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Ark response had no text content");
  let parsed;
  if (structured) {
    parsed = JSON.parse(text);
    if (typeof parsed.pass !== "boolean" || !["low", "medium", "high"].includes(parsed.level) || typeof parsed.reason !== "string" || !Array.isArray(parsed.types)) {
      throw new Error("Ark structured response did not match the expected fields");
    }
  }
  return {
    elapsedMs,
    usage: payload.usage ?? {},
    resultValid: structured ? true : undefined,
    model: payload.model,
    text,
  };
}

async function main() {
  process.stderr.write("baseline image description request started\n");
  const oldChainStart = Date.now();
  const description = await call([
    { role: "user", content: [
      { type: "image_url", image_url: { url: dataUri } },
      { type: "text", text: "详细描述图片中的人物、裸露、暴力、武器、毒品、赌博、二维码、文字和其他安全风险。" },
    ] },
  ], false);
  const oldClassification = await call([
    { role: "system", content: policy },
    { role: "user", content: `Image description: ${description.text}` },
  ], true);
  const oldChainElapsedMs = Date.now() - oldChainStart;

  const combined = [];
  for (let i = 0; i < 3; i += 1) {
    process.stderr.write(`combined image+schema request ${i + 1} started\n`);
    combined.push(await call([
      { role: "system", content: policy },
      { role: "user", content: [
        { type: "image_url", image_url: { url: dataUri } },
        { type: "text", text: "Review this image under the safety rules. The image content follows the policy." },
      ] },
    ], true));
  }

  const sumUsage = (rows) => rows.reduce((sum, row) => ({
    input_tokens: sum.input_tokens + Number(row.usage.prompt_tokens ?? row.usage.input_tokens ?? 0),
    output_tokens: sum.output_tokens + Number(row.usage.completion_tokens ?? row.usage.output_tokens ?? 0),
    total_tokens: sum.total_tokens + Number(row.usage.total_tokens ?? 0),
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  const estimatedYuan = (usage) => Number((usage.input_tokens * 6 / 1_000_000 + usage.output_tokens * 30 / 1_000_000).toFixed(8));
  const baselineUsage = sumUsage([description, oldClassification]);
  const combinedUsage = sumUsage(combined);
  const summary = {
    model,
    endpoint,
    testImage: "generated 128x128 solid-color PNG; no user content",
    baselineExistingTwoCallImagePath: {
      calls: 2,
      wallElapsedMs: oldChainElapsedMs,
      callLatenciesMs: [description.elapsedMs, oldClassification.elapsedMs],
      usage: baselineUsage,
      estimatedCostYuan: estimatedYuan(baselineUsage),
      structuredOutputValid: oldClassification.resultValid,
    },
    combinedMultimodalStructuredPath: {
      attempts: combined.length,
      successful: combined.length,
      callLatenciesMs: combined.map((row) => row.elapsedMs),
      usage: combinedUsage,
      averageUsagePerCall: {
        input_tokens: Math.round(combinedUsage.input_tokens / combined.length),
        output_tokens: Math.round(combinedUsage.output_tokens / combined.length),
        total_tokens: Math.round(combinedUsage.total_tokens / combined.length),
      },
      averageEstimatedCostYuanPerCall: Number((estimatedYuan(combinedUsage) / combined.length).toFixed(8)),
      structuredOutputValid: combined.every((row) => row.resultValid),
    },
    note: "This compares image review calls only. Text moderation is unchanged and is not included in these timing/token totals.",
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function solidPng(width, height, red, green, blue) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) { row[1 + x * 3] = red; row[2 + x * 3] = green; row[3 + x * 3] = blue; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
