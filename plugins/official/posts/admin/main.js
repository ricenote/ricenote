/**
 * 文章插件的后台界面（零构建）。
 *
 * 迁移前位于 `apps/admin/src/views/PostsView.vue`，行为与文案保持一致：
 * 服务端分页（每页 10）、状态筛选、关键词搜索、Markdown 正文、词条多选、归档状态。
 */

import {
  api,
  computed,
  defineAdminPage,
  formatDateTime,
  onMounted,
  ref,
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

    const canWrite = computed(() => session.can('post.write'));
    const canPublish = computed(() => session.can('post.publish'));
    const canDelete = computed(() => session.can('post.delete'));

    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const statusFilter = ref('all');
    const keyword = ref('');
    const loading = ref(false);

    const terms = ref([]);

    const editorOpen = ref(false);
    const saving = ref(false);
    const editingId = ref(null);
    const form = ref({
      title: '',
      slug: '',
      content: '',
      excerpt: '',
      status: 'draft',
      termIds: []
    });

    const columns = [
      { key: 'title', label: '标题' },
      { key: 'status', label: '状态', width: 'w-32' },
      { key: 'terms', label: '词条', width: 'w-40', hideBelow: 'md' },
      { key: 'updatedAt', label: '更新时间', width: 'w-40', hideBelow: 'lg' },
      { key: 'actions', label: '操作', width: 'w-28', align: 'right' }
    ];

    const statusSelectOptions = computed(() => [
      { label: '草稿', value: 'draft' },
      {
        label: canPublish.value ? '直接发布' : '发布（需 post.publish 权限）',
        value: 'published'
      },
      { label: '归档', value: 'archived' }
    ]);

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

    async function loadTerms() {
      try {
        terms.value = await api.get('/terms');
      } catch {
        terms.value = [];
      }
    }

    function search() {
      page.value = 1;
      void load();
    }

    function resetForm() {
      editingId.value = null;
      form.value = { title: '', slug: '', content: '', excerpt: '', status: 'draft', termIds: [] };
    }

    function openCreate() {
      resetForm();
      editorOpen.value = true;
    }

    async function openEdit(id) {
      try {
        const detail = await api.get(`/posts/${id}`);
        editingId.value = detail.id;
        form.value = {
          title: detail.title,
          slug: detail.slug,
          content: detail.content,
          excerpt: detail.excerpt,
          status: detail.status,
          termIds: detail.terms.map((term) => term.id)
        };
        editorOpen.value = true;
      } catch (error) {
        toast.error(messageOf(error, '文章加载失败'));
      }
    }

    async function save() {
      if (!form.value.title.trim()) {
        toast.warning('标题不能为空');
        return;
      }

      saving.value = true;
      try {
        const payload = {
          title: form.value.title.trim(),
          slug: form.value.slug.trim() || undefined,
          content: form.value.content,
          excerpt: form.value.excerpt.trim(),
          status: form.value.status,
          termIds: form.value.termIds
        };

        if (editingId.value) {
          await api.put(`/posts/${editingId.value}`, payload);
          toast.success('文章已更新');
        } else {
          await api.post('/posts', payload);
          toast.success(form.value.status === 'published' ? '文章已发布' : '草稿已保存');
        }

        editorOpen.value = false;
        await load();
      } catch (error) {
        toast.error(messageOf(error, '保存失败'));
      } finally {
        saving.value = false;
      }
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

    function toggleTerm(termId) {
      const index = form.value.termIds.indexOf(termId);
      if (index >= 0) form.value.termIds.splice(index, 1);
      else form.value.termIds.push(termId);
    }

    function isTermSelected(termId) {
      return form.value.termIds.includes(termId);
    }

    function termClass(termId) {
      return isTermSelected(termId)
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-border bg-card text-muted-foreground hover:bg-muted';
    }

    function changePage(next) {
      page.value = next;
      void load();
    }

    onMounted(async () => {
      await Promise.all([load(), loadTerms()]);
    });

    return {
      canDelete,
      canPublish,
      canWrite,
      changePage,
      columns,
      editorOpen,
      editingId,
      form,
      isTermSelected,
      items,
      keyword,
      load,
      loading,
      openCreate,
      openEdit,
      page,
      remove,
      saving,
      search,
      statusFilter,
      statusLabels: STATUS_LABELS,
      statusOptions: STATUS_OPTIONS,
      statusSelectOptions,
      statusVariant,
      termClass,
      terms,
      toggleTerm,
      total,
      PAGE_SIZE,
      formatDateTime
    };
  },

  template: `
<AdminPage
  title="文章"
  :description="'共 ' + total + ' 篇 · 内容由 posts 插件提供，启停该插件不影响后台其他功能'"
>
  <template #actions>
    <Button v-if="canWrite" @click="openCreate">
      <Icon name="plus" />
      新建文章
    </Button>
  </template>

  <template #toolbar>
    <div class="flex flex-wrap items-center gap-3">
      <div class="w-40">
        <Select :model-value="statusFilter" :options="statusOptions"
          @update:model-value="(value) => { statusFilter = value; search(); }" />
      </div>
      <div class="relative min-w-[14rem] flex-1">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="搜索标题或 slug" @enter="search" />
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
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="查看前台">
          <Icon name="eye" />
        </a>
        <button v-if="canWrite" type="button"
          class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="编辑" @click="openEdit(row.id)">
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

  <Dialog v-model:open="editorOpen" :title="editingId ? '编辑文章' : '新建文章'"
    description="正文使用 Markdown，服务端渲染后统一消毒再输出。" width="lg">
    <div class="flex flex-col gap-4">
      <div class="grid gap-4 md:grid-cols-2">
        <Field label="标题" required>
          <Input v-model="form.title" placeholder="例如：RiceNote 架构说明" />
        </Field>
        <Field label="别名（slug，留空自动生成）">
          <Input v-model="form.slug" placeholder="ricenote-architecture" />
        </Field>
      </div>

      <Field label="正文（Markdown）" required>
        <Textarea v-model="form.content" :rows="12" placeholder="# 标题&#10;&#10;支持常见 Markdown 语法…" />
      </Field>

      <div class="grid gap-4 md:grid-cols-2">
        <Field label="摘要（留空自动截取）">
          <Textarea v-model="form.excerpt" :rows="3" placeholder="用于列表与搜索结果的简短描述" />
        </Field>
        <div class="flex flex-col gap-4">
          <Field label="状态">
            <Select v-model="form.status" :options="statusSelectOptions" />
          </Field>
          <div class="flex flex-col gap-1.5">
            <Label>词条</Label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="term in terms" :key="term.id" type="button"
                :class="['rounded-full border px-2.5 py-1 text-xs transition-colors', termClass(term.id)]"
                @click="toggleTerm(term.id)">
                {{ term.type === 'category' ? '分类' : '标签' }}：{{ term.name }}
              </button>
              <span v-if="terms.length === 0" class="text-xs text-muted-foreground">
                尚未创建词条，可前往「分类与标签」添加。
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="editorOpen = false">取消</Button>
      <Button :loading="saving" @click="save">{{ editingId ? '保存修改' : '创建文章' }}</Button>
    </template>
  </Dialog>
</AdminPage>
`
});
