<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Activity, ChevronDown, ChevronRight, RefreshCw } from 'lucide-vue-next';
import type { LogLevelName, RuntimeLogEntry, RuntimeLogFileInfo } from '@ricenote/shared';
import { api, ApiError, Badge, Button, Card, formatBytes, Input, Label, Select } from '@ricenote/admin-sdk';
import { useToast } from '@/stores/toast';

interface LogsResponse {
  data: RuntimeLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  files: RuntimeLogFileInfo[];
  scannedLines: number;
  truncated: boolean;
  readFiles: string[];
}

const toast = useToast();

// 用 string 而非字面量联合：Select 组件回传的是普通字符串
const level = ref('all');
const file = ref('');
const keyword = ref('');
const from = ref('');
const to = ref('');
const page = ref(1);
const pageSize = 30;

const entries = ref<RuntimeLogEntry[]>([]);
const files = ref<RuntimeLogFileInfo[]>([]);
const total = ref(0);
const truncated = ref(false);
const readFiles = ref<string[]>([]);
const loading = ref(false);
const expanded = ref<number[]>([]);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

const levelOptions = [
  { label: '全部级别', value: 'all' },
  { label: '调试', value: 'debug' },
  { label: '信息', value: 'info' },
  { label: '警告', value: 'warn' },
  { label: '错误', value: 'error' }
];

const levelVariant: Record<LogLevelName, 'muted' | 'outline' | 'warning' | 'error'> = {
  debug: 'muted',
  info: 'outline',
  warn: 'warning',
  error: 'error'
};

/** 级别展示名（内部代号不外露）。 */
const levelLabel: Record<LogLevelName, string> = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误'
};

const fileOptions = computed(() => [
  { label: '全部日志文件', value: '' },
  ...files.value.map((item) => ({
    label: `${item.name}（${formatBytes(item.size)}）`,
    value: item.name
  }))
]);

/** 时间范围输入为 datetime-local，转成 ISO 供服务端比较。 */
function toIso(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function entryKey(entry: RuntimeLogEntry, index: number): number {
  return index;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (level.value !== 'all') query.set('level', level.value);
    if (file.value) query.set('file', file.value);
    if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
    if (from.value) query.set('from', toIso(from.value));
    if (to.value) query.set('to', toIso(to.value));

    const response = await api.raw<LogsResponse>('GET', `/logs?${query.toString()}`);
    entries.value = response.data;
    files.value = response.files;
    total.value = response.total;
    truncated.value = response.truncated;
    readFiles.value = response.readFiles;
    expanded.value = [];
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '日志读取失败');
  } finally {
    loading.value = false;
  }
}

function toggle(index: number): void {
  expanded.value = expanded.value.includes(index)
    ? expanded.value.filter((item) => item !== index)
    : [...expanded.value, index];
}

function fieldEntries(entry: RuntimeLogEntry): [string, string][] {
  return Object.entries(entry.fields).map(([key, value]) => [
    key,
    typeof value === 'string' ? value : JSON.stringify(value)
  ]);
}

function reload(): void {
  page.value = 1;
  void load();
}

watch(page, () => void load());

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">运行日志</h1>
        <p class="mt-1 text-xs text-muted-foreground">查看站点运行记录。</p>
      </div>
      <Button variant="outline" :loading="loading" @click="reload">
        <RefreshCw class="h-4 w-4" />
        刷新
      </Button>
    </header>

    <Card class="p-4">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div class="flex flex-col gap-1.5">
          <Label>级别</Label>
          <Select v-model="level" :options="levelOptions" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>日志文件</Label>
          <Select v-model="file" :options="fileOptions" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>起始时间</Label>
          <Input v-model="from" type="datetime-local" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>结束时间</Label>
          <Input v-model="to" type="datetime-local" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>关键字</Label>
          <Input v-model="keyword" placeholder="搜索内容" @enter="reload" />
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p class="text-[11px] text-muted-foreground">
          命中 {{ total }} 条
          <span v-if="truncated" class="text-[hsl(var(--warning))]"> · 仅显示最近的部分记录</span>
        </p>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="reload">应用筛选</Button>
          <Button
            variant="ghost"
            size="sm"
            @click="
              () => {
                level = 'all';
                file = '';
                keyword = '';
                from = '';
                to = '';
                reload();
              }
            "
          >
            重置
          </Button>
        </div>
      </div>
    </Card>

    <Card class="overflow-hidden">
      <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div class="flex items-center gap-2">
          <Activity class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">日志记录</h2>
        </div>
        <!-- 文件清单可能很长：此处只显示数量并截断，完整列表由筛选区的下拉提供 -->
        <span
          class="min-w-0 max-w-[70%] truncate text-right text-[11px] text-muted-foreground"
          :title="readFiles.join('、')"
        >
          共 {{ readFiles.length }} 个日志文件
        </span>
      </div>

      <ul v-if="entries.length > 0" class="divide-y divide-border">
        <li v-for="(entry, index) in entries" :key="entryKey(entry, index)" class="px-4 py-2">
          <button
            type="button"
            class="flex w-full cursor-pointer items-start gap-3 text-left"
            @click="toggle(index)"
          >
            <component
              :is="expanded.includes(index) ? ChevronDown : ChevronRight"
              class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
            <Badge :variant="levelVariant[entry.level]" class="shrink-0">
              {{ levelLabel[entry.level] ?? entry.level }}
            </Badge>
            <span class="shrink-0 text-[11px] text-muted-foreground">
              {{ entry.timestamp || '无时间戳' }}
            </span>
            <span class="min-w-0 flex-1 break-words text-xs text-foreground">
              {{ entry.message }}
            </span>
          </button>

          <div v-if="expanded.includes(index)" class="mt-2 ml-6 border-l border-border pl-3">
            <p v-if="fieldEntries(entry).length === 0" class="font-mono text-[11px] text-muted-foreground">
              无附加字段
            </p>
            <dl v-else class="flex flex-col gap-1">
              <div v-for="[key, value] in fieldEntries(entry)" :key="key" class="flex gap-2 text-[11px]">
                <dt class="shrink-0 font-mono text-muted-foreground">{{ key }}</dt>
                <dd class="min-w-0 break-all font-mono text-foreground">{{ value }}</dd>
              </div>
            </dl>
          </div>
        </li>
      </ul>

      <div v-else class="flex flex-col items-center gap-2 py-14 text-muted-foreground">
        <Activity class="h-6 w-6" />
        <p class="text-xs">{{ loading ? '正在读取…' : '当前筛选条件下没有日志记录' }}</p>
      </div>
    </Card>

    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
      <Button variant="outline" size="sm" :disabled="page <= 1" @click="page -= 1">上一页</Button>
      <span class="text-xs text-muted-foreground">第 {{ page }} / {{ totalPages }} 页</span>
      <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="page += 1">下一页</Button>
    </div>
  </div>
</template>
