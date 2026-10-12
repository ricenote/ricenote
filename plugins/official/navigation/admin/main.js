/**
 * 导航栏插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（Card/Button/DataTable/Dialog/Select/Switch/…）已由宿主全局注册，
 *   因此模板里直接写标签即可，无需 import；
 * - `api` 自带 CSRF 与会话 Cookie 处理，路径仍是插件自己的管理 API。
 *
 * 迁移前该界面位于 `apps/admin/src/views/NavigationView.vue`，行为与文案保持一致。
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

const TYPE_LABELS = {
  custom: '自定义链接',
  page: '页面',
  post: '文章'
};

const TYPE_OPTIONS = [
  { label: '自定义链接', value: 'custom' },
  { label: '页面', value: 'page' },
  { label: '文章', value: 'post' }
];

/** 统一把接口错误转成可读文案（与 Core 页面的处理口径一致）。 */
function messageOf(error) {
  return error && error.message ? error.message : '操作失败，请稍后重试';
}

export default defineAdminPage({
  title: '导航栏',

  setup() {
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('nav.manage'));

    const items = ref([]);
    const loading = ref(false);
    const saving = ref(false);
    const movingId = ref(null);

    const dialogOpen = ref(false);
    const editingId = ref(null);
    const targetOptions = ref([]);
    const targetsLoading = ref(false);

    const form = ref({
      type: 'custom',
      label: '',
      href: '',
      refId: '',
      newTab: false,
      enabled: true
    });

    const columns = [
      { key: 'order', label: '顺序', width: 'w-20' },
      { key: 'label', label: '文案' },
      { key: 'type', label: '来源', width: 'w-32', hideBelow: 'md' },
      { key: 'href', label: '地址', width: 'w-56', hideBelow: 'lg' },
      { key: 'enabled', label: '启用', width: 'w-24' },
      { key: 'actions', label: '操作', width: 'w-32' }
    ];

    /** 该项是否会出现在前台（引用类项在目标未发布时会被跳过）。 */
    function isRenderable(item) {
      if (!item.enabled) return false;
      if (item.type === 'custom') return Boolean(item.href) && item.displayLabel.length > 0;
      return item.target && item.target.published === true;
    }

    /**
     * 引用类项的异常提示。
     *
     * 覆盖两种"看起来配好了但前台没有"的情况，这是最容易让人困惑的地方。
     */
    function brokenReason(item) {
      if (item.type === 'custom' || !item.enabled) return '';
      if (!item.target || !item.target.exists) return '目标已被删除，站点上不会显示';
      if (!item.target.published) return '目标尚未发布，站点上不会显示';
      return '';
    }

    const previewItems = computed(() => items.value.filter(isRenderable));

    async function load() {
      loading.value = true;
      try {
        items.value = await api.get('/navigation/items');
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        loading.value = false;
      }
    }

    async function loadTargets(type) {
      if (type === 'custom') {
        targetOptions.value = [];
        return;
      }
      targetsLoading.value = true;
      try {
        targetOptions.value = await api.get(`/navigation/targets?type=${type}`);
      } catch (error) {
        targetOptions.value = [];
        toast.error(messageOf(error));
      } finally {
        targetsLoading.value = false;
      }
    }

    function resetForm() {
      editingId.value = null;
      form.value = { type: 'custom', label: '', href: '', refId: '', newTab: false, enabled: true };
    }

    function openCreate() {
      resetForm();
      targetOptions.value = [];
      dialogOpen.value = true;
    }

    async function openEdit(row) {
      editingId.value = row.id;
      form.value = {
        type: row.type,
        label: row.label,
        href: row.type === 'custom' ? row.href || '' : '',
        refId: row.refId ? String(row.refId) : '',
        newTab: row.newTab,
        enabled: row.enabled
      };

      if (row.type === 'custom') {
        targetOptions.value = [];
      } else {
        await loadTargets(row.type);
        // 原目标可能已不在候选里（未发布/已删除）：补一个选项，
        // 否则下拉显示为空，用户一保存就把引用改成了第一项
        const current = row.refId ? String(row.refId) : '';
        const hasCurrent = targetOptions.value.some((option) => String(option.id) === current);
        if (current && !hasCurrent) {
          targetOptions.value = [
            { id: row.refId, title: `${row.displayLabel || '原目标'}（未发布或已删除）` },
            ...targetOptions.value
          ];
        }
      }

      dialogOpen.value = true;
    }

    async function onTypeChange(type) {
      form.value.type = type;
      form.value.href = '';
      form.value.refId = '';
      form.value.label = '';
      await loadTargets(type);
    }

    async function save() {
      const current = form.value;
      if (current.type === 'custom') {
        if (!current.label.trim()) {
          toast.error('自定义链接必须填写文案');
          return;
        }
        if (!current.href.trim()) {
          toast.error('自定义链接必须填写地址');
          return;
        }
      } else if (!current.refId) {
        toast.error(current.type === 'page' ? '请选择要引用的页面' : '请选择要引用的文章');
        return;
      }

      const payload = {
        type: current.type,
        label: current.label.trim(),
        newTab: current.newTab,
        enabled: current.enabled,
        ...(current.type === 'custom'
          ? { href: current.href.trim() }
          : { refId: Number(current.refId) })
      };

      saving.value = true;
      try {
        if (editingId.value) {
          await api.put(`/navigation/items/${editingId.value}`, payload);
          toast.success('导航项已更新');
        } else {
          await api.post('/navigation/items', payload);
          toast.success('导航项已添加');
        }
        dialogOpen.value = false;
        await load();
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        saving.value = false;
      }
    }

    async function move(row, direction) {
      movingId.value = row.id;
      try {
        // 服务端返回重排后的完整列表，前端不重复计算顺序
        items.value = await api.post(`/navigation/items/${row.id}/move`, { direction });
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        movingId.value = null;
      }
    }

    /** 快速启用/停用：回传该项完整字段，避免把其他内容清空。 */
    async function toggleEnabled(row, enabled) {
      const payload = {
        type: row.type,
        label: row.label,
        newTab: row.newTab,
        enabled,
        ...(row.type === 'custom' ? { href: row.href || '' } : { refId: row.refId || 0 })
      };

      try {
        await api.put(`/navigation/items/${row.id}`, payload);
        toast.success(enabled ? '已启用' : '已停用');
        await load();
      } catch (error) {
        toast.error(messageOf(error));
        await load();
      }
    }

    async function remove(row) {
      if (!window.confirm(`确定删除导航项「${row.displayLabel || row.label}」？`)) return;
      try {
        await api.delete(`/navigation/items/${row.id}`);
        toast.success('导航项已删除');
        await load();
      } catch (error) {
        toast.error(messageOf(error));
      }
    }

    const targetSelectOptions = computed(() => [
      { label: targetsLoading.value ? '加载中…' : '请选择', value: '' },
      ...targetOptions.value.map((option) => ({
        label: option.subtitle ? `${option.title}（${option.subtitle}）` : option.title,
        value: String(option.id)
      }))
    ]);

    onMounted(load);

    return {
      canManage,
      columns,
      dialogOpen,
      editingId,
      form,
      items,
      loading,
      movingId,
      previewItems,
      saving,
      targetSelectOptions,
      targetsLoading,
      typeOptions: TYPE_OPTIONS,
      typeLabels: TYPE_LABELS,
      brokenReason,
      isRenderable,
      load,
      move,
      onTypeChange,
      openCreate,
      openEdit,
      remove,
      save,
      toggleEnabled
    };
  },

  template: `
<AdminPage
  title="导航栏"
  description="管理站点顶部导航栏：自定义链接、页面、文章都可以加进来，顺序即展示顺序"
>
  <template #actions>
    <Button variant="outline" :loading="loading" @click="load">
      <Icon name="refresh" />
      刷新
    </Button>
    <Button v-if="canManage" @click="openCreate">
      <Icon name="plus" />
      添加导航项
    </Button>
  </template>

  <Card class="p-4">
    <p class="text-[11px] font-medium text-muted-foreground">预览</p>
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <template v-if="previewItems.length > 0">
        <span v-for="item in previewItems" :key="item.id" class="text-sm text-foreground">
          {{ item.displayLabel }}
        </span>
      </template>
      <span v-else class="text-xs text-muted-foreground">
        暂无可见项（导航栏为空，站点只显示首页等内置入口）
      </span>
    </div>
  </Card>

  <DataTable :columns="columns" :rows="items" :loading="loading" empty-title="导航栏还没有项目"
    empty-description="添加「关于本站」这类页面链接，或指向某篇文章、任意外部地址。" row-key="id">
    <template #cell-order="{ row, index }">
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="sm" :disabled="!canManage || index === 0 || movingId === row.id"
          title="上移" @click="move(row, 'up')">
          <Icon name="arrowup" />
        </Button>
        <Button variant="ghost" size="sm" :disabled="!canManage || index === items.length - 1 || movingId === row.id"
          title="下移" @click="move(row, 'down')">
          <Icon name="arrowdown" />
        </Button>
      </div>
    </template>

    <template #cell-label="{ row }">
      <p class="text-sm font-medium text-foreground">{{ row.displayLabel || '（目标不可用）' }}</p>
      <p v-if="row.label && row.type !== 'custom'" class="mt-0.5 text-[11px] text-muted-foreground">
        文案为自定义覆盖，不跟随目标标题
      </p>
      <p v-if="brokenReason(row)" class="mt-0.5 text-[11px] text-warning">{{ brokenReason(row) }}</p>
    </template>

    <template #cell-type="{ row }">
      <Badge variant="outline">{{ typeLabels[row.type] }}</Badge>
    </template>

    <template #cell-href="{ row }">
      <a v-if="row.href" class="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        :href="row.newTab ? row.href : undefined" :target="row.newTab ? '_blank' : undefined" rel="noopener">
        {{ row.href }}
      </a>
      <span v-else class="font-mono text-[11px] text-muted-foreground">—</span>
      <span v-if="row.newTab" class="ml-1 text-[11px] text-muted-foreground">（新窗口）</span>
    </template>

    <template #cell-enabled="{ row }">
      <Switch :model-value="row.enabled" :disabled="!canManage"
        @update:model-value="(value) => toggleEnabled(row, value)" />
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

  <Dialog v-model:open="dialogOpen" :title="editingId ? '编辑导航项' : '添加导航项'"
    description="页面与文章只保存引用，标题与地址随内容自动更新。" width="md">
    <div class="flex flex-col gap-4">
      <Field label="来源类型" description="自定义链接适合外部网站；页面与文章会跟随其标题与地址变化。">
        <Select :model-value="form.type" :options="typeOptions"
          @update:model-value="(value) => onTypeChange(value)" />
      </Field>

      <Field v-if="form.type === 'custom'" label="地址" required
        description="站内地址以 / 开头；外部地址必须以 http:// 或 https:// 开头。">
        <Input v-model="form.href" placeholder="/about 或 https://example.com" :maxlength="500" />
      </Field>

      <Field v-else :label="form.type === 'page' ? '选择页面' : '选择文章'" required
        description="只列出已发布的内容；未发布的内容不会显示。">
        <Select v-model="form.refId" :disabled="targetsLoading" :options="targetSelectOptions" />
      </Field>

      <Field :label="form.type === 'custom' ? '文案' : '文案（可选）'">
        <Input v-model="form.label" :maxlength="120"
          :placeholder="form.type === 'custom' ? '关于本站' : '留空则跟随目标标题'" />
      </Field>

      <div class="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p class="text-sm text-foreground">在新窗口打开</p>
          <p class="text-[11px] text-muted-foreground">站外链接建议开启</p>
        </div>
        <Switch v-model="form.newTab" />
      </div>

      <div class="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p class="text-sm text-foreground">启用</p>
          <p class="text-[11px] text-muted-foreground">停用后保留配置但不在站点上显示</p>
        </div>
        <Switch v-model="form.enabled" />
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="dialogOpen = false">取消</Button>
      <Button :loading="saving" @click="save">{{ editingId ? '保存修改' : '添加' }}</Button>
    </template>
  </Dialog>
</AdminPage>
`
});
