# ADR-003：主题设置采用 Manifest 声明式表单，保存与预览分离

- 状态：已接受
- 日期：2026-10-11

## 背景

主题需要暴露配置项（主题色、侧栏开关、页脚文案等）。若每个主题都要自己开发一套后台
Vue 页面，主题作者必须掌握前端框架，与 ADR-002 的目标相冲突；同时后台会因为主题数量
增长而无限膨胀。

另一类风险是"预览即生效"：管理员调节参数时公众站点立即变化，体验与稳定性都很差。

## 决策

1. **声明式表单**：主题在 `theme.json` 的 `settings` 中按分组声明字段
   （`type` / `label` / `default` / `min` / `max` / `maxLength` / `options`），
   后台据此**自动渲染**设置表单，主题作者无需编写任何前端代码。
2. **字段类型白名单**：仅允许 `text / textarea / color / boolean / number / select / image / url`。
3. **三层配置模型**：
   ```
   effective = defaults + publishedOverrides                 // 公众站点
   preview   = defaults + publishedOverrides + draftOverrides // 后台预览（iframe）
   ```
4. **保存与发布原子化**：保存整组设置时使用 `revision` 乐观锁，版本不一致返回 `409`。
5. **预览不污染公众**：预览令牌绑定管理员、主题 ID、配置版本与过期时间；公众请求永不读取草稿。
6. **服务端二次校验**：所有字段值由服务端按 Manifest 白名单校验；未声明字段一律丢弃。

## 理由

- 主题作者只需描述"有哪些设置项"，不需要了解后台实现；
- 后台无需为每个主题新增页面，UI 与主题数量解耦；
- 服务端白名单校验从根本上阻断"通过设置字段注入任意内容"的攻击面
  （例如把任意字符串塞进 `<style>`，因此颜色必须走 `css_color` 白名单过滤器）；
- 草稿/发布分离是内容型产品的标准预期，避免误操作立刻影响线上。

## 后果

**正面**

- 新增主题无需改动后台代码；
- 设置项有统一的服务端校验与历史回滚能力；
- 预览体验与线上隔离，可安全反复调参。

**负面 / 约束**

- 主题设置表达力受限于 8 种字段类型；复杂场景需退化为"文本 + 主题自行解析"或拆分为插件；
- 需要维护 `rn_theme_settings` 与 `rn_theme_setting_revisions` 两张表与 revision 语义；
- 字段 label 的国际化在 v1 采用字面量方案（见 ADR 索引"待定项"）。

## 相关实现

- `packages/theme-sdk/src/validator.ts`：`validateSettings` / `composeSettings` / `buildDefaults`
- `packages/core/src/themes/settings.ts`：三层合成与 revision 乐观锁
- `apps/admin/src/components/ThemeSettingForm.vue`：按声明自动生成表单
