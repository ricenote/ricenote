/**
 * 编辑增强插件内部的「当前编辑器」桥（模块级单例）。
 *
 * 为什么需要它：
 * - `editorBody`（正文锚点）与 `editorToolbar`（工具栏锚点）是**两个独立的贡献模块**，
 *   它们各自 `import` 同一个 URL，由宿主 `<PluginSlot>` 分别挂载，彼此没有组件层级关系；
 * - 工具栏要"把图片语法插到光标处"，就必须拿到正文编辑器的实例 ——
 *   通过扩展点 context 也传不过去（context 由提供方 posts/pages 决定，我们无权改宿主契约）；
 * - 三个贡献同属一个插件目录、由同一个托管 URL 加载，ESM 模块实例天然共享，
 *   因此这里用一个模块级变量即可，**不需要**挂到 window 上污染全局。
 *
 * 生命周期约定：`editor.js` 挂载时注册、卸载时清空；工具栏在桥为空时自行降级。
 */

/** 当前挂载中的编辑器句柄：{ insertAtCursor(text: string): boolean }。 */
let active = null;

/** 注册当前编辑器（editor.js 在 onMounted 里调用）。 */
export function setActiveEditor(handle) {
  active = handle && typeof handle.insertAtCursor === 'function' ? handle : null;
}

/**
 * 取消注册。
 *
 * 必须**按句柄比对**再清空：编辑器卸载与新编辑器挂载存在交错（例如切换文章时
 * 旧实例的 unmount 晚于新实例的 mount），无条件置空会把新实例的桥也清掉，
 * 表现为"插入图片偶尔没反应"。
 */
export function clearActiveEditor(handle) {
  if (active === handle) active = null;
}

/** 读取当前编辑器句柄（无编辑器时为 null）。 */
export function getActiveEditor() {
  return active;
}

/**
 * 把文本插入到正文光标处。
 *
 * 返回 `true` = 已交给真实编辑器插入；返回 `false` = 桥为空（正文贡献被停用、
 * 或浏览器里根本没有可插入的编辑器），调用方应自行降级为"追加到正文末尾"。
 * 这里不替调用方做降级，避免把"插入失败"和"追加成功"混为一谈。
 */
export function insertAtCursor(text) {
  const handle = active;
  if (!handle) return false;
  try {
    return handle.insertAtCursor(text) === true;
  } catch (error) {
    // 编辑器内部异常不能冒泡到工具栏渲染层（否则整个工具栏被错误边界吞掉）
    console.warn('[editor-enhance] 插入到光标失败，调用方应降级处理', error);
    return false;
  }
}
