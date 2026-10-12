/**
 * 页面编辑页（独立页面，manifest 中 `hidden: true`，不进侧栏）。
 *
 * 由列表页跳转进入：`/pages/editor`（新建）、`/pages/editor?id=<id>`（编辑）。
 * 它是 manifest `admin.pages` 里的声明式页面 —— 只注册路由、不进侧栏，
 * 因此深链与刷新都照常可用。
 *
 * 正文区是两个命名扩展点的**锚点**：
 * - `rice.pages.editorToolbar`（正文上方，默认无内容）；
 * - `rice.pages.editorBody`（正文区，默认是普通多行文本域）。
 * 编辑增强插件被停用/未安装时，默认内容照常渲染 —— 这就是回退契约。
 *
 * 内容字段区用 admin-sdk 的共享组件 `ContentFields`（全局注册，直接写标签即可）：
 * 它自己按当前主题声明取数（`GET /api/admin/content-fields`，模块级缓存一次，
 * 无声明时什么都不渲染），值以 `v-model` 绑定到本页的 `fields` 对象提交 ——
 * 与文章编辑页同一份实现。
 *
 * 预览由本页提供（`preview()` → `POST /pages/preview`），返回**已消毒的 HTML**；
 * 贡献插件只拿到回调、自己决定怎么展示，既不用知道端点名，也不用实现渲染管线。
 */

import {
  api,
  computed,
  defineAdminPage,
  onBeforeRouteLeave,
  onMounted,
  reactive,
  ref,
  useRoute,
  useRouter,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

const STATUS_OPTIONS = [
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' }
];

const DEFAULT_TEMPLATE_OPTION = { label: '跟随主题默认模板', value: '' };

function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

/** 变更检测快照：只需要稳定比较，故直接序列化。 */
function snapshot(form, content, fields) {
  return JSON.stringify({ form, content, fields });
}

export default defineAdminPage({
  title: '编辑页面',

  setup() {
    const route = useRoute();
    const router = useRouter();
    const toast = useToast();

    const editingId = ref(null);
    const loading = ref(false);
    const saving = ref(false);
    const errorMsg = ref('');

    const content = ref('');
    const form = reactive({
      title: '',
      slug: '',
      status: 'draft',
      template: '',
      sortOrder: 0,
      seoTitle: '',
      seoDescription: ''
    });
    /*
     * 内容字段值。用 ref 包一层：`ContentFields` 的 `v-model` 是**整体不可变替换**
     * （写回浅拷贝），只有 ref 才能让"模板绑定"与"下面的脏检查闭包"指向同一份最新值。
     */
    const fields = ref({});
    const templateOptions = ref([DEFAULT_TEMPLATE_OPTION]);
    const confirmLeaveOpen = ref(false);

    const baseline = ref(snapshot(form, '', {}));
    const dirty = computed(() => snapshot(form, content.value, fields.value) !== baseline.value);
    const heading = computed(() => (editingId.value !== null ? '编辑页面' : '新建页面'));

    function setContent(value) {
      content.value = value;
    }

    /**
     * 触发服务端预览：返回**渲染并消毒后的 HTML**（Promise<string>）。
     *
     * 契约要求"有返回值 + 由调用方展示"：本页不弹框、也不吞异常，
     * 展示方式（Dialog / 侧栏 / 内联）完全交给消费方。
     */
    async function preview() {
      const result = await api.post('/pages/preview', { content: content.value });
      return result && result.html ? result.html : '';
    }

    /* ------------------------------- 数据加载 ------------------------------- */

    /** 页面模板下拉的可选项来自当前激活主题声明的 `pageTemplates`。 */
    async function loadTemplates() {
      try {
        const themes = await api.get('/themes');
        const active = themes.find((theme) => theme.active);
        templateOptions.value = [
          DEFAULT_TEMPLATE_OPTION,
          ...((active && active.pageTemplates) || []).map((item) => ({
            label: item.description ? `${item.label} —— ${item.description}` : item.label,
            value: item.key
          }))
        ];
      } catch {
        // 主题清单拿不到时退化为"跟随主题默认"：不阻塞正文编辑
        templateOptions.value = [DEFAULT_TEMPLATE_OPTION];
      }
    }

    async function loadPage() {
      if (editingId.value === null) return;
      loading.value = true;
      try {
        const detail = await api.get(`/pages/${editingId.value}`);
        form.title = detail.title || '';
        form.slug = detail.slug || '';
        form.status = detail.status || 'draft';
        form.template = detail.template || '';
        form.sortOrder = detail.sortOrder || 0;
        form.seoTitle = detail.seoTitle || '';
        form.seoDescription = detail.seoDescription || '';
        content.value = detail.content || '';
        // 详情里的 fields 已按当前主题声明过滤过，直接回填即可。
        fields.value = { ...(detail.fields || {}) };
      } catch (error) {
        errorMsg.value = messageOf(error, '页面加载失败');
      } finally {
        loading.value = false;
      }
    }

    function resetBaseline() {
      baseline.value = snapshot(form, content.value, fields.value);
    }

    async function save() {
      errorMsg.value = '';
      if (!form.title.trim()) {
        errorMsg.value = '标题不能为空';
        return;
      }
      saving.value = true;
      try {
        const payload = {
          title: form.title.trim(),
          ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
          content: content.value,
          status: form.status,
          template: form.template || null,
          sortOrder: Number(form.sortOrder) || 0,
          // 编辑页管理字段，故显式提交（空对象表示清空）。
          fields: { ...fields.value },
          ...(form.seoTitle ? { seoTitle: form.seoTitle } : {}),
          ...(form.seoDescription ? { seoDescription: form.seoDescription } : {})
        };
        if (editingId.value !== null) {
          await api.put(`/pages/${editingId.value}`, payload);
          toast.success('页面已更新');
        } else {
          await api.post('/pages', payload);
          toast.success(form.status === 'published' ? '页面已发布' : '草稿已保存');
        }
        resetBaseline();
        router.push('/pages');
      } catch (error) {
        errorMsg.value = messageOf(error, '保存失败');
      } finally {
        saving.value = false;
      }
    }

    function cancel() {
      router.push('/pages');
    }

    /* --------------------------- 未保存离开保护 --------------------------- */
    // 用既有确认对话框而非 window.confirm：样式统一、可键盘操作。
    let resolveLeave = null;
    onBeforeRouteLeave(() => {
      if (!dirty.value) return true;
      confirmLeaveOpen.value = true;
      return new Promise((resolve) => {
        resolveLeave = resolve;
      });
    });
    function confirmLeave() {
      confirmLeaveOpen.value = false;
      if (resolveLeave) {
        resolveLeave(true);
        resolveLeave = null;
      }
    }
    function cancelLeave() {
      confirmLeaveOpen.value = false;
      if (resolveLeave) {
        resolveLeave(false);
        resolveLeave = null;
      }
    }

    onMounted(async () => {
      const raw = Array.isArray(route.query.id) ? route.query.id[0] : route.query.id;
      editingId.value = raw === undefined || raw === '' ? null : Number(raw);
      await loadTemplates();
      await loadPage();
      resetBaseline();
    });

    return {
      cancel,
      cancelLeave,
      confirmLeave,
      confirmLeaveOpen,
      content,
      dirty,
      editingId,
      errorMsg,
      fields,
      form,
      heading,
      loading,
      preview,
      save,
      saving,
      setContent,
      statusOptions: STATUS_OPTIONS,
      templateOptions
    };
  },

  template: `
<AdminPage :title="heading"
  description="正文使用 Markdown 编写。">
  <template #actions>
    <Button variant="ghost" @click="cancel">取消</Button>
    <Button :loading="saving" @click="save">{{ editingId !== null ? '保存' : '创建页面' }}</Button>
  </template>

  <p v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</p>

  <LoadingState v-if="loading" />

  <!-- 正文区的两个锚点等正文（与内容字段）就绪后再挂载，编辑器接管的首帧即带内容 -->
  <div v-else class="flex flex-col gap-4 lg:flex-row">
    <div class="flex w-full flex-col gap-4 lg:w-[22rem] lg:shrink-0">
      <Card class="p-4">
        <div class="flex flex-col gap-4">
          <Field label="标题" required>
            <Input v-model="form.title" placeholder="关于我们" :maxlength="255" />
          </Field>
          <Field label="别名（留空自动生成）">
            <Input v-model="form.slug" placeholder="about" :maxlength="200" />
          </Field>
          <Field label="状态">
            <Select v-model="form.status" :options="statusOptions" />
          </Field>
          <Field label="页面模板" description="可选项来自当前主题提供的页面版式">
            <Select v-model="form.template" :options="templateOptions" />
          </Field>
          <Field label="排序（数值越小越靠前）">
            <Input v-model="form.sortOrder" type="number" />
          </Field>
          <Field label="搜索标题（留空使用页面标题）">
            <Input v-model="form.seoTitle" :maxlength="255" />
          </Field>
          <Field label="搜索描述（留空自动截取正文）">
            <Input v-model="form.seoDescription" :maxlength="500" />
          </Field>
        </div>
      </Card>

      <!-- 主题声明的内容字段；无声明时组件自身不渲染任何内容 -->
      <ContentFields v-model="fields" :disabled="saving" />
    </div>

    <div class="flex min-h-[420px] flex-1 flex-col gap-2 lg:min-h-[calc(100vh-12rem)]">
      <PluginSlot name="rice.pages.editorToolbar"
        :context="{ kind: 'page', value: content, onChange: setContent, onPreview: preview }" />

      <PluginSlot name="rice.pages.editorBody"
        :context="{ kind: 'page', value: content, onChange: setContent, onPreview: preview }">
        <textarea
          class="h-full min-h-[420px] w-full flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          placeholder="# 标题&#10;&#10;在这里书写页面内容…"
          v-model="content"></textarea>
      </PluginSlot>
    </div>
  </div>

  <ConfirmDialog :open="confirmLeaveOpen"
    title="放弃未保存的修改？"
    message="当前页面的修改尚未保存，离开将丢失这些改动。"
    confirm-label="放弃并离开"
    cancel-label="继续编辑"
    tone="destructive"
    @update:open="(value) => { if (!value) cancelLeave(); }"
    @confirm="confirmLeave" />
</AdminPage>
`
});
