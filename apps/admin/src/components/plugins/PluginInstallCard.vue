<script setup lang="ts">
/**
 * 插件安装卡片：npm Registry / Git 仓库 / 本地目录（含压缩包）。
 *
 * 三条来源共用一段「高风险确认 → 提交任务 → 实时日志」流程：
 * 安装第三方插件等同授予其服务器代码执行权限（可执行依赖安装与构建脚本），
 * 因此必须先勾选确认才能提交，且该选择会写进审计。
 */
import { computed, ref } from 'vue';
import { Archive, FileCode2, FolderOpen, GitBranch, Package, Upload } from 'lucide-vue-next';
import type { PluginInstallRequest, PluginJobDto } from '@ricenote/shared';
import {
  api,
  ApiError,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Switch,
  Tabs,
  useToast,
  type TabItem
} from '@ricenote/admin-sdk';
import PluginJobPanel from './PluginJobPanel.vue';

const props = defineProps<{ canInstall: boolean }>();
const emit = defineEmits<{ (event: 'finished', job: PluginJobDto): void }>();

const toast = useToast();

const tabs: TabItem[] = [
  { key: 'registry', label: 'npm 包' },
  { key: 'git', label: 'Git 仓库' },
  { key: 'local', label: '本地目录' }
];

const source = ref('registry');
const registrySpec = ref('');
const gitRepo = ref('');
const gitRef = ref('');
const localPath = ref('');
const localMode = ref<'path' | 'zip'>('path');
const allowScripts = ref(true);

const zipFile = ref<File | null>(null);
const zipInput = ref<HTMLInputElement | null>(null);

const confirmOpen = ref(false);
const confirmed = ref(false);
const submitting = ref(false);
const job = ref<PluginJobDto | null>(null);

/** 提交前的输入校验：把明显的错误留在本地，不占用任务队列。 */
const validationError = computed(() => {
  if (source.value === 'registry' && registrySpec.value.trim().length === 0) {
    return '请填写 npm 包名（可带版本区间，例如 ricenote-plugin-nav@^1.2.0）';
  }
  if (source.value === 'git' && gitRepo.value.trim().length === 0) {
    return '请填写 Git 仓库地址（https:// 或 git@host:path）';
  }
  if (source.value === 'local') {
    if (localMode.value === 'zip' && !zipFile.value) return '请选择插件包（.zip）';
    if (localMode.value === 'path' && localPath.value.trim().length === 0) {
      return '请填写本地插件目录的绝对路径';
    }
  }
  return '';
});

const canSubmit = computed(() => props.canInstall && validationError.value.length === 0);

function openConfirm(): void {
  if (!canSubmit.value) return;
  confirmed.value = false;
  confirmOpen.value = true;
}

function pickZip(file: File | null): void {
  if (file && !file.name.toLowerCase().endsWith('.zip')) {
    toast.error('插件包必须是 .zip 文件');
    zipFile.value = null;
    return;
  }
  zipFile.value = file;
}

/** 按当前来源分组提交；压缩包走 multipart，其余走 JSON。 */
async function submit(): Promise<void> {
  confirmOpen.value = false;
  submitting.value = true;
  job.value = null;

  try {
    if (source.value === 'local' && localMode.value === 'zip') {
      const formData = new FormData();
      formData.append('file', zipFile.value as File);
      job.value = await api.upload<PluginJobDto>('/plugins/install', formData);
      zipFile.value = null;
      if (zipInput.value) zipInput.value.value = '';
    } else {
      const payload: PluginInstallRequest = {
        source:
          source.value === 'registry'
            ? { type: 'registry', spec: registrySpec.value.trim() }
            : source.value === 'git'
              ? {
                  type: 'git',
                  repo: gitRepo.value.trim(),
                  ref: gitRef.value.trim() || 'HEAD'
                }
              : { type: 'directory', path: localPath.value.trim() },
        allowScripts: allowScripts.value
      };
      job.value = await api.post<PluginJobDto>('/plugins/install/source', payload);
    }

    toast.info('安装任务已提交，可在下方查看实时日志');
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '安装任务提交失败');
  } finally {
    submitting.value = false;
  }
}

function onJobFinished(finished: PluginJobDto): void {
  emit('finished', finished);
  if (finished.status === 'succeeded') {
    toast.success(`${finished.pluginId ?? '插件'} 安装完成，重启后生效`);
  } else {
    toast.error(finished.error ?? '安装失败');
  }
}
</script>

<template>
  <Card class="p-4">
    <div class="flex items-center gap-2">
      <Package class="h-4 w-4 text-muted-foreground" />
      <h2 class="text-sm font-semibold text-foreground">安装插件</h2>
      <Badge variant="outline">需要 plugin.install 权限</Badge>
    </div>
    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
      三种来源：<strong class="text-foreground">npm 包</strong>（主路径，自动解析依赖、按语义化版本检查更新）、
      <strong class="text-foreground">Git 仓库</strong>（tag / 提交 / 分支，取源码后按声明构建）、
      <strong class="text-foreground">本地目录</strong>（开发调试直接引用；压缩包为其离线形式）。
    </p>

    <div class="mt-3">
      <Tabs v-model="source" :items="tabs" :disabled="submitting" />
    </div>

    <div class="mt-3 flex flex-col gap-3">
      <template v-if="source === 'registry'">
        <Field label="npm 包名" required>
          <Input
            v-model="registrySpec"
            placeholder="ricenote-plugin-nav@^1.2.0"
            :disabled="submitting"
          />
        </Field>
        <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Package class="h-3 w-3" />
          省略版本时取 <span class="font-mono">latest</span>；私有源请配置环境变量
          <span class="font-mono">RICENOTE_NPM_REGISTRY</span> 与
          <span class="font-mono">RICENOTE_NPM_TOKEN</span>（不落库、不进日志）。
        </p>
      </template>

      <template v-else-if="source === 'git'">
        <Field label="仓库地址" required>
          <Input v-model="gitRepo" placeholder="https://github.com/acme/ricenote-nav.git" :disabled="submitting" />
        </Field>
        <Field label="引用（tag / 提交 / 分支）">
          <Input v-model="gitRef" placeholder="v1.2.0（留空取默认分支 HEAD）" :disabled="submitting" />
        </Field>
        <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <GitBranch class="h-3 w-3" />
          只接受 <span class="font-mono">https://</span>、<span class="font-mono">ssh://</span> 与
          <span class="font-mono">git@host:path</span>；安装时会记录实际检出的提交，便于比较更新。
        </p>
      </template>

      <template v-else>
        <Tabs
          v-model="localMode"
          :items="[
            { key: 'path', label: '填写本地路径' },
            { key: 'zip', label: '选择压缩包上传' }
          ]"
          :disabled="submitting"
        />

        <template v-if="localMode === 'path'">
          <Field label="插件目录绝对路径" required>
            <Input v-model="localPath" placeholder="C:\\projects\\my-plugin 或 /srv/plugins/my-plugin" :disabled="submitting" />
          </Field>
          <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FolderOpen class="h-3 w-3" />
            目录需含 <span class="font-mono">manifest.json</span>；安装会复制到第三方插件目录并按需安装依赖、执行构建。
            开发期想「改动即生效」请改用 <span class="font-mono">RICENOTE_LOCAL_PLUGINS</span> 登记目录（自动重启内核）。
          </p>
        </template>

        <template v-else>
          <div
            class="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed border-border px-4 py-5 text-center transition-colors hover:border-foreground/30"
            @click="zipInput?.click()"
          >
            <Upload class="h-4 w-4 text-muted-foreground" />
            <p class="text-xs text-foreground">{{ zipFile ? zipFile.name : '点击选择插件包（.zip）' }}</p>
            <p class="text-[11px] text-muted-foreground">
              离线兜底，不参与版本管理；包体先做完整安全校验再落盘（路径穿越 / 符号链接 / 体积与类型白名单）
            </p>
          </div>
          <input
            ref="zipInput"
            type="file"
            accept=".zip"
            class="hidden"
            @change="pickZip(($event.target as HTMLInputElement).files?.[0] ?? null)"
          />
        </template>
      </template>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div class="flex items-center gap-2">
          <Switch v-model="allowScripts" :disabled="submitting" />
          <span class="text-xs text-foreground">允许执行依赖安装脚本与构建脚本</span>
        </div>
        <Button :disabled="!canSubmit" :loading="submitting" @click="openConfirm">
          <Archive class="h-3.5 w-3.5" />
          安装 / 升级
        </Button>
      </div>

      <p v-if="validationError" class="text-[11px] text-muted-foreground">{{ validationError }}</p>
      <p v-else-if="!canInstall" class="text-[11px] text-muted-foreground">
        当前账号缺少 <span class="font-mono">plugin.install</span> 权限，只能查看。
      </p>
    </div>

    <PluginJobPanel
      v-if="job"
      class="mt-3"
      :job="job"
      @finished="onJobFinished"
    />

    <!-- 高风险确认 -->
    <Dialog v-model:open="confirmOpen" title="确认安装" width="sm">
      <div class="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning/5 p-3">
        <FileCode2 class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div class="text-xs leading-relaxed text-muted-foreground">
          <p class="font-medium text-foreground">
            安装第三方插件等同于授予其在服务器上执行代码的权限
          </p>
          <p class="mt-1">
            插件在核心进程内运行，<strong class="text-foreground">没有真实安全沙箱</strong>；
            安装过程可执行依赖安装脚本与构建脚本（当前{{ allowScripts ? '已允许' : '已禁用' }}）。
            请只安装你信任的来源，本次操作会写入审计日志。
          </p>
        </div>
      </div>

      <label class="mt-3 flex cursor-pointer items-start gap-2 text-xs text-foreground">
        <input v-model="confirmed" type="checkbox" class="mt-0.5 accent-primary" />
        <span>我已了解上述风险，并确认从该来源安装</span>
      </label>

      <template #footer>
        <Button variant="ghost" @click="confirmOpen = false">取消</Button>
        <Button :disabled="!confirmed" @click="submit">确认安装</Button>
      </template>
    </Dialog>
  </Card>
</template>
