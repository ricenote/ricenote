# 安全控制面

RiceNote 的安全控制面**保留在 Core**，而用户与权限的业务数据仍由插件提供 —— 这是
[ADR-005](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-005-security-control-plane-in-core.md) 的核心决策：
**边界必须由不可被插件替换的代码来守**。

相关源码：`packages/core/src/security/`（`session.ts`、`csrf.ts`、`gateway.ts`、`audit.ts`）、
`packages/core/src/plugins/context-factory.ts`、`packages/core/src/logger.ts`、
`apps/server/src/http/admin/guard.ts`。

---

## 1. 一次后台写请求要过几道关

```
请求 → 认证（签名 Cookie 解析）        ← 失败：401 UNAUTHENTICATED
     → CSRF 校验（仅写方法）           ← 失败：403 RN_CSRF_INVALID
     → 权限校验（capability，fail-closed）← 失败：403 RN_FORBIDDEN
     → 业务处理
     → 审计写入（管理写操作）
```

调用 `guard()`（`apps/server/src/http/admin/guard.ts`）统一执行：

1. `kernel.gateway.authenticate(headers)` → `requireAuth`；
2. 若方法是 POST/PUT/PATCH/DELETE → `enforceCsrf`；
3. `requirePermission(auth, options.permission)`；
4. 执行 handler；插件管理写路由额外写审计。

登录类端点（还没有会话）走 `anonymousGuard`，跳过 CSRF 校验。

---

## 2. 会话

| 项 | 实现 |
| --- | --- |
| Cookie 名 | `ricenote_session`（会话）、`ricenote_csrf`（CSRF 令牌） |
| 签名 | HMAC-SHA256（`createHmac('sha256', secret)`），base64url 编码 |
| 结构 | 三段：`payload.signature` 形态；解析后校验签名与过期 |
| 比较 | **常量时间比较**（避免时序侧信道） |
| 属性 | `HttpOnly`、`SameSite=Lax`、生产环境追加 `Secure` |
| 解析 | 通过 `core.security@1` 的 `registerSessionResolver()` **依赖倒置** —— Core 不认用户表 |

**fail-closed**：若没有注册任何会话解析器（例如 `rice.identity` 未启用），`authenticate()` 返回 `undefined`
而不是"放行"。因此"缺插件"不会变成"没登录也能进后台"。

---

## 3. CSRF（双重提交 + 会话绑定签名）

`CsrfManager` 的做法：

1. 签发：生成 `nonce`，令牌 = `nonce.hmac(<sessionId>.<nonce>)`；
2. 校验：
   - 安全方法（GET/HEAD/OPTIONS）直接跳过；
   - 会话缺失 → `RN_CSRF_INVALID`；
   - header 或 cookie 令牌缺失 → `RN_CSRF_INVALID`；
   - **常量时间比较** header 与 cookie 的令牌是否一致；
   - 拆分 `nonce` 与签名，重新计算 `hmac(<sessionId>.<nonce>)` 并比对。

关键点：令牌与**会话绑定**。因此攻击者即使拿到自己会话的 CSRF 令牌，也无法用它伪造受害者的请求。

---

## 4. 授权（fail-closed）

`requirePermission()`：

| 情况 | 结果 |
| --- | --- |
| 未注册 `authorization` resolver | 抛 `RN_FORBIDDEN` |
| 权限查询本身抛异常 | 抛 `RN_FORBIDDEN` |
| 用户没有该权限点、也没有 `*` | 抛 `RN_FORBIDDEN` |

**"查询出错"与"没有权限"同等处理** —— 任何不确定都拒绝。这是 fail-closed 的实质。

权限点由**拥有它的插件**在 `manifest.permissions` 里声明（Core 自己声明控制面与共用权限点），
Core 校验全局唯一、聚合并通过 `core.security@1` 暴露，`rice.authorization` 只负责展示与分派
（见 [[后台功能导览|Admin-Guide]]、ADR-018）。

内置角色只剩 `administrator`（`*`）：启动只保证它存在且权限为 `*`，
避免"数据库里被改坏了"导致没人能进后台；其余角色由站点管理员自建 —— 插件不替站点决定"谁该有什么权限"。

---

## 5. 登录限流

| 参数 | 值 |
| --- | --- |
| 窗口内最大失败次数 | 8 |
| 窗口长度 | 300 秒 |
| 触发后封禁 | 900 秒 |
| 维度 | 用户名 + IP（由调用方组装 key） |

成功登录会重置计数。

---

## 6. 审计

- 表：`rn_audit_logs`
- 字段：`site_id`、`actor_id`、`actor_name`、`action`、`target_type`、`target_id`、`ip`、`request_id`、`detail_json`、`created_at`
- 触发：所有**管理写操作**由 HTTP 层统一记录（`action` 形如 `POST /api/admin<path>`）；
  重启、密码重置、站点信息写入、插件安装等关键操作同样落审计。

审计日志可在后台「系统设置」或通过 `GET /api/admin/audit`（权限 `system.audit`）查看。

---

## 7. 日志脱敏

`packages/core/src/logger.ts`：

```
SENSITIVE_KEY = /(password|passwd|secret|token|credential|authorization|cookie)/i
```

命中键名的值替换为 `[redacted]`，**递归深度上限 6**。

因此插件里 `logger.info('登录', { password })` 不会泄漏明文（但仍建议不要传敏感值 —— 脱敏是兜底，不是许可）。

另外，`RICENOTE_NPM_TOKEN` 这类令牌**只从环境变量读取，不落库、不进日志**。

---

## 8. 富文本与模板输出

| 机制 | 位置 |
| --- | --- |
| `sanitizeRichText()` | 白名单标签消毒后输出 |
| `markTrusted()` | 把已消毒内容标记为 `TrustedHtml` |
| `escapeHtml()` | 显式转义 |
| Nunjucks `autoescape: true` | 模板默认全部转义 |
| `css_color` 过滤器 | 主题设置里的颜色强制走白名单，阻断 `style` 注入 |
| `safeJsonForInlineScript()` | JSON-LD 等内联脚本序列化，转义 `<` `>` `&` 与 U+2028/U+2029，防 `</script>` 提前闭合 |

**只有被显式标记为受信的 HTML 才会在模板中不转义。**

---

## 9. 能力白名单（插件侧）

插件能调用哪些 Core API 由清单的 `capabilities` 决定，未声明即被替换为**拒绝桩**（抛 `RN_FORBIDDEN`）。
完整的 12 项能力清单见 [[插件生命周期|Architecture-Plugin-Lifecycle]]。

设计意图：**插件的"权限面"必须是显式且可审查的** —— 审查一个插件安全不安全，先看它的 `capabilities`。

---

## 10. 插件安装的风险面

安装插件等同于**在服务器上执行代码**（可跑依赖安装脚本与构建脚本）。因此：

- 独立权限点 `plugin.install`（与 `plugin.manage` 分开），默认仅管理员；
- 后台安装必须勾选高风险确认，并写入审计；
- `--no-scripts` / `RICENOTE_ALLOW_INSTALL_SCRIPTS=false` 可全局关闭脚本执行；
- 包内容白名单（允许 `.css` / `.html` / `.wasm` 与字体图片，**禁止 `.node` 原生模块**）与体积上限。

---

## 11. 自查清单

| 检查项 | 期望 |
| --- | --- |
| 生产 `SESSION_SECRET` | 高熵随机值，非默认值 |
| `CSRF_ENABLED` | `true` |
| Cookie | 生产环境有 `Secure`；反向代理正确透传 `X-Forwarded-Proto` |
| 初始管理员密码 | 已修改 |
| 审计日志 | 关键写操作有记录 |
| 插件能力声明 | 仅声明实际需要的 |
| 自定义插件输出的 HTML | 经过消毒 + `markTrusted()`，而非直接拼字符串 |

---

## 相关页面

- [[启动时序|Architecture-Core-Bootstrap]]
- [[数据层与迁移|Architecture-Data-and-Migrations]]
- [[环境变量参考|Configuration]]
- [[后台功能导览|Admin-Guide]]
