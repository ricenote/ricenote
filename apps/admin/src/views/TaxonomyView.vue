<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { FolderTree, Plus, Tags, Trash2 } from 'lucide-vue-next';
import type { TermSummary, TermType } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import Textarea from '@/components/ui/Textarea.vue';

const auth = useAuth();
const toast = useToast();

const terms = ref<TermSummary[]>([]);
const loading = ref(false);
const dialogOpen = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);

const form = reactive({
  name: '',
  slug: '',
  type: 'category' as TermType,
  description: ''
});

const categories = computed(() => terms.value.filter((term) => term.type === 'category'));
const tags = computed(() => terms.value.filter((term) => term.type === 'tag'));
const canManage = computed(() => auth.can('taxonomy.manage'));

async function load(): Promise<void> {
  loading.value = true;
  try {
    terms.value = await api.get<TermSummary[]>('/terms');
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '词条加载失败');
  } finally {
    loading.value = false;
  }
}

function openCreate(type: TermType): void {
  editingId.value = null;
  form.name = '';
  form.slug = '';
  form.type = type;
  form.description = '';
  dialogOpen.value = true;
}

function openEdit(term: TermSummary): void {
  editingId.value = term.id;
  form.name = term.name;
  form.slug = term.slug;
  form.type = term.type;
  form.description = '';
  dialogOpen.value = true;
}

async function save(): Promise<void> {
  if (!form.name.trim()) {
    toast.warning('名称不能为空');
    return;
  }

  saving.value = true;
  try {
    await api.post('/terms', {
      ...(editingId.value ? { id: editingId.value } : {}),
      name: form.name.trim(),
      slug: form.slug.trim(),
      type: form.type,
      description: form.description.trim()
    });
    toast.success(editingId.value ? '词条已更新' : '词条已创建');
    dialogOpen.value = false;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(term: TermSummary): Promise<void> {
  if (!window.confirm(`删除「${term.name}」将同时解除其与文章的关联，确定继续？`)) return;
  try {
    await api.delete(`/terms/${term.id}`);
    toast.success('词条已删除');
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
        <h1 class="text-xl font-semibold text-foreground">分类与标签</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          由 taxonomy 插件提供；归档页面由 posts 插件渲染，插件之间只通过服务契约协作
        </p>
      </div>
      <Button v-if="canManage" variant="outline" :loading="loading" @click="load">刷新</Button>
    </header>

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- 分类 -->
      <Card class="p-5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <FolderTree class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold text-foreground">分类</h2>
            <span class="text-xs text-muted-foreground">{{ categories.length }}</span>
          </div>
          <Button v-if="canManage" size="sm" @click="openCreate('category')">
            <Plus class="h-3.5 w-3.5" />
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
                <Trash2 class="h-3.5 w-3.5" />
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
            <Tags class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold text-foreground">标签</h2>
            <span class="text-xs text-muted-foreground">{{ tags.length }}</span>
          </div>
          <Button v-if="canManage" size="sm" @click="openCreate('tag')">
            <Plus class="h-3.5 w-3.5" />
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
              <Trash2 class="h-3 w-3" />
            </button>
          </li>
        </ul>
        <p v-else class="mt-3 text-xs text-muted-foreground">还没有标签。</p>
      </Card>
    </div>

    <Dialog v-model:open="dialogOpen" :title="editingId ? '编辑词条' : '新建词条'" width="sm">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <Label required>类型</Label>
          <Select
            v-model="form.type"
            :options="[
              { label: '分类（category）', value: 'category' },
              { label: '标签（tag）', value: 'tag' }
            ]"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label required>名称</Label>
          <Input v-model="form.name" placeholder="例如：架构设计" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>别名（留空自动生成）</Label>
          <Input v-model="form.slug" placeholder="architecture" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>描述</Label>
          <Textarea v-model="form.description" :rows="2" placeholder="可选，用于归档页说明" />
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="dialogOpen = false">取消</Button>
        <Button :loading="saving" @click="save">保存</Button>
      </template>
    </Dialog>
  </div>
</template>
