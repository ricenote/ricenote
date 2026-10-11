<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { AlertTriangle, Archive, Link2, Power, RefreshCw, ShieldAlert, Upload } from 'lucide-vue-next';
import type { PluginInstallResult, PluginState, PluginSummary, ValidationIssue } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import { formatBytes } from '@/lib/utils';

interface Diagnostics {
  invalid: { dir: string; id: string | null; issues: ValidationIssue[] }[];
  dependencyProblems: { pluginId: string; key: string; kind: string; message: string }[];
  coreApiVersion: string;
}

const auth = useAuth();
const toast = useToast();

const plugins = ref<PluginSummary[]>([]);
const diagnostics = ref<Diagnostics | null>(null);
const loading = ref(false);
const busyId = ref<string | null>(null);

const canManage = computed(() => auth.can('plugin.manage'));
const failedCount = computed(() => plugins.value.filter((item) => item.state === 'FAILED').length);
const pendingRestart = computed(() =>
  plugins.value.filter((item) => item.state === 'ENABLED' || item.state === 'DISABLED').length
);

const stateTone: Record<PluginState, 'success' | 'warning' | 'error' | 'muted' | 'outline'> = {
  STARTED: 'success',
  ENABLED: 'warning',
  STOPPED: 'muted',
  DISABLED: 'muted',
  FAILED: 'error',
  INSTALLED: 'outline',
  VALIDATED: 'outline',
  DISCOVERED: 'outline'
};

const stateLabel: Record<PluginState, string> = {
  STARTED: '运行中',
  ENABLED: '已启用（待重启）',
  STOPPED: '已停止',
  DISABLED: '已禁用',
  FAILED: '失败',
  INSTALLED: '已安装',
  VALIDATED: '已校验',
  DISCOVERED: '已发现'
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.raw<{ data: PluginSummary[]; diagnostics: Diagnostics }>('GET', '/plugins');
    plugins.value = response.data;
    diagnostics.value = response.diagnostics;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '插件列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function toggle(plugin: PluginSummary): Promise<void> {
  const action = plugin.enabled ? 'disable' : 'enable';
  busyId.value = plugin.id;
  try {
    await api.post(`/plugins/${plugin.id}/${action}`);
    toast.success(
      plugin.enabled
        ? `已禁用 ${plugin.id}，重启进程后路由才会卸载`
        : `已启用 ${plugin.id}，重启进程后生效`
    );
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '操作失败');
  } finally {
    busyId.value = null;
  }
}

/* ------------------------------ 插件包安装 ------------------------------ */

const installFile = ref<File | null>(null);
const installInput = ref<HTMLInputElement | null>(null);
const installing = ref(false);
const installDragActive = ref(false);
const installResult = ref<PluginInstallResult | null>(null);

function pickInstallFile(file: File | null): void {
  installResult.value = null;
  if (file && !file.name.toLowerCase().endsWith('.zip')) {
    toast.error('插件包必须是 .zip 文件');
    installFile.value = null;
    return;
  }
  installFile.value = file;
}

function onInstallDrop(event: DragEvent): void {
  installDragActive.value = false;
  pickInstallFile(event.dataTransfer?.files?.[0] ?? null);
}

async function installPlugin(): Promise<void> {
  if (!installFile.value) return;
  installing.value = true;
  try {
    const formData = new FormData();
    formData.append('file', installFile.value);
    const result = await api.upload<PluginInstallResult>('/plugins/install', formData);

    installResult.value = result;
    installFile.value = null;
    if (installInput.value) installInput.value.value = '';
    toast.success(
      result.upgraded
        ? `已升级 ${result.pluginId} 到 v${result.version}，请重启进程使其生效`
        : `已安装 ${result.pluginId} v${result.version}，启用后需重启进程`
    );
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '插件安装失败');
  } finally {
    installing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">扩展中心</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          插件通过目录安装、以 capability 契约解析依赖；启停为受控重启语义（ADR-004）
        </p>
      </div>
      <Button variant="outline" :loading="loading" @click="load">
        <RefreshCw class="h-3.5 w-3.5" />
        刷新
      </Button>
    </header>

    <!-- 风险与状态提示 -->
    <Card class="p-4">
      <div class="flex items-start gap-2.5">
        <ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div class="text-xs leading-relaxed text-muted-foreground">
          <p class="font-medium text-foreground">插件运行在核心进程内，不具备真实安全沙箱</p>
          <p class="mt-1">
            仅允许安装受信任插件。禁用被依赖的插件会被拒绝（返回 409 并列出依赖者）；
            启停操作写入数据库后需要<strong class="text-foreground">重启进程</strong>才能让路由变更生效。
          </p>
          <p v-if="pendingRestart > 0" class="mt-1.5 text-warning">
            当前有 {{ pendingRestart }} 个插件处于待重启状态。
          </p>
        </div>
      </div>
    </Card>

    <!-- 插件包安装 -->
    <Card v-if="canManage" class="p-4">
      <div class="flex items-center gap-2">
        <Archive class="h-4 w-4 text-muted-foreground" />
        <h2 class="text-sm font-semibold text-foreground">上传安装插件包</h2>
      </div>
      <p class="mt-1 text-xs text-muted-foreground">
        插件包为包含 <span class="font-mono text-foreground">manifest.json</span> 与构建产物入口的 ZIP。
        包体会先做完整安全校验（路径穿越、符号链接、体积与类型白名单），校验通过后才会落盘。
      </p>

      <div class="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div
          class="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors"
          :class="installDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'"
          @dragover.prevent="installDragActive = true"
          @dragleave.prevent="installDragActive = false"
          @drop.prevent="onInstallDrop"
          @click="installInput?.click()"
        >
          <Upload class="h-5 w-5 text-muted-foreground" />
          <p class="text-xs text-foreground">
            {{ installFile ? installFile.name : '点击选择或拖拽插件 ZIP 到此处' }}
          </p>
          <p class="text-[11px] text-muted-foreground">
            {{ installFile ? formatBytes(installFile.size) : '同 ID 的插件会被视为升级并整体替换目录' }}
          </p>
        </div>

        <div class="flex gap-2">
          <Button :disabled="!installFile" :loading="installing" @click="installPlugin">
            <Upload class="h-3.5 w-3.5" />
            安装 / 升级
          </Button>
          <Button
            v-if="installFile"
            variant="ghost"
            @click="
              () => {
                installFile = null;
                if (installInput) installInput.value = '';
              }
            "
          >
            取消
          </Button>
        </div>
      </div>

      <input ref="installInput" type="file" accept=".zip" class="hidden" @change="pickInstallFile(($event.target as HTMLInputElement).files?.[0] ?? null)">

      <div v-if="installResult" class="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <p class="font-medium text-foreground">
          {{ installResult.upgraded ? '已升级' : '已安装' }} {{ installResult.name }}（{{ installResult.pluginId }}）
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-y-1.5">
          <dt class="text-muted-foreground">版本</dt>
          <dd class="text-foreground">v{{ installResult.version }}</dd>
          <dt class="text-muted-foreground">安装目录</dt>
          <dd class="font-mono text-foreground">{{ installResult.dir }}</dd>
        </dl>
        <p class="mt-2 text-warning">安装已完成，请重启服务端进程使其生效。</p>
      </div>
    </Card>

    <!-- 诊断 -->
    <Card
      v-if="failedCount > 0 || diagnostics?.invalid.length || diagnostics?.dependencyProblems.length"
      class="border-warning/40 p-4"
    >
      <div class="flex items-center gap-2">
        <AlertTriangle class="h-4 w-4 text-warning" />
        <p class="text-sm font-medium text-foreground">启动诊断</p>
      </div>

      <ul v-if="failedCount > 0" class="mt-2 list-inside list-disc text-xs text-muted-foreground">
        <li v-for="plugin in plugins.filter((item) => item.state === 'FAILED')" :key="plugin.id">
          <span class="font-mono">{{ plugin.id }}</span> —— {{ plugin.lastError || '未知错误' }}
        </li>
      </ul>

      <ul v-if="diagnostics?.dependencyProblems.length" class="mt-2 list-inside list-disc text-xs text-muted-foreground">
        <li v-for="problem in diagnostics.dependencyProblems" :key="`${problem.pluginId}-${problem.key}`">
          <span class="font-mono">{{ problem.pluginId }}</span> 的依赖
          <span class="font-mono">{{ problem.key }}</span> —— {{ problem.message }}
        </li>
      </ul>

      <ul v-if="diagnostics?.invalid.length" class="mt-2 list-inside list-disc text-xs text-muted-foreground">
        <li v-for="item in diagnostics.invalid" :key="item.dir">
          <span class="font-mono">{{ item.dir }}</span> 清单非法（
          {{ item.issues.slice(0, 2).map((issue) => issue.message).join('；') }}）
        </li>
      </ul>
    </Card>

    <!-- 插件卡片网格 -->
    <div class="grid gap-4 lg:grid-cols-2">
      <Card v-for="plugin in plugins" :key="plugin.id" hoverable class="p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-semibold text-foreground">{{ plugin.name }}</h2>
              <Badge :variant="stateTone[plugin.state]">{{ stateLabel[plugin.state] }}</Badge>
              <Badge v-if="plugin.builtin" variant="outline">官方</Badge>
            </div>
            <p class="mt-1 font-mono text-[11px] text-muted-foreground">
              {{ plugin.id }} · v{{ plugin.version }} · API {{ plugin.apiVersion }}
            </p>
            <p v-if="plugin.description" class="mt-2 text-xs leading-relaxed text-muted-foreground">
              {{ plugin.description }}
            </p>
          </div>

          <Button
            v-if="canManage"
            :variant="plugin.enabled ? 'outline' : 'default'"
            size="sm"
            :loading="busyId === plugin.id"
            @click="toggle(plugin)"
          >
            <Power class="h-3.5 w-3.5" />
            {{ plugin.enabled ? '禁用' : '启用' }}
          </Button>
        </div>

        <div class="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <div>
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">提供能力</p>
            <div class="mt-1 flex flex-wrap gap-1">
              <Badge v-for="capability in plugin.provides" :key="capability" variant="outline">
                {{ capability }}
              </Badge>
              <span v-if="plugin.provides.length === 0" class="text-[11px] text-muted-foreground">—</span>
            </div>
          </div>

          <div>
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">依赖</p>
            <div class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="dependency in plugin.dependencies"
                :key="dependency.key"
                class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                :class="dependency.satisfied ? 'border-border text-muted-foreground' : 'border-destructive/40 text-destructive'"
              >
                <Link2 class="h-3 w-3" />
                {{ dependency.key }}
                <span class="opacity-70">{{ dependency.range }}</span>
              </span>
              <span v-if="plugin.dependencies.length === 0" class="text-[11px] text-muted-foreground">无</span>
            </div>
          </div>

          <div v-if="plugin.dependents.length">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">被以下插件依赖</p>
            <p class="mt-1 font-mono text-[11px] text-muted-foreground">{{ plugin.dependents.join('、') }}</p>
          </div>

          <p v-if="plugin.lastError" class="text-[11px] text-destructive">错误：{{ plugin.lastError }}</p>
        </div>
      </Card>
    </div>
  </div>
</template>
