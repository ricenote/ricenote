/**
 * rice.posts.editorBody / rice.pages.editorBody —— Markdown 正文编辑器（mode: replace）。
 *
 * replace 语义：提供方默认只是普通多行文本域，我们整体换成带实时预览的编辑器；
 * 停用即回退默认。`./vendor/` 下有 Toast UI 预构建文件就注入启用（双栏预览 + 工具栏），
 * 否则降级为 textarea + 右栏实时预览（预览仍走 onPreview() 的服务端渲染管线）。
 *
 * 契约（**必须声明 props**，否则 context 落进 attrs，setup 里全是 undefined）：
 * kind: 'post' | 'page'；value / onChange(next)；onPreview(): Promise<已消毒 HTML>。
 */

import {
  computed,
  defineAdminContribution,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from '/admin-sdk/v1/ricenote-admin.js';
import { clearActiveEditor, setActiveEditor } from './bridge.js';

const DRAFT_DEBOUNCE_MS = 800; // 太小频繁写 localStorage，太大则崩溃时丢字
const PREVIEW_DEBOUNCE_MS = 400; // 比草稿短，让"边写边看"跟得上
const NARROW_QUERY = '(max-width: 900px)'; // 与 editor.css 的布局切换断点一致
const VENDOR_BASE = new URL('./vendor/', import.meta.url);
/** 模块级 Promise：同一 URL 只注入一次（多次挂载不重复插 <script>/<link>）。 */
let vendorLoader = null;
/** 草稿键含 kind：文章与页面各存一份，互不覆盖。 */
function draftKey(kind) {
  return `editor-enhance:draft:${kind === 'page' ? 'page' : 'post'}`;
}
/** 注入一个 vendor 资源；失败 reject，由调用方降级，绝不冒泡到渲染层。 */
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
/** UMD 不能用 import，注入 <script> 再从 window 取；失败返回 null（缓存结果，不反复重试）。 */
function loadToastUi() {
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

export default defineAdminContribution({
  name: 'editor-enhance:body',
  /* 与提供方扩展点声明的字段一一对应；少一个就读不到 context。 */
  props: ['kind', 'value', 'onChange', 'onPreview'],
  setup(props) {
    const host = ref(null); // Toast UI 挂载容器（两种模式下都常驻，避免替换 ref 元素）
    const textarea = ref(null);
    const text = ref(typeof props.value === 'string' ? props.value : '');
    const mode = ref('plain'); // 'plain' | 'toastui'
    const narrow = ref(false);
    const tab = ref('edit');
    const previewHtml = ref('');
    const previewError = ref('');
    const draftSavedAt = ref('');

    /** 字数不含空白：与"中文字数"的直觉一致（标点保留）。 */
    const charCount = computed(() => text.value.replace(/\s/g, '').length);
    const lineCount = computed(() => (text.value ? text.value.split('\n').length : 0));

    let toastEditor = null;
    let draftTimer = 0;
    let previewTimer = 0;
    let mediaQuery = null;
    let mediaHandler = null;

    /** 防御：宿主未提供 onChange（只读场景）时静默降级，而不是抛错。 */
    function emitChange(next) {
      if (typeof props.onChange === 'function') props.onChange(next);
    }

    function saveDraft() {
      try {
        const now = new Date();
        const payload = JSON.stringify({ text: text.value, savedAt: now.toISOString() });
        window.localStorage.setItem(draftKey(props.kind), payload);
        draftSavedAt.value = now.toTimeString().slice(0, 5); // hh:mm
      } catch (error) {
        // 隐私模式 / 配额不足都会走到这里：不能因此打断编辑
        console.warn('[editor-enhance] 自动草稿写入失败', error);
      }
    }

    function scheduleDraft() {
      if (draftTimer) window.clearTimeout(draftTimer);
      draftTimer = window.setTimeout(() => {
        draftTimer = 0;
        saveDraft();
      }, DRAFT_DEBOUNCE_MS);
    }

    /**
     * 读取可恢复的草稿。
     * **恢复条件（局限）**：仅当宿主传入的 `props.value` 为空（含纯空白）时才恢复 ——
     * 一旦宿主已有内容（编辑既有文章）一律以宿主为准，否则会把上次未保存的草稿贴进
     * 正式内容。草稿是"崩溃兜底"而非版本历史：只保留一份，读取后不自动清除。
     */
    function readDraft() {
      if (typeof props.value === 'string' && props.value.trim() !== '') return null;
      try {
        const raw = window.localStorage.getItem(draftKey(props.kind));
        const restored = raw ? JSON.parse(raw).text : '';
        return typeof restored === 'string' && restored.trim() ? restored : null;
      } catch (error) {
        console.warn('[editor-enhance] 草稿读取失败，按无草稿处理', error);
        return null;
      }
    }

    async function refreshPreview() {
      if (typeof props.onPreview !== 'function') {
        previewError.value = '当前编辑页未提供预览能力';
        return;
      }
      try {
        const html = await props.onPreview();
        // 健壮性：第三方提供方可能选择"自己弹框/自己处理"，返回 undefined 或空串 ——
        // 此时安静留空即可，不报错（正文预览栏常驻，没有需要关掉的对话框）。
        previewHtml.value = typeof html === 'string' ? html : ''; // 已消毒，可安全 v-html
        previewError.value = '';
      } catch (error) {
        previewError.value = error && error.message ? error.message : '预览渲染失败';
      }
    }

    function schedulePreview() {
      if (previewTimer) window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        previewTimer = 0;
        void refreshPreview();
      }, PREVIEW_DEBOUNCE_MS);
    }

    function applyText(next) {
      text.value = next;
      emitChange(next);
      scheduleDraft();
      schedulePreview();
    }

    /** 供 toolbar.js 经 bridge.js 调用；false 表示当前没有可插入的编辑器。 */
    function insertAtCursor(snippet) {
      const value = typeof snippet === 'string' ? snippet : String(snippet ?? '');
      if (toastEditor) {
        toastEditor.insertText(value); // Toast UI 自带光标插入（无光标时插入末尾）
        return true;
      }
      const el = textarea.value;
      if (!el || typeof el.selectionStart !== 'number') return false;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      applyText(text.value.slice(0, start) + value + text.value.slice(end));
      const caret = start + value.length;
      nextTick(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
      return true;
    }

    const handle = { insertAtCursor };
    function mountToastUi(Editor) {
      try {
        toastEditor = new Editor({
          el: host.value,
          initialEditType: 'markdown',
          previewStyle: 'vertical',
          hideModeSwitch: true,
          height: '100%',
          initialValue: text.value,
          toolbarItems: [
            ['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'],
            ['ul', 'ol', 'task'], ['table', 'link'], ['code', 'codeblock']
          ]
        });
        toastEditor.on('change', () => applyText(toastEditor.getMarkdown()));
        mode.value = 'toastui';
      } catch (error) {
        // 初始化失败必须保留 textarea 路径，否则用户面对一个空白编辑区
        toastEditor = null;
        console.warn('[editor-enhance] Toast UI 初始化失败，保持文本域降级', error);
      }
    }

    function destroyToastUi() {
      if (!toastEditor) return;
      try {
        toastEditor.destroy();
      } catch (error) {
        console.warn('[editor-enhance] Toast UI 销毁失败', error);
      }
      toastEditor = null;
    }

    /** 窄屏把预览折为标签页（与 CSS 断点同口径）。 */
    function watchNarrow() {
      if (!window.matchMedia) return;
      mediaQuery = window.matchMedia(NARROW_QUERY);
      narrow.value = mediaQuery.matches;
      mediaHandler = (event) => { narrow.value = event.matches; };
      if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', mediaHandler);
      else mediaQuery.addListener(mediaHandler); // 兼容旧 WebView
    }

    onMounted(async () => {
      setActiveEditor(handle); // 先注册桥（同步），工具栏不必等编辑器升级完成

      const restored = readDraft();
      if (restored !== null) {
        text.value = restored;
        emitChange(restored); // 让宿主表单同步，否则"直接保存"会丢掉恢复的内容
        draftSavedAt.value = '已恢复上次草稿';
      }

      watchNarrow();
      schedulePreview();

      const Editor = await loadToastUi();
      if (Editor && host.value) mountToastUi(Editor);
    });
    onBeforeUnmount(() => {
      // 卸载前把待写的草稿落盘，避免"最后 800ms 的输入"丢失
      if (draftTimer) { window.clearTimeout(draftTimer); draftTimer = 0; saveDraft(); }
      if (previewTimer) { window.clearTimeout(previewTimer); previewTimer = 0; }
      if (mediaQuery && mediaHandler) {
        if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', mediaHandler);
        else mediaQuery.removeListener(mediaHandler);
      }
      clearActiveEditor(handle); // 先摘桥再销毁实例，避免插入打到已销毁的实例上
      destroyToastUi();
    });

    // 宿主重置表单（例如切换文章）时同步进编辑器；同值不处理，避免与输入形成回环
    watch(
      () => props.value,
      (next) => {
        const value = typeof next === 'string' ? next : '';
        if (value === text.value) return;
        text.value = value;
        if (toastEditor && toastEditor.getMarkdown() !== value) toastEditor.setMarkdown(value, false);
      }
    );

    return {
      charCount, draftSavedAt, host, lineCount, mode, narrow, previewError, previewHtml, tab,
      textarea, text,
      onInput: (event) => applyText(event.target.value)
    };
  },

  template: `
<div class="ee-editor">
  <div class="ee-editor__bar">
    <Tabs v-if="narrow" v-model="tab" :items="[{ key: 'edit', label: '编辑' }, { key: 'preview', label: '预览' }]" />
    <span class="ee-editor__meta">{{ charCount }} 字 · {{ lineCount }} 行</span>
    <span v-if="draftSavedAt" class="ee-editor__meta">草稿已自动保存 {{ draftSavedAt }}</span>
  </div>

  <div class="ee-editor__panes" :class="{ 'ee-editor__panes--narrow': narrow }">
    <div v-show="!narrow || tab === 'edit'" class="ee-editor__pane">
      <div ref="host" v-show="mode === 'toastui'" class="ee-editor__toastui"></div>
      <textarea
        v-if="mode === 'plain'"
        ref="textarea"
        class="ee-editor__textarea"
        :value="text"
        spellcheck="false"
        placeholder="正文（Markdown）"
        @input="onInput"
      ></textarea>
    </div>
    <div v-show="!narrow || tab === 'preview'" class="ee-editor__pane ee-editor__pane--preview">
      <p v-if="previewError" class="ee-editor__error">{{ previewError }}</p>
      <div v-else class="ee-editor__preview" v-html="previewHtml"></div>
    </div>
  </div>
</div>
`
});
