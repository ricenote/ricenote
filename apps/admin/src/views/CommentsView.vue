<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { AlertTriangle, Check, Inbox, RefreshCw, RotateCcw, Trash2 } from 'lucide-vue-next';
import type { CommentCounts, CommentStatus, CommentSummary } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import { formatDateTime } from '@/lib/utils';

type FilterStatus = CommentStatus | 'all';

const auth = useAuth();
const toast = useToast();

const tabs: { value: FilterStatus; label: string; hint: string }[] = [
  { value: 'pending', label: '待审', hint: '等待人工判断的评论' },
  { value: 'approved', label: '已通过', hint: '已在站点公开显示' },
  { value: 'spam', label: '垃圾', hint: '被反垃圾规则或人工标记为垃圾' },
  { value: 'trash', label: '回收站', hint: '已下架但仍保留记录' },
  { value: 'all', label: '全部', hint: '包含所有状态的记录' }
];

const status = ref<FilterStatus>('pending');
const keyword = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const items = ref<CommentSummary[]>([]);
const counts = ref<CommentCounts | null>(null);
const loading = ref(false);
const busy = ref(false);
const selected = ref<number[]>([]);
const detail = ref<CommentSummary | null>(null);

const canModerate = auth.can('comment.moderate');

const statusMeta: Record<CommentStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'muted' }> = {
  pending: { label: '待审', variant: 'warning' },
  approved: { label: '已通过', variant: 'success' },
  spam: { label: '垃圾', variant: 'error' },
  trash: { label: '回收站', variant: 'muted' }
};

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const allSelected = computed(() => items.value.length > 0 && selected.value.length === items.value.length);
const countsOf = (value: FilterStatus): number | null => {
  if (!counts.value) return null;
  if (value === 'all') return counts.value.total;
  return counts.value[value];
};

/** 在当前页范围内计算嵌套深度，用于左侧缩进与竖线。 */
function depthOf(item: CommentSummary): number {
  let depth = 0;
  let current = item;
  const guard = 12;
  while (current.parentId && depth < guard) {
    const parent = items.value.find((candidate) => candidate.id === current.parentId);
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const head = name.slice(0, 1);
  return `${head}${'*'.repeat(Math.min(3, Math.max(1, name.length - 1)))}@${domain}`;
}

async function loadCounts(): Promise<void> {
  try {
    counts.value = await api.get<CommentCounts>('/comments/counts');
  } catch {
    counts.value = null;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (status.value !== 'all') query.set('status', status.value);
    if (keyword.value.trim()) query.set('keyword', keyword.value.trim());

    const response = await api.list<CommentSummary>(`/comments?${query.toString()}`);
    items.value = response.data;
    total.value = response.total;
    selected.value = [];
    await loadCounts();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '评论加载失败');
  } finally {
    loading.value = false;
  }
}

function toggle(id: number): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id];
}

function toggleAll(): void {
  selected.value = allSelected.value ? [] : items.value.map((item) => item.id);
}

async function moderate(ids: number[], action: 'approve' | 'spam' | 'trash' | 'delete'): Promise<void> {
  if (ids.length === 0) return;
  busy.value = true;
  try {
    const result = await api.post<{ affected: number }>('/comments/moderate', { ids, action });
    const labels: Record<typeof action, string> = {
      approve: '已通过',
      spam: '已标记为垃圾',
      trash: '已移入回收站',
      delete: '已删除'
    };
    toast.success(`${labels[action]} ${result.affected} 条评论`);
    detail.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '操作失败');
  } finally {
    busy.value = false;
  }
}

watch(status, () => {
  page.value = 1;
  void load();
});

watch(page, () => {
  void load();
});

let searchTimer: number | undefined;
watch(keyword, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5 pb-20">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">评论审核</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ tabs.find((tab) => tab.value === status)?.hint }}。审核通过后评论才会在文章页公开显示。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Input v-model="keyword" placeholder="搜索昵称、邮箱或内容" class="w-56" />
        <Button variant="outline" :loading="loading" @click="load">
          <RefreshCw class="h-4 w-4" />
          刷新
        </Button>
      </div>
    </header>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        class="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors"
        :class="
          status === tab.value
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground'
        "
        @click="status = tab.value"
      >
        {{ tab.label }}
        <span
          class="rounded-full px-1.5 py-0.5 text-[11px] tabular-nums"
          :class="status === tab.value ? 'bg-primary-foreground/15' : 'bg-muted'"
        >
          {{ countsOf(tab.value) ?? '—' }}
        </span>
      </button>
    </div>

    <Card class="overflow-hidden">
      <div class="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <input
          type="checkbox"
          class="h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
          :checked="allSelected"
          :disabled="items.length === 0"
          @change="toggleAll"
        >
        <span class="text-xs text-muted-foreground">
          共 {{ total }} 条 · 已选 {{ selected.length }} 条
        </span>
      </div>

      <ul v-if="items.length > 0" class="divide-y divide-border">
        <li
          v-for="item in items"
          :key="item.id"
          class="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          :style="{ paddingLeft: `${1 + depthOf(item) * 1.5}rem` }"
        >
          <input
            type="checkbox"
            class="mt-1 h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
            :checked="selected.includes(item.id)"
            @change="toggle(item.id)"
          >

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="font-medium text-foreground">{{ item.authorName }}</span>
              <span class="text-muted-foreground">{{ maskEmail(item.authorEmail) }}</span>
              <Badge :variant="statusMeta[item.status].variant">{{ statusMeta[item.status].label }}</Badge>
              <span v-if="item.replyCount > 0" class="text-muted-foreground">{{ item.replyCount }} 条回复</span>
              <span class="text-muted-foreground">{{ formatDateTime(item.createdAt) }}</span>
            </div>

            <button
              type="button"
              class="mt-1.5 block w-full cursor-pointer text-left text-xs text-muted-foreground hover:text-foreground"
              @click="detail = item"
            >
              <span class="line-clamp-2">{{ item.content }}</span>
            </button>

            <p class="mt-1 text-[11px] text-muted-foreground">
              文章：{{ item.postTitle || `#${item.postId}` }}
              <span v-if="item.parentId"> · 回复 #{{ item.parentId }}</span>
            </p>
          </div>
        </li>
      </ul>

      <div v-else class="flex flex-col items-center gap-2 py-14 text-muted-foreground">
        <Inbox class="h-6 w-6" />
        <p class="text-xs">{{ loading ? '正在加载…' : '当前筛选条件下没有评论' }}</p>
      </div>
    </Card>

    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
      <Button variant="outline" size="sm" :disabled="page <= 1" @click="page -= 1">上一页</Button>
      <span class="text-xs text-muted-foreground">第 {{ page }} / {{ totalPages }} 页</span>
      <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="page += 1">下一页</Button>
    </div>

    <!-- 批量操作条：浮层同样只用边框与背景色区分，不使用阴影 -->
    <div
      v-if="selected.length > 0"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card"
    >
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span class="text-xs text-muted-foreground">已选择 {{ selected.length }} 条评论</span>
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" :disabled="busy || !canModerate" @click="moderate(selected, 'approve')">
            <Check class="h-3.5 w-3.5" />
            通过
          </Button>
          <Button variant="outline" size="sm" :disabled="busy" @click="moderate(selected, 'spam')">
            <AlertTriangle class="h-3.5 w-3.5" />
            标记垃圾
          </Button>
          <Button variant="outline" size="sm" :disabled="busy" @click="moderate(selected, 'trash')">
            <RotateCcw class="h-3.5 w-3.5" />
            移入回收站
          </Button>
          <Button variant="destructive" size="sm" :disabled="busy" @click="moderate(selected, 'delete')">
            <Trash2 class="h-3.5 w-3.5" />
            删除
          </Button>
          <Button variant="ghost" size="sm" @click="selected = []">取消选择</Button>
        </div>
      </div>
    </div>

    <Dialog :open="detail !== null" :title="`评论 #${detail?.id ?? ''}`" width="lg" @update:open="detail = null">
      <div v-if="detail" class="flex flex-col gap-3 text-xs">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <p class="text-muted-foreground">昵称</p>
            <p class="mt-0.5 text-foreground">{{ detail.authorName }}</p>
          </div>
          <div>
            <p class="text-muted-foreground">邮箱</p>
            <p class="mt-0.5 text-foreground">{{ detail.authorEmail }}</p>
          </div>
          <div>
            <p class="text-muted-foreground">网址</p>
            <p class="mt-0.5 break-all text-foreground">{{ detail.authorUrl || '—' }}</p>
          </div>
          <div>
            <p class="text-muted-foreground">所属文章</p>
            <p class="mt-0.5 text-foreground">{{ detail.postTitle || `#${detail.postId}` }}</p>
          </div>
          <div>
            <p class="text-muted-foreground">来源 IP 哈希</p>
            <p class="mt-0.5 break-all font-mono text-[11px] text-foreground">{{ detail.ipHash || '—' }}</p>
          </div>
          <div>
            <p class="text-muted-foreground">提交时间</p>
            <p class="mt-0.5 text-foreground">{{ formatDateTime(detail.createdAt) }}</p>
          </div>
        </div>

        <div>
          <p class="text-muted-foreground">User-Agent</p>
          <p class="mt-0.5 break-all font-mono text-[11px] text-foreground">{{ detail.userAgent || '—' }}</p>
        </div>

        <div>
          <p class="text-muted-foreground">正文</p>
          <p class="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-foreground">
            {{ detail.content }}
          </p>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" :disabled="busy" @click="detail && moderate([detail.id], 'spam')">
            标记垃圾
          </Button>
          <Button variant="outline" size="sm" :disabled="busy" @click="detail && moderate([detail.id], 'trash')">
            移入回收站
          </Button>
          <Button size="sm" :disabled="busy" @click="detail && moderate([detail.id], 'approve')">通过</Button>
        </div>
      </template>
    </Dialog>
  </div>
</template>
