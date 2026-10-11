<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { AlertTriangle, Archive, Download, HardDrive, RotateCcw, Trash2, Upload } from 'lucide-vue-next';
import type { BackupManifest, BackupSnapshot } from '@ricenote/shared';
import { api, ApiError, Badge, Button, Card, Dialog, formatBytes, formatDateTime, saveBlob } from '@ricenote/admin-sdk';
import { useToast } from '@/stores/toast';

interface InspectResult {
  manifest: BackupManifest;
  dumpBytes: number;
}

const toast = useToast();

const snapshots = ref<BackupSnapshot[]>([]);
const loading = ref(false);
const exporting = ref(false);
const restoring = ref(false);
const inspecting = ref(false);

const selectedFile = ref<File | null>(null);
const preview = ref<InspectResult | null>(null);
const confirmOpen = ref(false);
const rollbackTarget = ref<BackupSnapshot | null>(null);

const fileInput = ref<HTMLInputElement | null>(null);
const dragActive = ref(false);

const busy = computed(() => exporting.value || restoring.value || inspecting.value);

async function loadSnapshots(): Promise<void> {
  loading.value = true;
  try {
    snapshots.value = await api.get<BackupSnapshot[]>('/backup/snapshots');
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '快照列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function exportBackup(): Promise<void> {
  exporting.value = true;
  try {
    const { blob, filename } = await api.download('/backup/export');
    saveBlob(blob, filename);
    toast.success('备份已开始下载');
    await loadSnapshots();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '备份导出失败');
  } finally {
    exporting.value = false;
  }
}

async function pickFile(file: File | null): Promise<void> {
  selectedFile.value = file;
  preview.value = null;
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.zip')) {
    toast.error('备份包必须是 .zip 文件');
    selectedFile.value = null;
    return;
  }

  inspecting.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    preview.value = await api.upload<InspectResult>('/backup/inspect', formData);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '无法解析该备份包');
    selectedFile.value = null;
  } finally {
    inspecting.value = false;
  }
}

function onDrop(event: DragEvent): void {
  dragActive.value = false;
  const file = event.dataTransfer?.files?.[0] ?? null;
  void pickFile(file);
}

async function confirmRestore(): Promise<void> {
  if (!selectedFile.value) return;
  restoring.value = true;
  try {
    const formData = new FormData();
    formData.append('file', selectedFile.value);
    const result = await api.upload<{ snapshot: BackupSnapshot; restartRequired: boolean }>(
      '/backup/restore',
      formData
    );
    confirmOpen.value = false;
    selectedFile.value = null;
    preview.value = null;
    if (fileInput.value) fileInput.value.value = '';
    toast.success(`恢复完成，已自动保存恢复前快照 ${result.snapshot.name}，请重启服务端`);
    await loadSnapshots();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '恢复失败');
  } finally {
    restoring.value = false;
  }
}

async function rollback(): Promise<void> {
  const target = rollbackTarget.value;
  if (!target) return;
  restoring.value = true;
  try {
    const result = await api.post<{ snapshot: BackupSnapshot }>(`/backup/snapshots/${encodeURIComponent(target.name)}/restore`);
    rollbackTarget.value = null;
    toast.success(`已回滚到 ${target.name}，恢复前快照：${result.snapshot.name}，请重启服务端`);
    await loadSnapshots();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '回滚失败');
  } finally {
    restoring.value = false;
  }
}

async function downloadSnapshot(snapshot: BackupSnapshot): Promise<void> {
  try {
    const { blob, filename } = await api.download(
      `/backup/snapshots/${encodeURIComponent(snapshot.name)}`,
      { method: 'GET' }
    );
    saveBlob(blob, filename);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '快照下载失败');
  }
}

async function removeSnapshot(snapshot: BackupSnapshot): Promise<void> {
  try {
    await api.delete(`/backup/snapshots/${encodeURIComponent(snapshot.name)}`);
    toast.success(`已删除快照 ${snapshot.name}`);
    await loadSnapshots();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

onMounted(loadSnapshots);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">备份与恢复</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          备份包含数据库全量导出、上传文件与已安装插件/主题清单。恢复前会
          <strong class="text-foreground">自动生成当前状态快照</strong>，因此任何一次恢复都可以回退。
        </p>
      </div>
      <Button variant="outline" :loading="loading" @click="loadSnapshots">刷新</Button>
    </header>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card class="flex flex-col gap-3 p-5">
        <div class="flex items-center gap-2">
          <Archive class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">导出备份</h2>
        </div>
        <p class="text-xs text-muted-foreground">
          导出为 ZIP 直接下载，包含：
        </p>
        <ul class="flex flex-col gap-1 text-xs text-muted-foreground">
          <li>· <span class="font-mono text-foreground">manifest.json</span> — 导出时间、站点、插件与主题清单</li>
          <li>· <span class="font-mono text-foreground">database.sql</span> — mysqldump 全量导出</li>
          <li>· <span class="font-mono text-foreground">uploads/**</span> — 媒体库文件</li>
        </ul>
        <div>
          <Button :loading="exporting" :disabled="busy" @click="exportBackup">
            <Download class="h-4 w-4" />
            立即导出
          </Button>
        </div>
      </Card>

      <Card class="flex flex-col gap-3 p-5">
        <div class="flex items-center gap-2">
          <Upload class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">上传恢复</h2>
        </div>

        <div
          class="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors"
          :class="dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'"
          @dragover.prevent="dragActive = true"
          @dragleave.prevent="dragActive = false"
          @drop.prevent="onDrop"
          @click="fileInput?.click()"
        >
          <Upload class="h-5 w-5 text-muted-foreground" />
          <p class="text-xs text-foreground">
            {{ selectedFile ? selectedFile.name : '点击选择或拖拽备份 ZIP 到此处' }}
          </p>
          <p class="text-[11px] text-muted-foreground">
            {{ selectedFile ? formatBytes(selectedFile.size) : '选择后会先解析包内清单，确认后才执行恢复' }}
          </p>
        </div>
        <input ref="fileInput" type="file" accept=".zip" class="hidden" @change="pickFile(($event.target as HTMLInputElement).files?.[0] ?? null)">

        <div v-if="inspecting" class="text-xs text-muted-foreground">正在解析备份包…</div>

        <div v-if="preview" class="rounded-md border border-border bg-muted/40 p-3 text-xs">
          <p class="font-medium text-foreground">包内清单</p>
          <dl class="mt-2 grid grid-cols-2 gap-y-1.5">
            <dt class="text-muted-foreground">导出时间</dt>
            <dd class="text-foreground">{{ formatDateTime(preview.manifest.createdAt) }}</dd>
            <dt class="text-muted-foreground">来源站点</dt>
            <dd class="text-foreground">{{ preview.manifest.siteId }} · v{{ preview.manifest.appVersion }}</dd>
            <dt class="text-muted-foreground">数据库</dt>
            <dd class="text-foreground">{{ preview.manifest.database.name }}</dd>
            <dt class="text-muted-foreground">数据库导出体积</dt>
            <dd class="text-foreground">{{ formatBytes(preview.dumpBytes) }}</dd>
            <dt class="text-muted-foreground">上传文件</dt>
            <dd class="text-foreground">
              {{ preview.manifest.uploads.fileCount }} 个 · {{ formatBytes(preview.manifest.uploads.totalBytes) }}
            </dd>
            <dt class="text-muted-foreground">插件 / 主题</dt>
            <dd class="text-foreground">{{ preview.manifest.plugins.length }} / {{ preview.manifest.themes.length }}</dd>
          </dl>
        </div>

        <div class="flex items-start gap-2 rounded-md border border-[hsl(var(--warning))] bg-[hsl(var(--warning))]/5 p-3">
          <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
          <p class="text-[11px] text-muted-foreground">
            恢复会<strong class="text-foreground">覆盖当前数据库与上传文件</strong>。系统会先自动保存一份当前状态快照，
            恢复成功后需要重启服务端进程才能让插件与主题状态完全生效。
          </p>
        </div>

        <div>
          <Button
            variant="destructive"
            :disabled="!preview || busy"
            :loading="restoring"
            @click="confirmOpen = true"
          >
            <RotateCcw class="h-4 w-4" />
            执行恢复
          </Button>
        </div>
      </Card>
    </div>

    <Card class="overflow-hidden">
      <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div class="flex items-center gap-2">
          <HardDrive class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">恢复前快照</h2>
        </div>
        <span class="text-[11px] text-muted-foreground">共 {{ snapshots.length }} 份 · 保留在 storage/backups</span>
      </div>

      <div v-if="snapshots.length > 0" class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead class="border-b border-border">
            <tr>
              <th class="rn-th">文件名</th>
              <th class="rn-th w-28">体积</th>
              <th class="rn-th w-40">生成时间</th>
              <th class="rn-th w-56 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="snapshot in snapshots" :key="snapshot.name" class="transition-colors hover:bg-muted/40">
              <td class="rn-td font-mono text-xs text-foreground">{{ snapshot.name }}</td>
              <td class="rn-td text-xs text-muted-foreground">{{ formatBytes(snapshot.size) }}</td>
              <td class="rn-td text-xs text-muted-foreground">{{ formatDateTime(snapshot.createdAt) }}</td>
              <td class="rn-td">
                <div class="flex justify-end gap-2">
                  <Button variant="outline" size="sm" @click="downloadSnapshot(snapshot)">下载</Button>
                  <Button variant="outline" size="sm" :disabled="busy" @click="rollbackTarget = snapshot">回滚</Button>
                  <Button variant="ghost" size="sm" :disabled="busy" @click="removeSnapshot(snapshot)">
                    <Trash2 class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="flex flex-col items-center gap-2 py-14 text-muted-foreground">
        <HardDrive class="h-6 w-6" />
        <p class="text-xs">还没有快照。每次执行恢复（上传包或回滚）前都会自动生成一份。</p>
      </div>
    </Card>

    <Dialog
      :open="confirmOpen"
      title="确认恢复备份"
      description="该操作会覆盖当前数据库与上传文件，且不可撤销（但可回滚到自动快照）。"
      width="md"
      @update:open="confirmOpen = false"
    >
      <div class="flex flex-col gap-3 text-xs">
        <p class="text-foreground">
          即将恢复：<span class="font-mono">{{ selectedFile?.name }}</span>
        </p>
        <p class="text-muted-foreground">
          系统会先生成一份当前状态快照；若恢复结果不符预期，可在"历史快照"中回滚。
        </p>
        <p class="text-muted-foreground">恢复完成后需要重启服务端进程。</p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" @click="confirmOpen = false">取消</Button>
          <Button variant="destructive" size="sm" :loading="restoring" @click="confirmRestore">确认恢复</Button>
        </div>
      </template>
    </Dialog>

    <Dialog
      :open="rollbackTarget !== null"
      title="确认回滚"
      :description="`将把站点数据回滚到快照 ${rollbackTarget?.name ?? ''}。`"
      width="md"
      @update:open="rollbackTarget = null"
    >
      <div class="flex flex-col gap-3 text-xs">
        <p class="text-muted-foreground">
          回滚会覆盖当前数据库与上传文件。系统同样会先生成一份当前状态快照。
        </p>
        <p v-if="rollbackTarget" class="text-muted-foreground">
          快照生成于 {{ formatDateTime(rollbackTarget.createdAt) }}，体积 {{ formatBytes(rollbackTarget.size) }}。
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" @click="rollbackTarget = null">取消</Button>
          <Button variant="destructive" size="sm" :loading="restoring" @click="rollback">确认回滚</Button>
        </div>
      </template>
    </Dialog>
  </div>
</template>
