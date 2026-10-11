/**
 * 分类与标签插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（Card/Button/Dialog/Select/Input/Textarea/Field/Icon…）已由宿主全局注册，
 *   因此模板里直接写标签即可，无需 import；
 * - `api` 自带 CSRF 与会话 Cookie 处理，路径仍是插件自己的管理 API。
 *
 * 迁移前该界面位于 `apps/admin/src/views/TaxonomyView.vue`，行为与文案保持一致：
 * 分类卡片（列表 + 计数）、标签卡片（药丸样式 + 计数）、词条新建/编辑对话框、删除二次确认。
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

const TYPE_OPTIONS = [
  { label: '分类（category）', value: 'category' },
  { label: '标签（tag）', value: 'tag' }
];

/** 统一把接口错误转成可读文案（与 Core 页面的处理口径一致）。 */
function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

export default defineAdminPage({
  title: '分类与标签',

  setup() {
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('taxonomy.manage'));

    const terms = ref([]);
    const loading = ref(false);
    const dialogOpen = ref(false);
    const saving = ref(false);
    const editingId = ref(null);

    const form = ref({ name: '', slug: '', type: 'category', description: '' });

    const categories = computed(() => terms.value.filter((term) => term.type === 'category'));
    const tags = computed(() => terms.value.filter((term) => term.type === 'tag'));

    async function load() {
      loading.value = true;
      try {
        terms.value = await api.get('/terms');
      } catch (error) {
        toast.error(messageOf(error, '词条加载失败'));
      } finally {
        loading.value = false;
      }
    }

    function openCreate(type) {
      editingId.value = null;
      form.value = { name: '', slug: '', type, description: '' };
      dialogOpen.value = true;
    }

    /**
     * 编辑时描述一栏固定留空（与迁移前一致）：列表接口不返回描述字段，
     * 留空可避免"只改名称却把描述覆盖为空"以外的意外——保存时仍会提交 description。
     */
    function openEdit(term) {
      editingId.value = term.id;
      form.value = { name: term.name, slug: term.slug, type: term.type, description: '' };
      dialogOpen.value = true;
    }

    async function save() {
      if (!form.value.name.trim()) {
        toast.warning('名称不能为空');
        return;
      }

      saving.value = true;
      try {
        await api.post('/terms', {
          ...(editingId.value ? { id: editingId.value } : {}),
          name: form.value.name.trim(),
          slug: form.value.slug.trim(),
          type: form.value.type,
          description: form.value.description.trim()
        });
        toast.success(editingId.value ? '词条已更新' : '词条已创建');
        dialogOpen.value = false;
        await load();
      } catch (error) {
        toast.error(messageOf(error, '保存失败'));
      } finally {
        saving.value = false;
      }
    }

    async function remove(term) {
      if (!window.confirm(`删除「${term.name}」将同时解除其与文章的关联，确定继续？`)) return;
      try {
        await api.delete(`/terms/${term.id}`);
        toast.success('词条已删除');
        await load();
      } catch (error) {
        toast.error(messageOf(error, '删除失败'));
      }
    }

    onMounted(load);

    return {
      canManage,
      categories,
      dialogOpen,
      editingId,
      form,
      loading,
      saving,
      tags,
      terms,
      typeOptions: TYPE_OPTIONS,
      load,
      openCreate,
      openEdit,
      remove,
      save
    };
  },

  template: `
<AdminPage
  title="分类与标签"
  description="由 taxonomy 插件提供；归档页面由 posts 插件渲染，插件之间只通过服务契约协作"
>
  <template #actions>
    <Button v-if="canManage" variant="outline" :loading="loading" @click="load">
      <Icon name="refresh" />
      刷新
    </Button>
  </template>

  <div class="grid gap-4 lg:grid-cols-2">
    <!-- 分类 -->
    <Card class="p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon name="foldertree" class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">分类</h2>
          <span class="text-xs text-muted-foreground">{{ categories.length }}</span>
        </div>
        <Button v-if="canManage" size="sm" @click="openCreate('category')">
          <Icon name="plus" />
          新建
        </Button>
      </div>

      <ul v-if="categories.length" class="mt-3 flex flex-col divide-y divide-border">
        <li v-for="term in categories" :key="term.id" class="flex items-center justify-between gap-3 py-2.5">
          <div class="min-w-0">
            <p class="truncate text-sm text-foreground">{{ term.name }}</p>
            <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">/category/{{ term.slug }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{{ term.count ?? 0 }} 篇</span>
            <button
              v-if="canManage"
              type="button"
              class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              title="删除"
              @click="remove(term)"
            >
              <Icon name="trash" />
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="mt-3 text-xs text-muted-foreground">还没有分类。</p>
    </Card>

    <!-- 标签 -->
    <Card class="p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon name="tags" class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">标签</h2>
          <span class="text-xs text-muted-foreground">{{ tags.length }}</span>
        </div>
        <Button v-if="canManage" size="sm" @click="openCreate('tag')">
          <Icon name="plus" />
          新建
        </Button>
      </div>

      <ul v-if="tags.length" class="mt-3 flex flex-wrap gap-1.5">
        <li
          v-for="term in tags"
          :key="term.id"
          class="flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
        >
          <span class="text-foreground">{{ term.name }}</span>
          <span class="text-muted-foreground">{{ term.count ?? 0 }}</span>
          <button
            v-if="canManage"
            type="button"
            class="text-muted-foreground transition-colors hover:text-destructive"
            title="删除"
            @click="remove(term)"
          >
            <Icon name="trash" class="h-3 w-3" />
          </button>
        </li>
      </ul>
      <p v-else class="mt-3 text-xs text-muted-foreground">还没有标签。</p>
    </Card>
  </div>

  <Dialog v-model:open="dialogOpen" :title="editingId ? '编辑词条' : '新建词条'" width="sm">
    <div class="flex flex-col gap-4">
      <Field label="类型" required>
        <Select v-model="form.type" :options="typeOptions" />
      </Field>
      <Field label="名称" required>
        <Input v-model="form.name" placeholder="例如：架构设计" />
      </Field>
      <Field label="别名（留空自动生成）">
        <Input v-model="form.slug" placeholder="architecture" />
      </Field>
      <Field label="描述">
        <Textarea v-model="form.description" :rows="2" placeholder="可选，用于归档页说明" />
      </Field>
    </div>

    <template #footer>
      <Button variant="ghost" @click="dialogOpen = false">取消</Button>
      <Button :loading="saving" @click="save">保存</Button>
    </template>
  </Dialog>
</AdminPage>
`
});
