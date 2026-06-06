# 规则引擎输入输出约定

## 输入

```json
{
  "title": "",
  "body": "",
  "contentId": "",
  "userId": ""
}
```

## 规则命中输出

```json
{
  "ruleItems": [
    {
      "type": "privacy",
      "level": "medium",
      "evidence": "13800000000",
      "reason": "疑似手机号",
      "start": 12,
      "end": 23,
      "confidence": 0.85,
      "ruleId": "privacy.phone"
    }
  ]
}
```

## 字段说明

- `type`: 必须映射到 `risk-taxonomy.md` 中的风险类型。
- `level`: `low | medium | high`。
- `evidence`: 命中的原文片段。
- `reason`: 规则命中原因。
- `start` / `end`: 在拼接文本中的字符位置；如果无法确定可以省略。
- `confidence`: 0-1。
- `ruleId`: 规则编号，方便追踪词库或正则来源。

## 合并前处理

- 同一 `ruleId` 和同一 `evidence` 多次命中时只保留一次。
- 过长证据片段应裁剪到能说明风险的最小范围。
- 明显误命中的低置信度规则项可以交给 LLM 复核，不要直接阻断。
