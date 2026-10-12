/**
 * Toast UI Editor 的 vendor 注入、实例创建与光标读取。
 *
 * 为什么单独成一个模块：本插件约定单文件 ≤300 行，而 editor.js 还要装草稿、
 * 预览、状态栏、桥与降级路径，已到上限；"怎么把 Toast 拉起来"是一块边界清晰、
 * 只依赖 Toast **公开 API** 的逻辑，独立出来两边都更清楚。
 *
 * 用到的公开 API：getSelection / getMarkdown / setMarkdown / insertText /
 * change / caretChange / destroy。**不读任何私有属性**。
 */

/** vendor 目录基准：与本模块同目录、同源托管（/plugin-admin/<pluginId>/vendor/…）。 */
const VENDOR_BASE = new URL('./vendor/', import.meta.url);

/**
 * 工具栏裁剪：保留 Toast 原生分组观感 —— 内层数组为一组，组间自动画竖分隔线。
 * 分组依次是：标题/加粗/斜体/删除线 ｜ 水平线/引用 ｜ 无序/有序/任务列表/缩进/反缩进 ｜
 * 表格/图片/链接 ｜ 行内代码/代码块。
 */
const TOOLBAR_ITEMS = [
  ['heading', 'bold', 'italic', 'strike'],
  ['hr', 'quote'],
  ['ul', 'ol', 'task', 'indent', 'outdent'],
  ['table', 'image', 'link'],
  ['code', 'codeblock']
];

/** 模块级 Promise：同一 URL 只注入一次（反复挂载编辑器不重复插 <script>/<link>）。 */
let vendorLoader = null;

/** 注入一份 vendor 资源；失败 reject，由调用方降级，绝不冒泡到渲染层。 */
function inject(tag, attrs, label) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.dataset.editorEnhance = 'vendor';
    el.onload = () => resolve(true);
    el.onerror = () => reject(new Error(`vendor 文件加载失败：${label}`));
    document.head.appendChild(el);
  });
}

/**
 * 加载 Toast UI，成功返回 `toastui.Editor` 构造器；不可用（未 vendor / 加载失败）
 * 返回 null。两个文件名与 `admin/vendor/README.md` 的产物一一对应，都在插件自己的
 * `admin/` 目录里，同源注入，无需任何 CSP 放行。
 */
export function loadToastUi() {
  if (vendorLoader) return vendorLoader;
  vendorLoader = (async () => {
    await Promise.all([
      inject('link', { rel: 'stylesheet', href: new URL('toastui-editor.min.css', VENDOR_BASE).href }, 'CSS'),
      inject('script', { src: new URL('toastui-editor-all.min.js', VENDOR_BASE).href, async: true }, 'JS')
    ]);
    const Editor = window.toastui && window.toastui.Editor;
    if (typeof Editor !== 'function') throw new Error('window.toastui.Editor 不存在');
    return Editor;
  })().catch((error) => {
    // 预期内降级（未 vendor / 网络受限）：只告警一次，编辑界面继续可用
    console.warn('[editor-enhance] Toast UI 不可用，已降级为文本域 + 预览', error);
    return null;
  });
  return vendorLoader;
}

/**
 * 读光标行列（均 **1 起算**）；拿不到返回 null。
 *
 * 依据公开方法 `getSelection()`：markdown 模式下返回 `[[行, 列], [行, 列]]`。
 * 形状不符（将来版本改了语义、或跑在 wysiwyg）就老实返回 null，由调用方退回
 * 「字数 · 行数」—— 宁可不显示，也不翻私有属性猜一个数字出来。
 */
function readCaret(editor) {
  try {
    const selection = editor.getSelection();
    const start = Array.isArray(selection) ? selection[0] : null;
    if (!Array.isArray(start) || !start.every((n) => typeof n === 'number')) return null;
    return { line: start[0], col: start[1] };
  } catch (error) {
    return null; // 读取失败等同"拿不到"，不影响编辑
  }
}

/**
 * 创建并接好回调的 Toast 实例；任一环节失败返回 null（调用方降级为文本域）。
 *
 * options：
 * - el：挂载容器（必须已可见且有真实高度，见 editor.js 里"先切状态再挂"的注释）；
 * - value：初始 Markdown；
 * - onChange(markdown)：内容变化；
 * - onCaret(null | { line, col })：光标位置；
 * - onImageRejected()：Toast 自带图片按钮触发了文件读取时的引导回调。
 */
export function createToastEditor(Editor, options) {
  try {
    const editor = new Editor({
      el: options.el,
      height: '100%', // 需父容器有确定高度：见 editor.css 的高度链条说明
      initialEditType: 'markdown',
      previewStyle: 'vertical', // 竖向：左编辑右预览，与"两栏各司其职"一致
      hideModeSwitch: true, // 只做 Markdown，隐藏底部 WYSIWYG/Markdown 切换
      language: 'zh-CN', // 中文语言包已打进同一份 vendor 产物
      // 默认会把匿名使用数据发给 Google Analytics：后台常在内网/离线环境部署，
      // 既不该外发数据，也不该为此多一个首屏外部请求，明确关闭。
      usageStatistics: false,
      autofocus: false, // 进页面不抢焦点（标题输入框才是第一落点）
      initialValue: options.value,
      toolbarItems: TOOLBAR_ITEMS,
      /**
       * Toast 自带的图片按钮走的是"选文件 → blob 上传"，而本插件的图片统一走
       * 编辑器上方的「插入图片」（媒体库选中 → 相对地址，如 /media/12）。
       * 这里**不调用 callback**（否则会插出宿主不认识、还可能写死绝对地址的链接），
       * 改为交给调用方提示作者改走既有路径 —— 不静默失败。
       */
      addImageBlobHook: () => options.onImageRejected()
    });

    editor.on('change', () => options.onChange(editor.getMarkdown()));
    // caretChange 是公开事件（光标/选区变化时触发）；它只带 editorType，
    // 因此收到后再用公开的 getSelection() 取值。
    editor.on('caretChange', () => options.onCaret(readCaret(editor)));
    options.onCaret(readCaret(editor)); // 初始位置如实报一次，状态栏不会先空后跳

    return editor;
  } catch (error) {
    console.warn('[editor-enhance] Toast UI 初始化失败，保持文本域降级', error);
    return null;
  }
}

/** 销毁实例（容错）：Toast 内部异常不能冒泡进卸载流程。 */
export function destroyToastEditor(editor) {
  if (!editor) return;
  try {
    editor.destroy();
  } catch (error) {
    console.warn('[editor-enhance] Toast UI 销毁失败', error);
  }
}
