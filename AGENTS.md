# AGENTS.md

## 语言约定

- 本项目的主要交流、需求文档、设计文档、任务说明和 Codex 输出默认使用中文。
- API 名、CLI 名、模型名、协议名、错误码、代码标识符、文件路径、命令、日志关键词等技术关键词可以保留英文。
- 面向用户的文档应优先保证中文可读性，不为了翻译而翻译稳定技术名词。

## Scope Calibration

- Match governance effort to task type. Do not turn broad, low-risk copy/i18n/content sweeps into dozens of micro governed tasks unless the user explicitly asks for that granularity.
- For i18n, wording, help content, labels, tooltips, and other broad text-only work, prefer an audit-and-batch workflow:
  1. classify visible strings by priority,
  2. batch related fixes by surface or user workflow,
  3. run representative tests plus key parity/type checks,
  4. summarize residual risks plainly.
- Use per-item task/evidence only for high-risk behavior, data, security, sync, auth, send/delete/archive, release, AI autonomy, or user-impacting logic changes.
- Keep the user's real goal in view. If the request is "add Chinese i18n," optimize for a usable Chinese product, not perfect documentation choreography.
- Before adding more process, ask: does this reduce product risk, or is it workflow theater?

## i18n Boundary

- Translate user-visible application chrome: navigation, settings, dialogs, errors, empty states, help content, command labels, tooltips, and status messages.
- Preserve technical identifiers and source content by default: protocol names, product/brand names, model names, API names, keyboard keys, URLs, search syntax, logs, email body text, email addresses, MIME/.eml headers, and server/library diagnostics unless explicitly user-facing and safely mappable.
