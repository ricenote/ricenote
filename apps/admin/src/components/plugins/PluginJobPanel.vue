<script setup lang="ts">
/**
 * 安装任务面板：步骤条 + 进度 + 等宽日志。
 *
 * 为什么用轮询而不是 SSE：安装任务的日志是低频、短时的，轮询（700ms）
 * 在任何反向代理与浏览器组合下都可靠；SSE 需要额外处理断线重连与代理缓冲，
 * 收益不成比例。任务结束后立即停止轮询，不留下常驻定时器。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Check, Copy, Loader2, X } from 'lucide-vue-next';
import type { PluginJobDto, PluginJobStep } from '@ricenote/shared';
import { api, ApiError, Badge, Button, useToast } from '@ricenote/admin-sdk';

const props = defineProps<{ job: PluginJobDto | null }>();
const emit = defineEmits<{ (event: 'finished', job: PluginJobDto): void }>();

const toast = useToast();
const current = ref<PluginJobDto | null>(props.job);
const logBox = ref<HTMLDivElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

const STEPS: { key: PluginJobStep; label: string }[] = [
  { key: 'resolve', label: '解析来源' },
  { key: 'prepare', label: '准备与构建' },
  { key: 'commit', label: '落盘' }
];

const running = computed(
  () => current.value?.status === 'queued' || current.value?.status === 'running'
);

const stepIndex = computed(() => {
  const step = current.value?.step;
  if (current.value?.status === 'succeeded') return STEPS.length;
  const index = STEPS.findIndex((item) => item.key === step);
  return index < 0 ? 0 : index;
});

const logLines = computed(() =>
  (current.value?.log ?? '')
    .split('\n')
    .filter((line) => line.length > 0)
);

const statusTone = computed(() => {
  switch (current.value?.status) {
    case 'succeeded':
      return 'success' as const;
    case 'failed':
      return 'error' as const;
    case 'running':
      return 'warning' as const;
    default:
      return 'muted' as const;
  }
});

const statusLabel = computed(() => {
  switch (current.value?.status) {
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'running':
      return '进行中';
    case 'queued':
      return '排队中';
    default:
      return '—';
  }
});

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

async function poll(): Promise<void> {
  if (!current.value) return;
  try {
    const next = await api.get<PluginJobDto>(`/plugins/jobs/${current.value.id}`);
    current.value = next;
    await nextTick();
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;

    if (next.status === 'succeeded' || next.status === 'failed') {
      stop();
      emit('finished', next);
      return;
    }
  } catch (error) {
    stop();
    toast.error(error instanceof ApiError ? error.message : '任务状态获取失败');
    return;
  }
  timer = setTimeout(() => void poll(), 700);
}

watch(
  () => props.job,
  (next) => {
    stop();
    current.value = next;
    if (next && (next.status === 'queued' || next.status === 'running')) {
      void poll();
    }
  },
  { immediate: true }
);

onBeforeUnmount(stop);

async function copyLog(): Promise<void> {
  const text = current.value?.log ?? '';
  if (text.length === 0) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success('日志已复制');
  } catch {
    // 浏览器拒绝剪贴板权限时不阻断任务查看：提示用户手动选中即可
    toast.info('无法访问剪贴板，请手动选中日志复制');
  }
}
</script>

<template>
  <div v-if="current" class="rounded-md border border-border bg-card">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
      <div class="flex items-center gap-2">
        <Loader2 v-if="running" class="h-3.5 w-3.5 animate-spin text-warning" />
        <Check v-else-if="current.status === 'succeeded'" class="h-3.5 w-3.5 text-success" />
        <X v-else class="h-3.5 w-3.5 text-destructive" />
        <span class="text-xs font-medium text-foreground">
          {{
            current.action === 'install' ? '安装' : current.action === 'update' ? '更新' : '卸载'
          }}任务
        </span>
        <Badge :variant="statusTone">{{ statusLabel }}</Badge>
        <span v-if="current.pluginId" class="font-mono text-[11px] text-muted-foreground">
          {{ current.pluginId }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[11px] text-muted-foreground">{{ current.progress }}%</span>
        <Button variant="ghost" size="sm" :disabled="logLines.length === 0" @click="copyLog">
          <Copy class="h-3 w-3" />
          复制日志
        </Button>
      </div>
    </div>

    <!-- 步骤条 -->
    <div class="flex items-center gap-2 px-3 py-2.5">
      <template v-for="(step, index) in STEPS" :key="step.key">
        <div class="flex items-center gap-1.5">
          <span
            class="flex h-4 w-4 items-center justify-center rounded-full border text-[10px]"
            :class="
              index < stepIndex
                ? 'border-success bg-success text-white'
                : index === stepIndex && running
                  ? 'border-warning text-warning'
                  : 'border-border text-muted-foreground'
            "
          >
            {{ index + 1 }}
          </span>
          <span
            class="text-[11px]"
            :class="index <= stepIndex ? 'text-foreground' : 'text-muted-foreground'"
          >
            {{ step.label }}
          </span>
        </div>
        <span
          v-if="index < STEPS.length - 1"
          class="h-px flex-1"
          :class="index < stepIndex ? 'bg-success' : 'bg-border'"
        />
      </template>
    </div>

    <div class="h-1 w-full overflow-hidden bg-muted">
      <div
        class="h-full bg-primary transition-all duration-300"
        :class="current.status === 'failed' ? 'bg-destructive' : ''"
        :style="{ width: `${Math.max(2, current.progress)}%` }"
      />
    </div>

    <div class="border-t border-border px-3 py-2.5">
      <p v-if="current.error" class="mb-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
        {{ current.error }}
      </p>
      <div
        ref="logBox"
        class="max-h-56 overflow-y-auto rounded border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"
      >
        <p v-if="logLines.length === 0" class="text-muted-foreground">等待输出…</p>
        <p
          v-for="(line, index) in logLines"
          :key="index"
          class="whitespace-pre-wrap break-all"
          :class="line.startsWith('✗') ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ line }}
        </p>
      </div>
      <p v-if="current.status === 'succeeded'" class="mt-2 text-[11px] text-warning">
        安装已完成，请重启服务端进程使其生效。
      </p>
    </div>
  </div>
</template>
