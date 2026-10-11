/**
 * 把数据安全地嵌入 HTML 内联脚本（如 JSON-LD）。
 *
 * 安全背景：`</script>`、`<!--`、`&` 等序列在 JSON 中是**合法的字符串内容**，
 * 但会被 HTML 解析器当作标签边界，从而提前闭合 `<script>` 并造成脚本注入。
 * 因此必须转义为等价的 Unicode 转义序列（JSON 解析结果不变）。
 *
 * 该函数属于安全关键代码，放在契约包中以便 Core、官方插件与第三方插件共用同一实现。
 */
export function safeJsonForInlineScript(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
