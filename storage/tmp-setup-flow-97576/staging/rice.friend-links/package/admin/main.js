/**
 * 友情链接插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（AdminPage/Card/Button/DataTable/Dialog/Field/Input/Switch/…）已由宿主全局注册，
 *   模板里直接写标签即可；
 * - `api` 自带 CSRF 与会话 Cookie 处理，路径是 `/api/admin` 之后的相对路径。
 *
 * 列表顺序由「排序」字段决定（数值越小越靠前），与前台展示顺序一致。
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

/** 统一把接口错误转成可读文案（与 Core 页面的处理口径一致）。 */
function messageOf(error) {
  return error && error.message ? error.message : '操作失败，请稍后重试';
}

export default defineAdminPage({
  title: '友情链接',

  setup() {
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('link.manage'));

    const items = ref([]);
    const loading = ref(false);
    const saving = ref(false);
    /** 加载失败的头像 ID：避免坏图反复触发请求，回退为占位图标。 */
    const brokenAvatars = ref([]);

    const dialogOpen = ref(false);
    const editingId = ref(null);

    const form = ref({
      name: '',
      url: '',
      avatarUrl: '',
      description: '',
      sortOrder: 0,
      enabled: true
    });

    const columns = [
      { key: 'name', label: '名称' },
      { key: 'url', label: '地址', width: 'w-64', hideBelow: 'lg' },
      { key: 'sortOrder', label: '排序', width: 'w-20' },
      { key: 'enabled', label: '启用', width: 'w-24' },
      { key: 'actions', label: '操作', width: 'w-32' }
    ];

    /** 前台实际会展示的条数（只有启用的会出现在页面上）。 */
    const visibleCount = computed(() => items.value.filter((item) => item.enabled).length);

    /** 新建时默认追加到末尾。 */
    const nextSortOrder = computed(
      () => items.value.reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), 0) + 1
    );

    function avatarOf(item) {
      return brokenAvatars.value.includes(item.id) ? '' : item.avatarUrl || '';
    }

    function markAvatarBroken(id) {
      if (!brokenAvatars.value.includes(id)) brokenAvatars.value = [...brokenAvatars.value, id];
    }

    async function load() {
      loading.value = true;
      try {
        items.value = await api.get('/friend-links/items');
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        loading.value = false;
      }
    }

    function openCreate() {
      editingId.value = null;
      form.value = {
        name: '',
        url: '',
        avatarUrl: '',
        description: '',
        sortOrder: nextSortOrder.value,
        enabled: true
      };
      dialogOpen.value = true;
    }

    function openEdit(row) {
      editingId.value = row.id;
      form.value = {
        name: row.name,
        url: row.url,
        avatarUrl: row.avatarUrl || '',
        description: row.description || '',
        sortOrder: Number(row.sortOrder) || 0,
        enabled: row.enabled
      };
      dialogOpen.value = true;
    }

    async function save() {
      const current = form.value;
      if (!current.name.trim()) {
        toast.error('请填写友链名称');
        return;
      }
      if (!/^https?:\/\/\S+$/i.test(current.url.trim())) {
        toast.error('友链地址需要以 http:// 或 https:// 开头');
        return;
      }

      const payload = {
        name: current.name.trim(),
        url: current.url.trim(),
        avatarUrl: current.avatarUrl.trim(),
        description: current.description.trim(),
        sortOrder: Number(current.sortOrder) || 0,
        enabled: current.enabled
      };

      saving.value = true;
      try {
        if (editingId.value) {
          await api.put(`/friend-links/items/${editingId.value}`, payload);
          toast.success('友链已更新');
        } else {
          await api.post('/friend-links/items', payload);
          toast.success('友链已添加');
        }
        dialogOpen.value = false;
        await load();
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        saving.value = false;
      }
    }

    /** 快速启用/停用：回传该项完整字段，避免把其他内容清空。 */
    async function toggleEnabled(row, enabled) {
      try {
        await api.put(`/friend-links/items/${row.id}`, {
          name: row.name,
          url: row.url,
          avatarUrl: row.avatarUrl || '',
          description: row.description || '',
          sortOrder: Number(row.sortOrder) || 0,
          enabled
        });
        toast.success(enabled ? '已启用' : '已停用');
        await load();
      } catch (error) {
        toast.error(messageOf(error));
        await load();
      }
    }

    async function remove(row) {
      if (!window.confirm(`确定删除友链「${row.name}」？`)) return;
      try {
        await api.delete(`/friend-links/items/${row.id}`);
        toast.success('友链已删除');
        await load();
      } catch (error) {
        toast.error(messageOf(error));
      }
    }

    onMounted(load);

    return {
      avatarOf,
      canManage,
      columns,
      dialogOpen,
      editingId,
      form,
      items,
      loading,
      markAvatarBroken,
      saving,
      visibleCount,
      load,
      openCreate,
      openEdit,
      remove,
      save,
      toggleEnabled
    };
  },

  template: `
<AdminPage
  title="友情链接"
  description="管理站点的友情链接，访客可在「友情链接」页面看到这些链接"
>
  <template #actions>
    <Button variant="outline" :loading="loading" @click="load">
      <Icon name="refresh" />
      刷新
    </Button>
    <Button v-if="canManage" @click="openCreate">
      <Icon name="plus" />
      添加友链
    </Button>
  </template>

  <Card class="p-4">
    <p class="text-[11px] font-medium text-muted-foreground">展示页</p>
    <p class="mt-2 text-xs text-muted-foreground">
      访客访问 <span class="font-mono text-foreground">/links</span> 即可看到这些链接；
      当前可见 {{ visibleCount }} 条（停用的不会展示）。
    </p>
  </Card>

  <DataTable :columns="columns" :rows="items" :loading="loading" empty-title="还没有友情链接"
    empty-description="添加对方的名称与地址，访客就能在「友情链接」页面看到它。" row-key="id">
    <template #cell-name="{ row }">
      <div class="flex items-center gap-2.5">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
          <img v-if="avatarOf(row)" :src="avatarOf(row)" alt="" class="h-full w-full object-cover"
            @error="markAvatarBroken(row.id)" />
          <Icon v-else name="image" class="h-4 w-4 text-muted-foreground" />
        </span>
        <span class="min-w-0">
          <p class="truncate text-sm font-medium text-foreground">{{ row.name }}</p>
          <p v-if="row.description" class="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
            {{ row.description }}
          </p>
        </span>
      </div>
    </template>

    <template #cell-url="{ row }">
      <a class="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        :href="row.url" target="_blank" rel="noopener">{{ row.url }}</a>
    </template>

    <template #cell-sortOrder="{ row }">
      <span class="text-xs text-muted-foreground">{{ row.sortOrder }}</span>
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

  <Dialog v-model:open="dialogOpen" :title="editingId ? '编辑友链' : '添加友链'"
    description="排序数值越小越靠前；停用后链接仍保留，但访客看不到。" width="md">
    <div class="flex flex-col gap-4">
      <Field label="名称" required>
        <Input v-model="form.name" placeholder="例如：RiceNote 官方博客" :maxlength="120" />
      </Field>

      <Field label="地址" required description="对方的完整网址，需以 http:// 或 https:// 开头。">
        <Input v-model="form.url" placeholder="https://example.com" :maxlength="500" />
      </Field>

      <Field label="头像" description="可填图片地址，或用媒体库里的图片路径（以 /uploads/ 开头）。">
        <Input v-model="form.avatarUrl" placeholder="https://example.com/avatar.png" :maxlength="500" />
      </Field>

      <Field label="描述" description="一句话介绍对方站点，留空则不显示。">
        <Textarea v-model="form.description" :rows="2" :maxlength="300" />
      </Field>

      <Field label="排序" description="数值越小越靠前。">
        <Input v-model="form.sortOrder" type="number" />
      </Field>

      <div class="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p class="text-sm text-foreground">启用</p>
          <p class="text-[11px] text-muted-foreground">停用后保留配置但访客看不到</p>
        </div>
        <Switch v-model="form.enabled" />
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="dialogOpen = false">取消</Button>
      <Button :loading="saving" @click="save">{{ editingId ? '保存修改' : '添加' }}</Button>
    </template>
  </Dialog>
</AdminPage>`
});
