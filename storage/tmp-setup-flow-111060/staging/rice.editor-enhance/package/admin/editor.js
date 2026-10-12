/**
 * rice.posts.editorBody / rice.pages.editorBody —— Markdown 正文编辑器（mode: replace）。
 *
 * replace 语义：提供方默认只是普通多行文本域，我们整体换成带实时预览的编辑器；
 * 停用即回退默认。默认启用 `admin/vendor/` 里的 Toast UI（自带工具栏 + 竖向预览，独占整栏）；
 * vendor 缺失 / 注入失败时降级为 textarea + 右栏服务端预览（走 onPreview()，与前台一致）。
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
  useToast,
  watch
} from '/admin-sdk/v1/ricenote-admin.js';
import { clearActiveEditor, setActiveEditor } from './bridge.js';
import { createToastEditor, destroyToastEditor, loadToastUi } from './toastui.js';

const DRAFT_DEBOUNCE_MS = 800; // 太小频繁写 localStorage，太大则崩溃时丢字
const PREVIEW_DEBOUNCE_MS = 400; // 比草稿短，让"边写边看"跟得上
const NARROW_QUERY = '(max-width: 900px)'; // 与 editor.css 的布局切换断点一致

/** 草稿键含 kind：文章与页面各存一份，互不覆盖。 */
function draftKey(kind) {
  return `editor-enhance:draft:${kind === 'page' ? 'page' : 'post'}`;
}

export default defineAdminContribution({
  name: 'editor-enhance:body',
  /* 与提供方扩展点声明的字段一一对应；少一个就读不到 context。 */
  props: ['kind', 'value', 'onChange', 'onPreview'],
  setup(props) {
    const toast = useToast();
    const host = ref(null); // Toast UI 挂载容器（仅 toastui 模式存在）
    const textarea = ref(null);
    const text = ref(typeof props.value === 'string' ? props.value : '');
    /**
     * 'loading' → 'toastui' | 'plain'。
     * 起始就是 loading：**不先渲染 plain 文本域再替换**（会闪一下并在替换瞬间丢焦点），
     * 拉 vendor 期间只显示等高占位。
     */
    const mode = ref('loading');
    const narrow = ref(false);
    const tab = ref('edit');
    const previewHtml = ref('');
    const previewError = ref('');
    const draftSavedAt = ref('');
    /** Toast 光标位置（1 起算）；null = 公开 API 拿不到 → 状态栏只报行数。 */
    const caret = ref(null);

    /** 字数不含空白：与"中文字数"的直觉一致（标点保留）。 */
    const charCount = computed(() => text.value.replace(/\s/g, '').length);
    const lineCount = computed(() => (text.value ? text.value.split('\n').length : 0));
    /**
     * 窄屏把预览折为标签页 —— **只在 plain 模式生效**：Toast 自带竖向预览，
     * 再叠一层"折叠预览"会变成双预览。见 editor.css 的 `.ee-editor__panes--narrow`。
     */
    const tabbed = computed(() => narrow.value && mode.value === 'plain');

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
        // 健壮性：提供方可能"自己弹框/自己处理"而返回 undefined 或空串 —— 安静留空，不报错。
        previewHtml.value = typeof html === 'string' ? html : ''; // 已消毒，可安全 v-html
        previewError.value = '';
      } catch (error) {
        previewError.value = error && error.message ? error.message : '预览渲染失败';
      }
    }

    function schedulePreview() {
      // Toast 独占整栏时右栏预览不存在（见模板 v-if），别再为它反复发预览请求。
      // 加载期（mode === 'loading'）照常维护：万一随后降级，右栏要有现成内容。
      if (mode.value === 'toastui') return;
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
        // 公开 API：按钮点击抢走了焦点，先把焦点还给编辑器（光标回上次位置）再插到光标处。
        toastEditor.focus();
        toastEditor.insertText(value);
        return true;
      }
      const el = textarea.value;
      if (!el || typeof el.selectionStart !== 'number') return false;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      applyText(text.value.slice(0, start) + value + text.value.slice(end));
      const caretAt = start + value.length;
      nextTick(() => {
        el.focus();
        el.setSelectionRange(caretAt, caretAt);
      });
      return true;
    }

    const handle = { insertAtCursor };

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

      const Editor = await loadToastUi(); // 期间界面停在「正在加载编辑器…」占位
      if (!Editor) {
        // 未 vendor / 注入失败：回落文本域 + 右栏服务端预览，功能不缺失
        mode.value = 'plain';
        return;
      }

      // **先切状态让 host 可见，再挂实例**：Toast 的 height:'100%' 量的是容器实际
      // 高度，display:none 的容器量出来是 0，编辑器会塌成一条线。
      mode.value = 'toastui';
      await nextTick();
      const el = host.value;
      if (!el) return; // 拉 vendor 期间组件已被卸载：不再挂载，也别报"初始化失败"
      toastEditor = createToastEditor(Editor, {
        el,
        value: text.value,
        onChange: (markdown) => {
          // 同值不回传：程序化 setMarkdown 也会派发 change，靠这一行断开
          // "外部同步 → change → 再回传宿主"的回环
          if (markdown === text.value) return;
          applyText(markdown);
        },
        onCaret: (next) => { caret.value = next; },
        onImageRejected: () => {
          toast.info('请使用编辑器上方的「插入图片」：从媒体库选择，或直接填写相对地址');
        }
      });
      if (!toastEditor) mode.value = 'plain'; // 初始化失败必须保留 textarea 路径
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
      destroyToastEditor(toastEditor);
      toastEditor = null;
    });

    // 宿主重置表单（例如切换文章）时同步进编辑器；同值不处理，避免与输入形成回环
    watch(
      () => props.value,
      (next) => {
        const value = typeof next === 'string' ? next : '';
        if (value === text.value) return;
        text.value = value;
        caret.value = null; // 正文被整体替换，旧光标位置已失效
        if (toastEditor && toastEditor.getMarkdown() !== value) {
          /**
           * 第二参是 `cursorToEnd`：传 false = **不把光标强行甩到文末**（外部同步不是
           * 用户输入，甩光标会打断编辑）。setMarkdown 本身仍会派发一次 change，
           * 回环由 onChange 里的"同值不回传"兜住，两道保险。
           */
          toastEditor.setMarkdown(value, false);
        }
      }
    );

    return {
      caret, charCount, draftSavedAt, host, lineCount, mode, narrow, previewError,
      previewHtml, tab, tabbed, textarea, text,
      onInput: (event) => applyText(event.target.value)
    };
  },

  template: `
<div class="ee-editor">
  <div class="ee-editor__bar">
    <Tabs v-if="tabbed" v-model="tab" :items="[{ key: 'edit', label: '编辑' }, { key: 'preview', label: '预览' }]" />
    <span class="ee-editor__meta">
      {{ charCount }} 字 ·
      <template v-if="caret">第 {{ caret.line }} 行 {{ caret.col }} 列</template>
      <template v-else>{{ lineCount }} 行</template>
    </span>
    <span v-if="draftSavedAt" class="ee-editor__meta">草稿已自动保存 {{ draftSavedAt }}</span>
  </div>

  <!-- 右栏服务端预览只在 plain 模式存在：Toast 自带竖向预览已满足"编辑+预览双栏"，
       再挂一列会变三栏且重复。「与前台一致的权威预览」由上方工具栏的「前台预览」按钮负责。 -->
  <div class="ee-editor__panes" :class="{ 'ee-editor__panes--narrow': tabbed, 'ee-editor__panes--single': mode !== 'plain' }">
    <div v-show="!tabbed || tab === 'edit'" class="ee-editor__pane">
      <div v-if="mode === 'loading'" class="ee-editor__loading">正在加载编辑器…</div>
      <div v-if="mode === 'toastui'" ref="host" class="ee-editor__toastui"></div>
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
    <div v-if="mode === 'plain'" class="ee-editor__pane ee-editor__pane--preview">
      <p v-if="previewError" class="ee-editor__error">{{ previewError }}</p>
      <div v-else class="ee-editor__preview" v-html="previewHtml"></div>
    </div>
  </div>
</div>
`
});
