<script setup lang="ts">
/**
 * 导航栏管理。
 *
 * 导航栏是前台顶部唯一的入口列表，由 `rice.navigation` 插件维护；
 * 每个导航项有三种来源：
 * - **自定义链接**：站内路径或外部地址，文案自己写；
 * - **页面**：引用独立页面（跟随页面标题与地址，页面改名后自动更新）；
 * - **文章**：引用文章（同上）。
 *
 * 界面只暴露"必要的决策"：顺序、文案（可选覆盖）、是否新窗口、是否启用。
 * 引用类项的地址永远由服务端解析（页面是 /page/:slug、文章是 /post/:slug），
 * 因此这里不提供"手填地址"的入口，避免和内容插件各写一份 URL 约定。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { ArrowDown, ArrowUp, Navigation, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-vue-next';
import type {
  NavItemSaveRequest,
  NavItemSummary,
  NavItemType,
  NavTargetOption
} from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import Switch from '@/components/ui/Switch.vue';

const auth = useAuth();
const toast = useToast();

const items = ref<NavItemSummary[]>([]);
const loading = ref(false);
const saving = ref(false);
const movingId = ref<number | null>(null);

const canManage = computed(() => auth.can('nav.manage'));

const typeLabel: Record<NavItemType, string> = {
  custom: '自定义链接',
  page: '页面',
  post: '文章'
};

const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
/** 目标选择器的候选项（打开对话框时按类型加载）。 */
const targetOptions = ref<NavTargetOption[]>([]);
const targetsLoading = ref(false);

const form = reactive({
  type: 'custom' as NavItemType,
  label: '',
  href: '',
  refId: '' as string,
  newTab: false,
  enabled: true
});

/** 该项的前台可见性：引用类项在目标未发布时会被前台跳过。 */
function isRenderable(item: NavItemSummary): boolean {
  if (!item.enabled) return false;
  if (item.type === 'custom') return item.href !== null && item.displayLabel.length > 0;
  return item.target?.published === true;
}

/**
 * 引用类项的异常提示。
 *
 * 覆盖两种"看起来配好了但前台没有"的情况，这是最容易让人困惑的地方，
 * 因此必须显式说明，而不是让用户自己去前台找。
 */
function brokenReason(item: NavItemSummary): string | undefined {
  if (item.type === 'custom' || !item.enabled) return undefined;
  if (!item.target || !item.target.exists) return '目标已被删除，前台不会显示';
  if (!item.target.published) return '目标尚未发布，前台不会显示';
  return undefined;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.list<NavItemSummary>('/navigation/items');
    items.value = response.data;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '导航栏加载失败');
  } finally {
    loading.value = false;
  }
}

/** 加载目标候选；失败时给出空列表而不是中断编辑。 */
async function loadTargets(type: NavItemType, keyword = ''): Promise<void> {
  if (type === 'custom') {
    targetOptions.value = [];
    return;
  }
  targetsLoading.value = true;
  try {
    const query = new URLSearchParams({ type });
    if (keyword.trim()) query.set('keyword', keyword.trim());
    const options = await api.get<NavTargetOption[]>(`/navigation/targets?${query.toString()}`);
    targetOptions.value = options;
  } catch (error) {
    targetOptions.value = [];
    toast.error(error instanceof ApiError ? error.message : '目标列表加载失败');
  } finally {
    targetsLoading.value = false;
  }
}

function resetForm(): void {
  editingId.value = null;
  form.type = 'custom';
  form.label = '';
  form.href = '';
  form.refId = '';
  form.newTab = false;
  form.enabled = true;
}

function openCreate(): void {
  resetForm();
  targetOptions.value = [];
  dialogOpen.value = true;
}

async function openEdit(row: NavItemSummary): Promise<void> {
  editingId.value = row.id;
  form.type = row.type;
  form.label = row.label;
  form.href = row.type === 'custom' ? row.href ?? '' : '';
  form.refId = row.refId ? String(row.refId) : '';
  form.newTab = row.newTab;
  form.enabled = row.enabled;

  if (row.type !== 'custom') {
    await loadTargets(row.type);
    /*
     * 原目标可能已不在候选里（未发布或已删除）。
     * 此时补一个选项，否则下拉会显示为空 —— 用户会以为"没选过"，
     * 一保存就把引用改成了第一项。
     */
    const current = row.refId ? String(row.refId) : '';
    if (current && !targetOptions.value.some((option) => String(option.id) === current)) {
      targetOptions.value = [
        { id: row.refId as number, title: `${row.displayLabel || '原目标'}（未发布或已删除）` },
        ...targetOptions.value
      ];
    }
  } else {
    targetOptions.value = [];
  }

  dialogOpen.value = true;
}

/** 切换类型时清空不再适用的字段，避免提交混合数据。 */
async function onTypeChange(type: NavItemType): Promise<void> {
  form.type = type;
  form.href = '';
  form.refId = '';
  form.label = '';
  await loadTargets(type);
}

async function save(): Promise<void> {
  if (form.type === 'custom') {
    if (!form.label.trim()) {
      toast.error('自定义链接必须填写文案');
      return;
    }
    if (!form.href.trim()) {
      toast.error('自定义链接必须填写地址');
      return;
    }
  } else if (!form.refId) {
    toast.error(form.type === 'page' ? '请选择要引用的页面' : '请选择要引用的文章');
    return;
  }

  const payload: NavItemSaveRequest = {
    type: form.type,
    label: form.label.trim(),
    newTab: form.newTab,
    enabled: form.enabled,
    ...(form.type === 'custom' ? { href: form.href.trim() } : { refId: Number(form.refId) })
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
    toast.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function move(row: NavItemSummary, direction: 'up' | 'down'): Promise<void> {
  movingId.value = row.id;
  try {
    const response = await api.post<NavItemSummary[]>(`/navigation/items/${row.id}/move`, {
      direction
    });
    // 服务端返回重排后的完整列表，避免前端二次计算顺序
    items.value = response;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '调整顺序失败');
  } finally {
    movingId.value = null;
  }
}

/** 快速启用/停用：复用保存接口，回传该项的完整字段以免清空其他内容。 */
async function toggleEnabled(row: NavItemSummary, enabled: boolean): Promise<void> {
  const payload: NavItemSaveRequest = {
    type: row.type,
    label: row.label,
    newTab: row.newTab,
    enabled,
    ...(row.type === 'custom' ? { href: row.href ?? '' } : { refId: row.refId ?? 0 })
  };

  try {
    await api.put(`/navigation/items/${row.id}`, payload);
    toast.success(enabled ? '已启用' : '已停用');
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '操作失败');
    await load();
  }
}

async function remove(row: NavItemSummary): Promise<void> {
  if (!window.confirm(`确定删除导航项「${row.displayLabel || row.label}」？`)) return;
  try {
    await api.delete(`/navigation/items/${row.id}`);
    toast.success('导航项已删除');
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">导航栏</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          前台顶部导航栏的唯一来源：自定义链接、页面、文章都可以加进来，顺序即展示顺序
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" :loading="loading" @click="load">
          <RefreshCw class="h-3.5 w-3.5" />
          刷新
        </Button>
        <Button v-if="canManage" @click="openCreate">
          <Plus class="h-3.5 w-3.5" />
          添加导航项
        </Button>
      </div>
    </header>

    <!-- 前台预览：与真实顺序一致，被跳过的项在此标注出来 -->
    <Card class="p-4">
      <p class="text-[11px] font-medium text-muted-foreground">前台预览</p>
      <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <template v-if="items.some((item) => isRenderable(item))">
          <span
            v-for="item in items.filter((row) => isRenderable(row))"
            :key="`preview-${item.id}`"
            class="text-sm text-foreground"
          >
            {{ item.displayLabel }}
          </span>
        </template>
        <span v-else class="text-xs text-muted-foreground">
          暂无前台可见项（导航栏为空，主题只显示首页等内置入口）
        </span>
      </div>
    </Card>

    <Card class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead class="border-b border-border">
            <tr>
              <th class="rn-th w-20">顺序</th>
              <th class="rn-th">文案</th>
              <th class="rn-th w-32 hidden md:table-cell">来源</th>
              <th class="rn-th w-56 hidden lg:table-cell">地址</th>
              <th class="rn-th w-24">启用</th>
              <th class="rn-th w-32">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="(row, index) in items" :key="row.id" class="transition-colors hover:bg-muted/40">
              <td class="rn-td">
                <div class="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="!canManage || index === 0 || movingId === row.id"
                    title="上移"
                    @click="move(row, 'up')"
                  >
                    <ArrowUp class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="!canManage || index === items.length - 1 || movingId === row.id"
                    title="下移"
                    @click="move(row, 'down')"
                  >
                    <ArrowDown class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
              <td class="rn-td">
                <p class="text-sm font-medium text-foreground">
                  {{ row.displayLabel || '（目标不可用）' }}
                </p>
                <p v-if="row.label && row.type !== 'custom'" class="mt-0.5 text-[11px] text-muted-foreground">
                  文案为自定义覆盖，不跟随目标标题
                </p>
                <p v-if="brokenReason(row)" class="mt-0.5 text-[11px] text-amber-600">
                  {{ brokenReason(row) }}
                </p>
              </td>
              <td class="rn-td hidden md:table-cell">
                <Badge variant="outline">{{ typeLabel[row.type] }}</Badge>
              </td>
              <td class="rn-td hidden lg:table-cell">
                <a
                  v-if="row.href"
                  class="font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  :href="row.newTab ? row.href : undefined"
                  :target="row.newTab ? '_blank' : undefined"
                  rel="noopener"
                >
                  {{ row.href }}
                </a>
                <span v-else class="font-mono text-[11px] text-muted-foreground">—</span>
                <span v-if="row.newTab" class="ml-1 text-[11px] text-muted-foreground">（新窗口）</span>
              </td>
              <td class="rn-td">
                <Switch
                  :model-value="row.enabled"
                  :disabled="!canManage"
                  @update:model-value="(value: boolean) => toggleEnabled(row, value)"
                />
              </td>
              <td class="rn-td">
                <div class="flex items-center gap-1">
                  <Button v-if="canManage" variant="ghost" size="sm" @click="openEdit(row)">
                    <Pencil class="h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button v-if="canManage" variant="ghost" size="sm" @click="remove(row)">
                    <Trash2 class="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td class="rn-td py-12 text-center" colspan="6">
                <Navigation class="mx-auto h-6 w-6 text-muted-foreground" />
                <p class="mt-2 text-sm text-foreground">导航栏还没有项目</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  添加「关于本站」这类页面链接，或指向某篇文章、任意外部地址。
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Dialog
      v-model:open="dialogOpen"
      :title="editingId ? '编辑导航项' : '添加导航项'"
      description="页面与文章只保存引用，标题与地址随内容自动更新。"
      width="md"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <Label>来源类型</Label>
          <Select
            :model-value="form.type"
            :options="[
              { label: '自定义链接', value: 'custom' },
              { label: '页面', value: 'page' },
              { label: '文章', value: 'post' }
            ]"
            @update:model-value="(value: string) => void onTypeChange(value as NavItemType)"
          />
          <p class="text-[11px] text-muted-foreground">
            自定义链接适合外部站点或未在站内发布的内容；页面与文章会跟随其标题与地址变化。
          </p>
        </div>

        <div v-if="form.type === 'custom'" class="flex flex-col gap-1.5">
          <Label required>地址</Label>
          <Input v-model="form.href" placeholder="/about 或 https://example.com" :maxlength="500" />
          <p class="text-[11px] text-muted-foreground">
            站内地址以 / 开头；外部地址必须以 http:// 或 https:// 开头。
          </p>
        </div>

        <div v-else class="flex flex-col gap-1.5">
          <Label required>{{ form.type === 'page' ? '选择页面' : '选择文章' }}</Label>
          <Select
            v-model="form.refId"
            :disabled="targetsLoading"
            :options="[
              { label: targetsLoading ? '加载中…' : '请选择', value: '' },
              ...targetOptions.map((option) => ({
                label: option.subtitle ? `${option.title}（${option.subtitle}）` : option.title,
                value: String(option.id)
              }))
            ]"
          />
          <p class="text-[11px] text-muted-foreground">
            只列出已发布的内容；未发布的目标在前台不会显示。
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>{{ form.type === 'custom' ? '文案' : '文案（可选）' }}</Label>
          <Input
            v-model="form.label"
            :maxlength="120"
            :placeholder="form.type === 'custom' ? '关于本站' : '留空则跟随目标标题'"
          />
        </div>

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
            <p class="text-[11px] text-muted-foreground">停用后保留配置但不在前台显示</p>
          </div>
          <Switch v-model="form.enabled" />
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="dialogOpen = false">取消</Button>
        <Button :loading="saving" @click="save">{{ editingId ? '保存修改' : '添加' }}</Button>
      </template>
    </Dialog>
  </div>
</template>
