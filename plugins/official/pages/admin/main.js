/**
 * 页面插件的后台界面（零构建）。
 *
 * 迁移前位于 `apps/admin/src/views/PagesView.vue`。
 *
 * 本页只负责**列表与筛选**：「新建 / 编辑」都跳到独立编辑页
 * （`admin/editor.js`，路由 `/pages/editor`，manifest 里 `hidden: true` 故不进侧栏）。
 * 为什么不再用弹出对话框编辑：正文区需要占满视口，还要容纳外部插件贡献的
 * 工具栏与编辑器（`rice.pages.editorToolbar` / `rice.pages.editorBody`），
 * 塞进弹窗既放不下，也让"未保存离开保护"变得难以表达。
 */

import {
  api,
  computed,
  defineAdminPage,
  onMounted,
  ref,
  useRouter,
  useSession,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

const STATUS_LABELS = { published: '已发布', draft: '草稿' };
const STATUS_TONES = { published: 'success', draft: 'muted' };

function messageOf(error) {
  return error && error.message ? error.message : '操作失败，请稍后重试';
}

export default defineAdminPage({
  title: '页面',

  setup() {
    const router = useRouter();
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('page.manage'));

    const items = ref([]);
    const total = ref(0);
    const loading = ref(false);
    const statusFilter = ref('all');
    const keyword = ref('');

    const columns = [
      { key: 'title', label: '标题' },
      { key: 'slug', label: '地址', width: 'w-40', hideBelow: 'md' },
      { key: 'template', label: '页面模板', width: 'w-36', hideBelow: 'lg' },
      { key: 'status', label: '状态', width: 'w-24' },
      { key: 'updatedAt', label: '更新时间', width: 'w-40', hideBelow: 'lg' },
      { key: 'actions', label: '操作', width: 'w-32' }
    ];

    async function load() {
      loading.value = true;
      try {
        const query = new URLSearchParams({ pageSize: '50' });
        if (statusFilter.value !== 'all') query.set('status', statusFilter.value);
        if (keyword.value.trim()) query.set('keyword', keyword.value.trim());

        const response = await api.list(`/pages?${query.toString()}`);
        items.value = response.data;
        total.value = response.total;
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        loading.value = false;
      }
    }

    /** 新建：进入独立编辑页（不带 id）。 */
    function createPage() {
      void router.push('/pages/editor');
    }

    /** 编辑：把 id 放进 query，编辑页据此回填详情与内容字段。 */
    function editPage(row) {
      void router.push(`/pages/editor?id=${row.id}`);
    }

    async function remove(row) {
      if (!window.confirm(`确定删除页面「${row.title}」？该操作不可撤销。`)) return;
      try {
        await api.delete(`/pages/${row.id}`);
        toast.success('页面已删除');
        await load();
      } catch (error) {
        toast.error(messageOf(error));
      }
    }

    onMounted(load);

    return {
      canManage,
      columns,
      createPage,
      editPage,
      items,
      keyword,
      load,
      loading,
      remove,
      statusFilter,
      statusLabels: STATUS_LABELS,
      statusTones: STATUS_TONES,
      total
    };
  },

  template: `
<AdminPage
  title="页面"
  description="独立页面拥有自己的地址（/page/别名），可选择主题声明的页面模板；如需出现在前台导航栏，请在「导航栏」中引用它"
>
  <template #actions>
    <Button variant="outline" :loading="loading" @click="load">
      <Icon name="refresh" />
      刷新
    </Button>
    <!-- 列表级动作锚点：其它插件可在此追加动作，或用 replace 整体接管 -->
    <PluginSlot name="rice.pages.listActions" :context="{ kind: 'page' }">
      <Button v-if="canManage" @click="createPage">
        <Icon name="plus" />
        新建页面
      </Button>
    </PluginSlot>
  </template>

  <template #toolbar>
    <div class="flex flex-wrap items-center gap-3">
      <div class="w-40">
        <Select :model-value="statusFilter" :options="[
          { label: '全部状态', value: 'all' },
          { label: '已发布', value: 'published' },
          { label: '草稿', value: 'draft' }
        ]" @update:model-value="(value) => { statusFilter = value; load(); }" />
      </div>
      <div class="min-w-[12rem] flex-1">
        <Input v-model="keyword" placeholder="按标题或别名搜索" @enter="load" />
      </div>
      <Button variant="outline" @click="load">搜索</Button>
      <span class="ml-auto text-[11px] text-muted-foreground">共 {{ total }} 个页面</span>
    </div>
  </template>

  <DataTable :columns="columns" :rows="items" :loading="loading" row-key="id"
    empty-title="还没有页面"
    empty-description="用「新建页面」创建「关于本站」「联系方式」这类固定内容页面。">
    <template #cell-title="{ row }">
      <p class="text-sm font-medium text-foreground">{{ row.title }}</p>
      <p v-if="row.seoDescription" class="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
        {{ row.seoDescription }}
      </p>
    </template>

    <template #cell-slug="{ row }">
      <a class="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        :href="'/page/' + row.slug" target="_blank" rel="noopener">/page/{{ row.slug }}</a>
    </template>

    <template #cell-template="{ row }">
      <span class="text-xs text-muted-foreground">{{ row.template || '主题默认' }}</span>
    </template>

    <template #cell-status="{ row }">
      <Badge :variant="statusTones[row.status]">{{ statusLabels[row.status] }}</Badge>
    </template>

    <template #cell-updatedAt="{ row }">
      <span class="text-xs text-muted-foreground">{{ row.updatedAt }}</span>
    </template>

    <template #cell-actions="{ row }">
      <div class="flex items-center gap-1">
        <Button v-if="canManage" variant="ghost" size="sm" @click="editPage(row)">
          <Icon name="pencil" />
          编辑
        </Button>
        <Button v-if="canManage" variant="ghost" size="sm" @click="remove(row)">
          <Icon name="trash" />
          删除
        </Button>
      </div>
    </template>
  </DataTable>
</AdminPage>
`
});
