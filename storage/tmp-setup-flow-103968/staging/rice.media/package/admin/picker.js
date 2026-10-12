/**
 * rice.media.picker —— 媒体选择器扩展点贡献（零构建纯 ESM）。
 *
 * 为什么单独一个文件：扩展点贡献不是"一个后台页面"，而是别的插件界面里的**一块面板**。
 * 它可能被同一个消费者挂载多次、也可能被卸载重挂，因此这里不存单例状态，
 * 也**不带外层对话框与标题** —— 容器（Dialog / 卡片）由消费者提供。
 *
 * 复用而非重写：上传与选库都直接调用媒体库页面的同一套接口
 * （`POST /media`，multipart 字段名 `file`；`GET /media?page=&pageSize=&keyword=`），
 * accept 白名单与体积上限口径与 `admin/main.js`、服务端 `ALLOWED_EXTENSIONS` 完全一致，
 * 避免出现"面板里传不上去、页面里能传"的分裂规则。
 */

import {
  api,
  computed,
  defineAdminContribution,
  formatBytes,
  onMounted,
  ref,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

/** 与 `admin/main.js` 的 accept、服务端 `ALLOWED_EXTENSIONS` 同一份白名单。 */
const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.pdf,.txt,.md,.zip';

/**
 * 体积上限**不在前端写死**：真实上限是插件设置项 `upload.maxFileBytes`
 * （默认 8MB，可被改成 1KB~64MB）。这里只提示口径，具体数值由服务端在超限时回传，
 * 前端再原样弹出 —— 规则只有一份，改设置不会让面板与实际校验脱节。
 */
const SIZE_HINT = '单个文件不能超过设置的上限（默认 8MB，可在「扩展中心 → 媒体库 → 设置」调整）';

/** 面板比整页窄，每页少放一些，避免把消费者的对话框撑高。 */
const PAGE_SIZE = 12;

/** 统一把接口错误转成可读文案（与媒体库页面同一口径）。 */
function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

export default defineAdminContribution({
  name: 'media-picker',

  /* 与扩展点声明一一对应的消费字段（宿主契约）。 */
  props: ['onPick'],

  setup(props, context) {
    const toast = useToast();

    /*
     * 为什么还留着 `ctx.attrs`：`props: ['onPick']` 声明之后，Vue 才会把 context 里的
     * onPick 解析成 props（只声明过的字段才进 setup 第一个参数）；`attrs` 只是兜底 ——
     * 兼容"未声明 props 的旧式宿主"，那时 context 会全部落在 attrs 上。
     */
    const attrs = (context && context.attrs) || {};

    /** 取消费者传入的 onPick；非函数一律当"没提供"。 */
    function handler() {
      const candidate = (props && props.onPick) || attrs.onPick;
      return typeof candidate === 'function' ? candidate : null;
    }

    /*
     * 只读场景（例如被放在预览/回显里）不会传 onPick：此时隐藏「插入」按钮而不是报错 ——
     * 组件剩下的浏览与搜索能力依然是可用的。
     */
    const canPick = computed(() => handler() !== null);

    const tab = ref('upload');
    const tabs = [
      { key: 'upload', label: '上传新文件' },
      { key: 'library', label: '从媒体库选择' }
    ];

    /* ------------------------------ 上传页签 ------------------------------ */

    const fileInput = ref(null);
    const uploading = ref(false);
    const uploadedName = ref('');

    function chooseFile() {
      if (fileInput.value) fileInput.value.click();
    }

    async function onFileChange(event) {
      const input = event.target;
      const file = input.files && input.files[0];
      if (!file) return;

      uploadedName.value = `${file.name} · ${formatBytes(file.size)}`;
      uploading.value = true;
      try {
        const formData = new FormData();
        formData.append('file', file); // 字段名与媒体库页面、服务端一致
        const created = await api.upload('/media', formData);
        toast.success(`已上传 ${created.fileName}`);
        // 上传成功后切到列表并把新文件设为选中项：由用户点「插入」确认，
        // 避免"手滑选中一个文件就被静默插入"
        keyword.value = '';
        page.value = 1;
        tab.value = 'library';
        await load();
        selectById(created.id, created);
      } catch (error) {
        // 类型不符 / 超出体积等文案都由服务端给出（含真实上限），此处不另写一套规则
        toast.error(messageOf(error, '上传失败'));
      } finally {
        uploading.value = false;
        input.value = ''; // 清空 input，允许重复选择同一个文件
      }
    }

    /* ------------------------------ 选库页签 ------------------------------ */

    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const keyword = ref('');
    const loading = ref(false);
    const selected = ref(null);

    /** 用 computed 而不是 setup 期算一次：加载完 total 变化后分页条要能真正出现。 */
    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

    async function load() {
      loading.value = true;
      try {
        const query = new URLSearchParams({ page: String(page.value), pageSize: String(PAGE_SIZE) });
        const trimmed = keyword.value.trim();
        if (trimmed) query.set('keyword', trimmed);
        const response = await api.list(`/media?${query.toString()}`);
        items.value = response.data;
        total.value = response.total;
      } catch (error) {
        toast.error(messageOf(error, '媒体列表加载失败'));
      } finally {
        loading.value = false;
      }
    }

    function search() {
      page.value = 1;
      load();
    }

    function go(target) {
      const next = Math.min(Math.max(1, target), totalPages.value);
      if (next === page.value) return;
      page.value = next;
      load();
    }

    /** 点卡片选中；再点一次取消（消费者可能想清空选择）。 */
    function toggle(media) {
      selected.value = selected.value && selected.value.id === media.id ? null : media;
    }

    /** 让某条媒体成为选中项：优先用列表里的最新记录，列表没有（例如不在当前页）就用传入的兜底。 */
    function selectById(id, fallback) {
      const found = items.value.find((item) => item.id === id);
      selected.value = found || fallback || null;
    }

    /** 回调契约：只传消费者需要的四项（见 manifest 的 extensionPoints[].props）。 */
    function insert() {
      const target = selected.value;
      const onPick = handler();
      if (!target || !onPick) return;
      onPick({
        url: target.url,
        fileName: target.fileName,
        mimeType: target.mimeType,
        size: target.size
      });
      toast.success(`已选择 ${target.fileName}`);
    }

    onMounted(load);

    return {
      ACCEPT,
      SIZE_HINT,
      canPick,
      chooseFile,
      fileInput,
      formatBytes,
      go,
      insert,
      items,
      keyword,
      loading,
      onFileChange,
      page,
      search,
      selectById,
      selected,
      tab,
      tabs,
      toggle,
      total,
      totalPages,
      uploadedName,
      uploading
    };
  },

  template: `
<div class="flex flex-col gap-3">
  <Tabs v-model="tab" :items="tabs" />

  <!-- 上传页签：外层只给 1px 细边框，无阴影、无毛玻璃 -->
  <div v-if="tab === 'upload'" class="rounded-lg border border-border p-4">
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="ACCEPT"
      @change="onFileChange"
    >
    <div class="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
      <Icon name="upload" class="h-6 w-6 text-muted-foreground" />
      <p class="text-sm text-foreground">选择要上传的文件</p>
      <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">{{ SIZE_HINT }}</p>
      <Button :loading="uploading" @click="chooseFile">选择文件</Button>
      <p v-if="uploadedName" class="text-xs text-muted-foreground">已选：{{ uploadedName }}</p>
    </div>
  </div>

  <!-- 选库页签：搜索 + 网格 + 分页，写法与媒体库页面一致 -->
  <div v-else class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-[12rem] flex-1">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="按文件名搜索" @enter="search" />
      </div>
      <Button variant="outline" :loading="loading" @click="search">查询</Button>
    </div>

    <LoadingState v-if="loading && !items.length" :block="false" />

    <div v-else-if="items.length" class="grid max-h-80 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
      <button
        v-for="media in items"
        :key="media.id"
        type="button"
        class="overflow-hidden rounded-lg border text-left transition-colors"
        :class="selected && selected.id === media.id ? 'border-primary bg-accent' : 'border-border hover:bg-muted/40'"
        @click="toggle(media)"
      >
        <span class="flex h-24 items-center justify-center border-b border-border bg-muted/40">
          <img
            v-if="media.mimeType.startsWith('image/')"
            :src="media.url"
            :alt="media.alt || media.fileName"
            class="h-full w-full object-cover"
            loading="lazy"
          />
          <Icon v-else name="image" class="h-6 w-6 text-muted-foreground" />
        </span>
        <span class="block p-2">
          <span class="block truncate text-xs text-foreground" :title="media.fileName">{{ media.fileName }}</span>
          <span class="mt-0.5 block text-[11px] text-muted-foreground">{{ formatBytes(media.size) }}</span>
        </span>
      </button>
    </div>

    <EmptyState v-else title="媒体库为空" description="切换到「上传新文件」上传一个，或换个关键词搜索。" />

    <div v-if="totalPages > 1" class="flex items-center justify-between">
      <span class="text-xs text-muted-foreground">共 {{ total }} 个 · 第 {{ page }} / {{ totalPages }} 页</span>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" :disabled="page <= 1" @click="go(page - 1)">上一页</Button>
        <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="go(page + 1)">下一页</Button>
      </div>
    </div>
  </div>

  <!-- 没有 onPick（只读预览）时整条底栏不出现：不报错，也不给一个按了没反应的按钮 -->
  <div v-if="canPick" class="flex items-center justify-between gap-3 border-t border-border pt-3">
    <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
      {{ selected ? '已选择：' + selected.fileName : '尚未选择文件' }}
    </p>
    <Button :disabled="!selected" @click="insert">插入</Button>
  </div>
</div>
`
});
