/**
 * 文章插件的后台列表页（零构建）。
 *
 * 职责：服务端分页（每页 10）、状态筛选、关键词搜索、删除，以及跳转到**独立编辑页**。
 * 编辑表单已迁至 `admin/editor.js`（隐藏路由 `/posts/editor`），本页不再内嵌对话框。
 *
 * 「新建」按钮位于命名扩展点 `rice.posts.listActions` 的默认内容里：
 * 没有贡献插件时它就是现在这个按钮，行为与此前完全一致。
 */

import {
  api,
  computed,
  defineAdminPage,
  formatDateTime,
  onMounted,
  ref,
  useRouter,
  useSession,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

const PAGE_SIZE = 10;

const STATUS_LABELS = { published: '已发布', draft: '草稿', archived: '已归档' };

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '已发布', value: 'published' },
  { label: '草稿', value: 'draft' },
  { label: '已归档', value: 'archived' }
];

function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

export default defineAdminPage({
  title: '文章',

  setup() {
    const session = useSession();
    const toast = useToast();
    const router = useRouter();

    const canWrite = computed(() => session.can('post.write'));
    const canDelete = computed(() => session.can('post.delete'));

    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const statusFilter = ref('all');
    const keyword = ref('');
    const loading = ref(false);

    const columns = [
      { key: 'title', label: '标题' },
      { key: 'status', label: '状态', width: 'w-32' },
      { key: 'terms', label: '词条', width: 'w-40', hideBelow: 'md' },
      { key: 'updatedAt', label: '更新时间', width: 'w-40', hideBelow: 'lg' },
      { key: 'actions', label: '操作', width: 'w-28', align: 'right' }
    ];

    function statusVariant(status) {
      if (status === 'published') return 'success';
      return status === 'draft' ? 'muted' : 'outline';
    }

    async function load() {
      loading.value = true;
      try {
        const query = new URLSearchParams({
          page: String(page.value),
          pageSize: String(PAGE_SIZE),
          status: statusFilter.value
        });
        if (keyword.value.trim()) query.set('keyword', keyword.value.trim());

        const response = await api.list(`/posts?${query.toString()}`);
        items.value = response.data;
        total.value = response.total;
      } catch (error) {
        toast.error(messageOf(error, '文章列表加载失败'));
      } finally {
        loading.value = false;
      }
    }

    function search() {
      page.value = 1;
      void load();
    }

    function changePage(next) {
      page.value = next;
      void load();
    }

    /** 新建：跳转到独立编辑页（隐藏路由，深链可用）。 */
    function create() {
      router.push('/posts/editor');
    }

    /** 编辑：带上 id 跳到编辑页并回填。 */
    function edit(id) {
      router.push(`/posts/editor?id=${id}`);
    }

    async function remove(post) {
      if (!window.confirm(`确定删除《${post.title}》？该操作不可撤销。`)) return;
      try {
        await api.delete(`/posts/${post.id}`);
        toast.success('文章已删除');
        await load();
      } catch (error) {
        toast.error(messageOf(error, '删除失败'));
      }
    }

    onMounted(load);

    return {
      canDelete,
      canWrite,
      changePage,
      columns,
      create,
      edit,
      items,
      keyword,
      load,
      loading,
      page,
      remove,
      search,
      statusFilter,
      statusLabels: STATUS_LABELS,
      statusOptions: STATUS_OPTIONS,
      statusVariant,
      total,
      PAGE_SIZE,
      formatDateTime
    };
  },

  template: `
<AdminPage
  title="文章"
  :description="'共 ' + total + ' 篇'"
>
  <template #actions>
    <PluginSlot name="rice.posts.listActions" :context="{ kind: 'post' }">
      <Button v-if="canWrite" @click="create">
        <Icon name="plus" />
        新建文章
      </Button>
    </PluginSlot>
  </template>

  <template #toolbar>
    <div class="flex flex-wrap items-center gap-3">
      <div class="w-40">
        <Select :model-value="statusFilter" :options="statusOptions"
          @update:model-value="(value) => { statusFilter = value; search(); }" />
      </div>
      <div class="relative min-w-[14rem] flex-1">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="搜索标题或路径" @enter="search" />
      </div>
      <Button variant="outline" :loading="loading" @click="search">查询</Button>
    </div>
  </template>

  <DataTable :columns="columns" :rows="items" :loading="loading" row-key="id"
    thead-class="bg-muted/50"
    empty-title="暂无文章"
    empty-description="点击右上角「新建文章」开始写作。">
    <template #cell-title="{ row }">
      <p class="font-medium text-foreground">{{ row.title }}</p>
      <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">/post/{{ row.slug }}</p>
    </template>

    <template #cell-status="{ row }">
      <Badge :variant="statusVariant(row.status)">{{ statusLabels[row.status] }}</Badge>
    </template>

    <template #cell-terms="{ row }">
      <div class="flex flex-wrap gap-1">
        <Badge v-for="term in row.terms" :key="term.id" variant="outline">{{ term.name }}</Badge>
        <span v-if="row.terms.length === 0" class="text-xs text-muted-foreground">—</span>
      </div>
    </template>

    <template #cell-updatedAt="{ row }">
      <span class="text-xs text-muted-foreground">{{ formatDateTime(row.updatedAt) }}</span>
    </template>

    <template #cell-actions="{ row }">
      <div class="flex items-center justify-end gap-1">
        <a v-if="row.status === 'published'" :href="'/post/' + row.slug" target="_blank" rel="noopener"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="查看页面">
          <Icon name="eye" />
        </a>
        <button v-if="canWrite" type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="编辑" @click="edit(row.id)">
          <Icon name="pencil" />
        </button>
        <button v-if="canDelete" type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          title="删除" @click="remove(row)">
          <Icon name="trash" />
        </button>
      </div>
    </template>
  </DataTable>

  <div v-if="total > PAGE_SIZE" class="px-1">
    <Pagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="changePage" />
  </div>
</AdminPage>
`
});
