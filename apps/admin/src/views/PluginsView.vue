<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { AlertTriangle, Link2, Power, RefreshCw, Settings2, ShieldAlert, Trash2, Download } from 'lucide-vue-next';
import type {
  PluginJobDto,
  PluginSettingsDto,
  PluginState,
  PluginSummary,
  PluginUpdateInfo,
  PluginUpdateReport,
  ValidationIssue
} from '@ricenote/shared';
import { api, ApiError, Badge, Button, Card, Dialog } from '@ricenote/admin-sdk';
import { useAuth } from '@/stores/auth';
import { useSystemState } from '@/stores/system';
import { useToast } from '@/stores/toast';
import SettingsForm from '@/components/settings/SettingsForm.vue';
import PluginInstallCard from '@/components/plugins/PluginInstallCard.vue';
import CatalogCard from '@/components/plugins/CatalogCard.vue';
import PluginJobPanel from '@/components/plugins/PluginJobPanel.vue';
/** 声明式设置表单的值（键为插件声明的字段名）。 */
const settingsValues = reactive<Record<string, unknown>>({});

interface Diagnostics {
  invalid: { dir: string; id: string | null; issues: ValidationIssue[] }[];
  dependencyProblems: { pluginId: string; key: string; kind: string; message: string }[];
  coreApiVersion: string;
}

const auth = useAuth();
const toast = useToast();
const system = useSystemState();

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
        ? `已禁用 ${plugin.id}，重启后路由才会卸载`
        : `已启用 ${plugin.id}，重启后生效`
    );
    await Promise.all([load(), system.refresh()]);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '操作失败');
  } finally {
    busyId.value = null;
  }
}

/* ------------------------------- 插件设置 ------------------------------- */

const settingsOpen = ref(false);
const settingsLoading = ref(false);
const settingsSaving = ref(false);
const settingsDto = ref<PluginSettingsDto | null>(null);
const restartHint = ref('');

async function openSettings(plugin: PluginSummary): Promise<void> {
  settingsOpen.value = true;
  settingsLoading.value = true;
  settingsDto.value = null;
  restartHint.value = '';

  try {
    const dto = await api.get<PluginSettingsDto>(`/plugins/${plugin.id}/settings`);
    settingsDto.value = dto;
    for (const key of Object.keys(settingsValues)) delete settingsValues[key];
    Object.assign(settingsValues, dto.values);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '插件设置加载失败');
    settingsOpen.value = false;
  } finally {
    settingsLoading.value = false;
  }
}

async function saveSettings(): Promise<void> {
  if (!settingsDto.value) return;
  settingsSaving.value = true;
  try {
    const result = await api.put<PluginSettingsDto>(`/plugins/${settingsDto.value.pluginId}/settings`, {
      values: { ...settingsValues }
    });
    settingsDto.value = result;
    restartHint.value = `设置已保存。插件在启动时读取配置，重启后生效。`;
    toast.success('插件设置已保存，重启后生效');
    // 顶栏据此出现重启按钮
    system.markPending(`插件「${result.name}」的设置已保存，重启后生效`);
    await system.refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    settingsSaving.value = false;
  }
}

/* --------------------------- 安装 / 更新 / 卸载 --------------------------- */

const canInstall = computed(() => auth.can('plugin.install'));

/** 更新检查结果（按 pluginId 索引；未检查或不可检查时为空）。 */
const updates = ref<Record<string, PluginUpdateInfo>>({});
const updateCheckedAt = ref('');
/** 当前正在查看的任务（安装卡片自己管理，更新/卸载由这里托管）。 */
const activeJob = ref<PluginJobDto | null>(null);
const jobOpen = ref(false);
const busyAction = ref<string | null>(null);
/** 官方插件目录：任务结束后要重新拉取它的"已装/可更新"状态。 */
const catalogCard = ref<InstanceType<typeof CatalogCard> | null>(null);

/** 目录区块提交任务后，复用同一套任务面板呈现进度与日志。 */
function onCatalogJob(job: PluginJobDto): void {
  activeJob.value = job;
  jobOpen.value = true;
}

async function loadUpdates(): Promise<void> {
  try {
    const report = await api.get<PluginUpdateReport>('/plugins/updates');
    updates.value = Object.fromEntries(report.items.map((item) => [item.pluginId, item]));
    updateCheckedAt.value = report.checkedAt;
  } catch {
    /*
     * 更新检查需要联网（npm registry / git 远端）。检查失败不应影响扩展中心
     * 的可用性，因此这里静默降级为"暂无更新信息"。
     */
    updates.value = {};
    updateCheckedAt.value = '';
  }
}

/** 更新：沿用已记录的来源，无需管理员再填一次。 */
async function updatePlugin(plugin: PluginSummary): Promise<void> {
  busyAction.value = plugin.id;
  try {
    const job = await api.post<PluginJobDto>(`/plugins/${plugin.id}/update`, {});
    activeJob.value = job;
    jobOpen.value = true;
    toast.info(`已提交 ${plugin.id} 的更新任务`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '更新任务提交失败');
  } finally {
    busyAction.value = null;
  }
}

async function removePlugin(plugin: PluginSummary): Promise<void> {
  const confirmed = window.confirm(
    `确定卸载「${plugin.name}」（${plugin.id}）？\n\n` +
      '将删除插件目录与安装记录；插件自己的数据表不会被删除（ADR-007）。'
  );
  if (!confirmed) return;

  busyAction.value = plugin.id;
  try {
    const job = await api.post<PluginJobDto>(`/plugins/${plugin.id}/remove`, {});
    activeJob.value = job;
    jobOpen.value = true;
    toast.info(`已提交 ${plugin.id} 的卸载任务`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '卸载任务提交失败');
  } finally {
    busyAction.value = null;
  }
}

/** 任务结束：刷新列表与更新信息（安装会改变两者的内容）。 */
function onJobFinished(finished: PluginJobDto): void {
  jobOpen.value = false;
  activeJob.value = finished;
  void load();
  void loadUpdates();
  // 目录区块的"已安装版本/可更新"来自服务端合并视图，必须一起刷新
  void catalogCard.value?.load();
  system.refresh().catch(() => undefined);
}

/** 来源信息的中文标签与地址。 */
function sourceLabel(plugin: PluginSummary): string {
  const source = plugin.source;
  if (!source) return '来源未知（v0.4.0 之前安装）';
  if (source.type === 'registry') {
    return `npm：${source.spec}${source.resolvedVersion ? ` → ${source.resolvedVersion}` : ''}`;
  }
  if (source.type === 'git') {
    return `Git：${source.spec}#${source.ref ?? 'HEAD'}`;
  }
  return `本地：${source.spec || '（未记录路径）'}${source.via === 'zip' ? '（压缩包）' : ''}`;
}

onMounted(() => {
  void load();
  void loadUpdates();
});
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

    <!-- 插件安装：三种来源（npm / Git / 本地）+ 任务实时日志 -->
    <PluginInstallCard :can-install="canInstall" @finished="onJobFinished" />

    <!-- 官方插件目录：随主程序发布的推荐版本，可一键安装/更新 -->
    <CatalogCard ref="catalogCard" :can-install="canInstall" @job="onCatalogJob" />

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
              <!--
                「官方」与「随仓库分发」是两件事：从 npm 安装的官方插件同样显示官方徽章，
                但它可更新、可卸载；只有随仓库分发的那份才不可卸载。
              -->
              <Badge v-if="plugin.official" variant="outline">官方</Badge>
              <Badge v-if="plugin.builtin" variant="muted">随仓库分发</Badge>
              <Badge v-if="updates[plugin.id]?.updateAvailable" variant="warning">
                可更新 {{ updates[plugin.id]?.latestVersion }}
              </Badge>
            </div>
            <p class="mt-1 font-mono text-[11px] text-muted-foreground">
              {{ plugin.id }} · v{{ plugin.version }} · API {{ plugin.apiVersion }}
            </p>
            <p class="mt-1 truncate text-[11px] text-muted-foreground" :title="sourceLabel(plugin)">
              {{ sourceLabel(plugin) }}
            </p>
            <p v-if="plugin.description" class="mt-2 text-xs leading-relaxed text-muted-foreground">
              {{ plugin.description }}
            </p>
          </div>

          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button v-if="canInstall && updates[plugin.id]?.updateAvailable" size="sm" :loading="busyAction === plugin.id" @click="updatePlugin(plugin)">
              <Download class="h-3.5 w-3.5" />
              更新
            </Button>
            <Button variant="ghost" size="sm" @click="openSettings(plugin)">
              <Settings2 class="h-3.5 w-3.5" />
              设置
            </Button>
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
            <Button
              v-if="canInstall && !plugin.builtin"
              variant="ghost"
              size="sm"
              class="text-destructive hover:text-destructive"
              :loading="busyAction === plugin.id"
              @click="removePlugin(plugin)"
            >
              <Trash2 class="h-3.5 w-3.5" />
              卸载
            </Button>
          </div>
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

          <!-- 更新状态：可更新 / 不可检查的原因（本地来源与历史记录） -->
          <p v-if="updates[plugin.id]?.updateAvailable" class="text-[11px] text-warning">
            有可用更新：{{ updates[plugin.id]?.latestVersion }}（当前 v{{ plugin.version }}）
          </p>
          <p
            v-else-if="updates[plugin.id] && !updates[plugin.id]?.checkable && updates[plugin.id]?.note"
            class="text-[11px] text-muted-foreground"
          >
            {{ updates[plugin.id]?.note }}
          </p>
        </div>
      </Card>
    </div>

    <!-- 更新 / 卸载任务：进度与实时日志 -->
    <Dialog v-model:open="jobOpen" title="插件任务" width="lg">
      <PluginJobPanel :job="activeJob" @finished="onJobFinished" />
    </Dialog>

    <!-- 插件设置：按 settingsSchema 声明自动生成表单 -->
    <Dialog
      v-model:open="settingsOpen"
      :title="settingsDto ? `插件设置 · ${settingsDto.name}` : '插件设置'"
      :description="settingsDto ? `${settingsDto.pluginId} · v${settingsDto.version} · revision ${settingsDto.revision}` : ''"
      width="lg"
    >
      <p v-if="settingsLoading" class="py-6 text-center text-xs text-muted-foreground">
        正在加载设置…
      </p>

      <template v-else-if="settingsDto">
        <div
          v-if="restartHint"
          class="mb-4 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning"
        >
          {{ restartHint }}
        </div>

        <div v-if="settingsDto.groups.length" class="flex flex-col gap-4">
          <SettingsForm
            :groups="settingsDto.groups"
            :values="settingsValues"
            :disabled="!canManage"
            @update="(key: string, value: unknown) => (settingsValues[key] = value)"
          />
        </div>

        <div v-else class="rounded-md border border-border bg-muted/40 p-4">
          <p class="text-xs text-foreground">
            该插件未声明 <span class="font-mono">settingsSchema</span>，因此没有可自动生成的表单。
          </p>
          <pre class="mt-2 overflow-x-auto rounded border border-border bg-card p-2 font-mono text-[11px] text-muted-foreground">{{
            JSON.stringify(settingsValues, null, 2)
          }}</pre>
          <p class="mt-2 text-[11px] text-muted-foreground">
            如需在此编辑，请在插件 manifest.json 中声明 settingsSchema（分组 + 字段）。
          </p>
        </div>
      </template>

      <template #footer>
        <Button variant="ghost" @click="settingsOpen = false">关闭</Button>
        <Button
          v-if="canManage && settingsDto?.groups.length"
          :loading="settingsSaving"
          @click="saveSettings"
        >
          保存设置
        </Button>
      </template>
    </Dialog>
  </div>
</template>
