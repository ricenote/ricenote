/**
 * rice.posts.editorToolbar / rice.pages.editorToolbar —— 编辑工具栏（mode: append）。
 *
 * 为什么是 append：提供方（posts / pages 编辑页）自己的工具栏默认是空的，
 * 我们的两个按钮只是"追加"，即使本插件被停用也不影响编辑器默认内容。
 *
 * 两个按钮：
 * 1. 「前台预览」：`props.onPreview()` 拿到**服务端渲染管线**产出、已消毒的 HTML，
 *    用宿主的 <Dialog> 展示 —— 与前台看到的完全一致（同一套渲染与消毒规则）；
 * 2. 「插入图片」：把语法插到**光标处**（经 bridge.js）。图片选择复用媒体库的
 *    `rice.media.picker` 扩展点；媒体库未安装 / 权限不足时，PluginSlot 会渲染
 *    我们提供的默认内容（一行"直接填写图片链接"），功能不缺失。
 */

import {
  computed,
  defineAdminContribution,
  ref,
  useAdminExtensions,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';
import { insertAtCursor } from './bridge.js';

/** 统一把接口错误转成可读文案。 */
function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

/** 生成图片 Markdown；文件名里的方括号会破坏语法，先剥掉。 */
function imageMarkdown(url, fileName) {
  const label = String(fileName || '图片').replace(/[[\]]/g, '');
  return `![${label}](${String(url || '').trim()})`;
}

export default defineAdminContribution({
  name: 'editor-enhance:toolbar',

  /* 工具栏需要与正文同样的 context：kind 判断内容类型，onPreview 取预览 HTML，
     value/onChange 仅用于"桥不可用"时的降级追加。 */
  props: ['kind', 'value', 'onChange', 'onPreview'],

  setup(props) {
    const toast = useToast();

    /*
     * 媒体库以 replace 贡献该面板；replace 生效时 <PluginSlot> **不渲染默认内容**，
     * 插入由面板自己的「插入」按钮经 onPick 回调完成。此时底栏若再放一个
     * "直接填链接"的按钮，点了只会提示"请先填写地址" —— 所以按生效贡献是否存在隐藏它。
     */
    const extensions = useAdminExtensions();
    const pickerAvailable = computed(
      () => extensions.effectiveFor('rice.media.picker').length > 0
    );

    /* ------------------------------ 前台预览 ------------------------------ */

    const previewOpen = ref(false);
    const previewHtml = ref('');
    const previewLoading = ref(false);

    /**
     * 先取 HTML 再决定是否弹框。
     *
     * 为什么"拿到非空字符串才弹"：提供方是第三方插件，契约只能约束我们自己的两个插件。
     * 若某个提供方选择"自己弹框/自己处理"（返回 undefined 或空串），消费方应当**安静降级**
     * —— 既不报错，也不弹一个空对话框。
     */
    async function openPreview() {
      if (typeof props.onPreview !== 'function') {
        toast.error('当前编辑页未提供预览能力');
        return;
      }
      if (previewLoading.value) return; // 防连点
      previewLoading.value = true;
      try {
        const html = await props.onPreview();
        if (typeof html !== 'string' || html.trim() === '') return; // 安静降级：不弹空框
        previewHtml.value = html; // 已由服务端消毒，故可安全地 v-html
        previewOpen.value = true;
      } catch (error) {
        // 异步失败一律转 Toast：抛到渲染层会让整个工具栏被错误边界静默吞掉
        toast.error(messageOf(error, '预览渲染失败'));
      } finally {
        previewLoading.value = false;
      }
    }

    /* ------------------------------ 插入图片 ------------------------------ */

    const imageOpen = ref(false);
    const link = ref('');

    function openImage() {
      link.value = '';
      imageOpen.value = true;
    }

    /**
     * 统一的插入出口。
     *
     * 优先经 bridge.js 插到**光标处**；桥为空（正文贡献被停用 / 编辑器未挂载）时
     * 降级为"追加到宿主 value 末尾" —— 这是无桥时唯一能做的事，位置会与光标不符，
     * 因此返回值区分 'cursor' / 'appended' / false，调用方据此提示用户。
     */
    function insert(snippet) {
      if (insertAtCursor(snippet)) return 'cursor';
      if (typeof props.onChange !== 'function') return false;
      const base = typeof props.value === 'string' ? props.value : '';
      props.onChange(base ? `${base}\n${snippet}` : snippet);
      return 'appended';
    }

    function report(result, pickedName) {
      if (result === false) {
        toast.error('当前无法写入正文');
        return;
      }
      if (result === 'appended') toast.info('编辑器未接管正文，图片语法已追加到正文末尾');
      else toast.success(pickedName ? `已插入 ${pickedName}` : '已插入图片');
      imageOpen.value = false;
    }

    /**
     * 媒体库面板的选中回调（契约严格为 `onPick({ url, fileName, mimeType, size })`）。
     *
     * `url` 是**相对地址**（形如 `/media/12`）：原样插入 Markdown，绝不拼 origin/前缀 ——
     * 换域名或换端口后相对地址依然正确，拼了反而会写死到内容里。
     * 另外：面板只负责选/传，既不会替我们关对话框，也不会"上传即回填"，
     * 因此收尾（插入 + 关闭）都在这里做。
     */
    function onPicked(picked) {
      if (!picked || !picked.url) return;
      report(insert(imageMarkdown(picked.url, picked.fileName)), picked.fileName);
    }

    /** 默认内容路径：未装媒体库或权限不足时，用户直接填写图片地址。 */
    function confirmLink() {
      const url = link.value.trim();
      if (!url) {
        toast.warning('请先选择或填写图片地址');
        return;
      }
      report(insert(imageMarkdown(url, '')), '');
    }

    return {
      confirmLink,
      imageOpen,
      link,
      onPicked,
      openImage,
      openPreview,
      pickerAvailable,
      previewHtml,
      previewLoading,
      previewOpen
    };
  },

  template: `
<div class="flex flex-wrap items-center gap-2">
  <Button
    variant="outline"
    size="sm"
    :loading="previewLoading"
    :disabled="previewLoading"
    @click="openPreview"
  >
    <Icon name="eye" class="h-3.5 w-3.5" />
    前台预览
  </Button>
  <Button variant="outline" size="sm" @click="openImage">
    <Icon name="image" class="h-3.5 w-3.5" />
    插入图片
  </Button>

  <!-- 只有拿到非空 HTML 时 openPreview 才会置 open，因此这里不必再判空 -->
  <Dialog
    v-model:open="previewOpen"
    title="前台预览"
    description="与前台渲染一致：同一套服务端渲染管线，输出前统一消毒。"
    width="lg"
  >
    <div class="max-h-[60vh] overflow-y-auto text-sm leading-relaxed" v-html="previewHtml"></div>
  </Dialog>

  <Dialog
    v-model:open="imageOpen"
    title="插入图片"
    description="从媒体库选择，或直接填写图片地址（未安装媒体库时即为此输入框）。"
    width="lg"
  >
    <PluginSlot name="rice.media.picker" :context="{ onPick: onPicked }">
      <!-- 默认内容 = 媒体库不可用（未装 / 无权限 / 被停用）时的降级路径：
           一行直接填地址，功能不缺失。replace 生效时这块不会渲染，
           插入由面板自己的按钮经 onPick 完成。 -->
      <div class="flex flex-col gap-2">
        <Input v-model="link" placeholder="https://…" />
        <p class="text-xs text-muted-foreground">尚未选择图片：可直接填写图片地址（例 /media/12）。</p>
      </div>
    </PluginSlot>

    <template #footer>
      <Button variant="ghost" @click="imageOpen = false">取消</Button>
      <!-- 面板已接管时隐藏：否则它按的是未渲染的空 input，只会提示"请先填写" -->
      <Button v-if="!pickerAvailable" @click="confirmLink">插入</Button>
    </template>
  </Dialog>
</div>
`
});
