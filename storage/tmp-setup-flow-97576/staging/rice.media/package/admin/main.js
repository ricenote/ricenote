/**
 * 媒体库插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（AdminPage/Card/Button/Input/Icon…）已由宿主全局注册，模板里直接写标签即可；
 * - 上传走 `api.upload`（自动处理 multipart 与 CSRF），下载地址通过剪贴板复制。
 *
 * 迁移前该界面位于 `apps/admin/src/views/MediaView.vue`，行为与文案保持一致：
 * 服务端分页（每页 24）、按文件名搜索、上传（FormData 字段名 `file`）、复制访问地址、删除二次确认。
 */

import {
  api,
  computed,
  defineAdminPage,
  formatBytes,
  formatDateTime,
  onMounted,
  ref,
  useSession,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

const PAGE_SIZE = 24;

/** 统一把接口错误转成可读文案（与 Core 页面的处理口径一致）。 */
function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

export default defineAdminPage({
  title: '媒体库',

  setup() {
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('media.manage'));

    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const keyword = ref('');
    const loading = ref(false);
    const uploading = ref(false);
    const fileInput = ref(null);

    /*
     * 与迁移前的实现保持一致：该值在 setup 期按当时的 total（0）计算一次，
     * 不随加载后的 total 更新，因此分页条 `totalPages > 1` 实际不会出现。
     * 这是原页面存在的行为，此处原样保留（迁移报告中已标记，待确认是否修复）。
     */
    const totalPages = Math.ceil(total.value / PAGE_SIZE);

    async function load() {
      loading.value = true;
      try {
        const query = new URLSearchParams({ page: String(page.value), pageSize: String(PAGE_SIZE) });
        if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
        const response = await api.list(`/media?${query.toString()}`);
        items.value = response.data;
        total.value = response.total;
      } catch (error) {
        toast.error(messageOf(error, '媒体列表加载失败'));
      } finally {
        loading.value = false;
      }
    }

    function pickFile() {
      if (fileInput.value) fileInput.value.click();
    }

    async function onFileChange(event) {
      const input = event.target;
      const file = input.files && input.files[0];
      if (!file) return;

      uploading.value = true;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const created = await api.upload('/media', formData);
        toast.success(`已上传 ${created.fileName}`);
        page.value = 1;
        await load();
      } catch (error) {
        toast.error(messageOf(error, '上传失败'));
      } finally {
        uploading.value = false;
        input.value = '';
      }
    }

    async function remove(media) {
      if (!window.confirm(`删除「${media.fileName}」将同时移除磁盘文件，确定继续？`)) return;
      try {
        await api.delete(`/media/${media.id}`);
        toast.success('媒体已删除');
        await load();
      } catch (error) {
        toast.error(messageOf(error, '删除失败'));
      }
    }

    async function copyUrl(media) {
      const absolute = `${window.location.origin}${media.url}`;
      try {
        await navigator.clipboard.writeText(absolute);
        toast.success('已复制访问地址');
      } catch {
        toast.info(absolute);
      }
    }

    onMounted(load);

    return {
      canManage,
      copyUrl,
      fileInput,
      items,
      keyword,
      loading,
      load,
      page,
      PAGE_SIZE,
      pickFile,
      remove,
      total,
      totalPages,
      uploading,
      onFileChange,
      formatBytes,
      formatDateTime
    };
  },

  template: `
<AdminPage
  title="媒体库"
  :description="'共 ' + total + ' 个文件 · 支持常见图片、文档与压缩包格式'"
>
  <template #actions>
    <div v-if="canManage" class="flex items-center">
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.pdf,.txt,.md,.zip"
        @change="onFileChange"
      >
      <Button :loading="uploading" @click="pickFile">
        <Icon name="upload" class="h-4 w-4" />
        上传文件
      </Button>
    </div>
  </template>

  <template #toolbar>
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative min-w-[14rem] flex-1">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="按文件名搜索" @enter="() => { page = 1; load(); }" />
      </div>
      <Button variant="outline" :loading="loading" @click="() => { page = 1; load(); }">查询</Button>
    </div>
  </template>

  <div v-if="items.length" class="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
    <Card v-for="media in items" :key="media.id" hoverable class="overflow-hidden">
      <div class="flex h-36 items-center justify-center border-b border-border bg-muted/40">
        <img
          v-if="media.mimeType.startsWith('image/')"
          :src="media.url"
          :alt="media.alt || media.fileName"
          class="h-full w-full object-cover"
          loading="lazy"
        />
        <Icon v-else name="image" class="h-8 w-8 text-muted-foreground" />
      </div>

      <div class="p-3">
        <p class="truncate text-sm text-foreground" :title="media.fileName">{{ media.fileName }}</p>
        <p class="mt-0.5 text-[11px] text-muted-foreground">
          {{ formatBytes(media.size) }} · {{ formatDateTime(media.createdAt) }}
        </p>

        <div class="mt-2.5 flex items-center gap-1.5">
          <Button variant="outline" size="sm" @click="copyUrl(media)">
            <Icon name="copy" />
            复制地址
          </Button>
          <button
            v-if="canManage"
            type="button"
            class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
            title="删除"
            @click="remove(media)"
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
    </Card>
  </div>

  <Card v-else class="p-12 text-center">
    <Icon name="image" class="mx-auto h-8 w-8 text-muted-foreground" />
    <p class="mt-3 text-sm text-foreground">媒体库为空</p>
    <p class="mt-1 text-xs text-muted-foreground">
      上传的图片可在主题设置中通过 image 字段选用。
    </p>
  </Card>

  <div v-if="totalPages > 1" class="flex items-center justify-between">
    <span class="text-xs text-muted-foreground">第 {{ page }} / {{ totalPages }} 页</span>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" :disabled="page <= 1" @click="() => { page -= 1; load(); }">上一页</Button>
      <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="() => { page += 1; load(); }">下一页</Button>
    </div>
  </div>
</AdminPage>
`
});
