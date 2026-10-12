/**
 * 文章**独立编辑页**（零构建）。
 *
 * 由列表页跳转进入：`/posts/editor`（新建）、`/posts/editor?id=<id>`（编辑）。
 * 它是 manifest `admin.pages` 里的 `hidden` 页面 —— 只注册路由、不进侧栏，
 * 因此深链与刷新都照常可用。
 *
 * 正文区是两个命名扩展点的**锚点**：
 * - `rice.posts.editorToolbar`（正文上方，默认无内容）；
 * - `rice.posts.editorBody`（正文区，默认是普通多行文本域）。
 * 编辑增强插件被停用/未安装时，默认内容照常渲染 —— 这就是回退契约。
 *
 * 内容字段区用 admin-sdk 的共享组件 `ContentFields`（全局注册，直接写标签即可）：
 * 它自己按当前主题声明取数（`GET /api/admin/content-fields`，模块级缓存一次，
 * 无声明时什么都不渲染），值以 `v-model` 绑定到本页的 `fields` 对象提交。
 *
 * 预览由本页提供（`preview()` → `POST /posts/preview`），贡献插件只拿到回调，
 * 无需知道端点名，也无需自己实现渲染管线。
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
  { label: '直接发布', value: 'published' },
  { label: '归档', value: 'archived' }
];

function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

/** 表单快照：用于"有改动才拦截离开"的脏检查。 */
function snapshot(form, content, fields) {
  return JSON.stringify({
    title: form.title,
    slug: form.slug,
    excerpt: form.excerpt,
    status: form.status,
    termIds: form.termIds,
    content,
    fields
  });
}

export default defineAdminPage({
  title: '编辑文章',

  setup() {
    const route = useRoute();
    const router = useRouter();
    const toast = useToast();

    const editingId = ref(null);
    const loading = ref(false);
    const saving = ref(false);
    const errorMsg = ref('');

    const content = ref('');
    const form = reactive({ title: '', slug: '', excerpt: '', status: 'draft', termIds: [] });
    /*
     * 内容字段值。用 ref 包一层：`ContentFields` 的 `v-model` 是**整体不可变替换**
     * （写回浅拷贝），只有 ref 才能让"模板绑定"与"下面的脏检查闭包"指向同一份最新值。
     */
    const fields = ref({});
    const terms = ref([]);
    const confirmLeaveOpen = ref(false);

    const baseline = ref(snapshot(form, '', {}));
    const dirty = computed(() => snapshot(form, content.value, fields.value) !== baseline.value);
    const heading = computed(() => (editingId.value !== null ? '编辑文章' : '新建文章'));

    function setContent(value) {
      content.value = value;
    }

    /** 触发服务端预览：返回渲染并消毒后的 HTML（Promise<string>）。 */
    async function preview() {
      const result = await api.post('/posts/preview', { content: content.value });
      return result && result.html ? result.html : '';
    }

    /* ------------------------------- 数据加载 ------------------------------- */
    async function loadTerms() {
      try {
        terms.value = await api.get('/terms');
      } catch {
        terms.value = [];
      }
    }

    async function loadPost() {
      if (editingId.value === null) return;
      loading.value = true;
      try {
        const detail = await api.get(`/posts/${editingId.value}`);
        form.title = detail.title;
        form.slug = detail.slug;
        form.excerpt = detail.excerpt;
        form.status = detail.status;
        form.termIds = detail.terms.map((term) => term.id);
        content.value = detail.content;
        // 详情里的 fields 已按当前主题声明过滤过，直接回填即可。
        fields.value = { ...(detail.fields || {}) };
      } catch (error) {
        errorMsg.value = messageOf(error, '文章加载失败');
      } finally {
        loading.value = false;
      }
    }

    function toggleTerm(termId) {
      const index = form.termIds.indexOf(termId);
      if (index >= 0) form.termIds.splice(index, 1);
      else form.termIds.push(termId);
    }
    function isTermSelected(termId) {
      return form.termIds.includes(termId);
    }
    function termClass(termId) {
      return isTermSelected(termId)
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-border bg-card text-muted-foreground hover:bg-muted';
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
          slug: form.slug.trim() || undefined,
          content: content.value,
          excerpt: form.excerpt.trim(),
          status: form.status,
          termIds: [...form.termIds],
          // 编辑页管理字段，故显式提交（空对象表示清空）。
          fields: { ...fields.value }
        };
        if (editingId.value !== null) {
          await api.put(`/posts/${editingId.value}`, payload);
          toast.success('文章已更新');
        } else {
          await api.post('/posts', payload);
          toast.success(form.status === 'published' ? '文章已发布' : '草稿已保存');
        }
        resetBaseline();
        router.push('/posts');
      } catch (error) {
        errorMsg.value = messageOf(error, '保存失败');
      } finally {
        saving.value = false;
      }
    }

    function cancel() {
      router.push('/posts');
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
      await loadTerms();
      await loadPost();
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
      isTermSelected,
      loading,
      preview,
      save,
      saving,
      setContent,
      statusOptions: STATUS_OPTIONS,
      termClass,
      terms,
      toggleTerm
    };
  },

  template: `
<AdminPage :title="heading"
  description="正文使用 Markdown，服务端渲染并统一消毒后再输出；预览与前台渲染结果一致。">
  <template #actions>
    <Button variant="ghost" @click="cancel">取消</Button>
    <Button :loading="saving" @click="save">{{ editingId !== null ? '保存' : '创建文章' }}</Button>
  </template>

  <p v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</p>

  <div class="flex flex-col gap-4 lg:flex-row">
    <div class="flex w-full flex-col gap-4 lg:w-[22rem] lg:shrink-0">
      <Card class="p-4">
        <div class="flex flex-col gap-4">
          <Field label="标题" required>
            <Input v-model="form.title" placeholder="例如：RiceNote 架构说明" />
          </Field>
          <Field label="别名（slug，留空自动生成）">
            <Input v-model="form.slug" placeholder="ricenote-architecture" />
          </Field>
          <Field label="状态">
            <Select v-model="form.status" :options="statusOptions" />
          </Field>
          <Field label="摘要（留空自动截取）">
            <Textarea v-model="form.excerpt" :rows="3" placeholder="用于列表与搜索结果的简短描述" />
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
      </Card>

      <!-- 主题声明的内容字段；无声明时组件自身不渲染任何内容 -->
      <ContentFields v-model="fields" :disabled="saving" />
    </div>

    <div class="flex min-h-[420px] flex-1 flex-col gap-2 lg:min-h-[calc(100vh-12rem)]">
      <PluginSlot name="rice.posts.editorToolbar"
        :context="{ kind: 'post', value: content, onChange: setContent, onPreview: preview }" />

      <PluginSlot name="rice.posts.editorBody"
        :context="{ kind: 'post', value: content, onChange: setContent, onPreview: preview }">
        <textarea
          class="h-full min-h-[420px] w-full flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          placeholder="# 标题&#10;&#10;支持常见 Markdown 语法…"
          v-model="content"></textarea>
      </PluginSlot>
    </div>
  </div>

  <ConfirmDialog :open="confirmLeaveOpen"
    title="放弃未保存的修改？"
    message="当前文章的修改尚未保存，离开将丢失这些改动。"
    confirm-label="放弃并离开"
    cancel-label="继续编辑"
    tone="destructive"
    @update:open="(value) => { if (!value) cancelLeave(); }"
    @confirm="confirmLeave" />
</AdminPage>
`
});
