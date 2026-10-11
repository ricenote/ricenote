/**
 * 页面插件的后台界面（零构建）。
 *
 * 迁移前位于 `apps/admin/src/views/PagesView.vue`，行为与文案保持一致。
 * 模板下拉的可选项来自**当前主题声明**（`pageTemplates`）：主题没声明时只提供
 * 「跟随主题默认」，服务端也会拒绝未声明的模板键。
 */

import {
  api,
  computed,
  defineAdminPage,
  onMounted,
  ref,
  useSession,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

const STATUS_LABELS = { published: '已发布', draft: '草稿' };
const STATUS_TONES = { published: 'success', draft: 'muted' };

const STATUS_OPTIONS = [
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' }
];

function messageOf(error) {
  return error && error.message ? error.message : '操作失败，请稍后重试';
}

export default defineAdminPage({
  title: '页面',

  setup() {
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('page.manage'));

    const items = ref([]);
    const total = ref(0);
    const loading = ref(false);
    const saving = ref(false);
    const statusFilter = ref('all');
    const keyword = ref('');

    const templateOptions = ref([{ label: '跟随主题默认模板', value: '' }]);

    const dialogOpen = ref(false);
    const editingId = ref(null);
    const form = ref({
      title: '',
      slug: '',
      content: '',
      status: 'draft',
      template: '',
      sortOrder: 0,
      seoTitle: '',
      seoDescription: ''
    });

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

    /** 读取当前激活主题声明的页面模板清单。 */
    async function loadTemplates() {
      try {
        const themes = await api.get('/themes');
        const active = themes.find((theme) => theme.active);
        templateOptions.value = [
          { label: '跟随主题默认模板', value: '' },
          ...(active && active.pageTemplates ? active.pageTemplates : []).map((item) => ({
            label: item.description ? `${item.label} —— ${item.description}` : item.label,
            value: item.key
          }))
        ];
      } catch {
        templateOptions.value = [{ label: '跟随主题默认模板', value: '' }];
      }
    }

    function resetForm() {
      editingId.value = null;
      form.value = {
        title: '',
        slug: '',
        content: '',
        status: 'draft',
        template: '',
        sortOrder: 0,
        seoTitle: '',
        seoDescription: ''
      };
    }

    function openCreate() {
      resetForm();
      dialogOpen.value = true;
    }

    async function openEdit(row) {
      try {
        const detail = await api.get(`/pages/${row.id}`);
        editingId.value = detail.id;
        form.value = {
          title: detail.title,
          slug: detail.slug,
          content: detail.content,
          status: detail.status,
          template: detail.template || '',
          sortOrder: detail.sortOrder,
          seoTitle: detail.seoTitle || '',
          seoDescription: detail.seoDescription || ''
        };
        dialogOpen.value = true;
      } catch (error) {
        toast.error(messageOf(error));
      }
    }

    async function save() {
      const current = form.value;
      if (!current.title.trim()) {
        toast.error('页面标题不能为空');
        return;
      }

      const payload = {
        title: current.title.trim(),
        ...(current.slug && current.slug.trim() ? { slug: current.slug.trim() } : {}),
        content: current.content,
        status: current.status,
        template: current.template || null,
        sortOrder: Number(current.sortOrder) || 0,
        ...(current.seoTitle ? { seoTitle: current.seoTitle } : {}),
        ...(current.seoDescription ? { seoDescription: current.seoDescription } : {})
      };

      saving.value = true;
      try {
        if (editingId.value) {
          await api.put(`/pages/${editingId.value}`, payload);
          toast.success('页面已更新');
        } else {
          await api.post('/pages', payload);
          toast.success('页面已创建');
        }
        dialogOpen.value = false;
        await load();
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        saving.value = false;
      }
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

    onMounted(async () => {
      await Promise.all([load(), loadTemplates()]);
    });

    return {
      canManage,
      columns,
      dialogOpen,
      editingId,
      form,
      items,
      keyword,
      load,
      loading,
      openCreate,
      openEdit,
      remove,
      saving,
      statusFilter,
      statusLabels: STATUS_LABELS,
      statusOptions: STATUS_OPTIONS,
      statusTones: STATUS_TONES,
      templateOptions,
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
    <Button v-if="canManage" @click="openCreate">
      <Icon name="plus" />
      新建页面
    </Button>
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
        <Button v-if="canManage" variant="ghost" size="sm" @click="openEdit(row)">
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

  <Dialog v-model:open="dialogOpen" :title="editingId ? '编辑页面' : '新建页面'"
    description="正文支持 Markdown；页面模板只影响版式，不改变内容。" width="lg">
    <div class="flex flex-col gap-4">
      <div class="grid gap-4 md:grid-cols-2">
        <Field label="标题">
          <Input v-model="form.title" placeholder="关于本站" :maxlength="255" />
        </Field>
        <Field label="地址别名" description="留空则按标题自动生成">
          <Input v-model="form.slug" placeholder="about" :maxlength="200" />
        </Field>
      </div>

      <div class="grid gap-4 md:grid-cols-3">
        <div class="md:col-span-2">
          <Field label="页面模板" description="可选项来自当前主题的 pageTemplates 声明">
            <Select v-model="form.template" :options="templateOptions" />
          </Field>
        </div>
        <Field label="状态">
          <Select v-model="form.status" :options="statusOptions" />
        </Field>
      </div>

      <Field label="正文（Markdown）">
        <Textarea v-model="form.content" :rows="14" placeholder="# 标题&#10;&#10;在这里书写页面内容…" />
      </Field>

      <div class="grid gap-4 md:grid-cols-2">
        <Field label="SEO 标题（可选）" description="留空则使用页面标题">
          <Input v-model="form.seoTitle" :maxlength="255" />
        </Field>
        <Field label="SEO 描述（可选）" description="留空则自动截取正文">
          <Input v-model="form.seoDescription" :maxlength="500" />
        </Field>
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="dialogOpen = false">取消</Button>
      <Button :loading="saving" @click="save">{{ editingId ? '保存修改' : '创建页面' }}</Button>
    </template>
  </Dialog>
</AdminPage>
`
});
