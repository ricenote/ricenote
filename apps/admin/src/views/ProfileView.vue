<script setup lang="ts">
/**
 * 个人资料：资料区与密码区。
 *
 * 两件事刻意分开：
 * - 资料修改（显示名/邮箱）风险低，不需要原密码；
 * - 改密码必须校验原密码，且成功后**其他设备的会话会被强制失效**。
 */
import { onMounted, reactive, ref } from 'vue';
import { KeyRound, ShieldCheck, UserRound } from 'lucide-vue-next';
import type { AuthUser } from '@ricenote/shared';
import { api, ApiError, Badge, Button, Card, Input, Label } from '@ricenote/admin-sdk';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';

const auth = useAuth();
const toast = useToast();

const profile = ref<AuthUser | null>(null);
const loading = ref(false);
const savingProfile = ref(false);
const savingPassword = ref(false);

const profileForm = reactive({ displayName: '', email: '' });
const passwordForm = reactive({ currentPassword: '', nextPassword: '', confirmPassword: '' });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<AuthUser>('/me');
    profile.value = data;
    profileForm.displayName = data.displayName;
    profileForm.email = data.email;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '资料加载失败');
  } finally {
    loading.value = false;
  }
}

async function saveProfile(): Promise<void> {
  if (!profileForm.displayName.trim()) {
    toast.error('显示名不能为空');
    return;
  }

  savingProfile.value = true;
  try {
    const updated = await api.put<AuthUser>('/me', {
      displayName: profileForm.displayName.trim(),
      email: profileForm.email.trim()
    });
    profile.value = updated;
    toast.success('资料已保存');
    // 顶栏显示名来自会话快照，刷新一次让界面同步
    await auth.refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '资料保存失败');
  } finally {
    savingProfile.value = false;
  }
}

async function savePassword(): Promise<void> {
  if (!passwordForm.currentPassword || !passwordForm.nextPassword) {
    toast.error('请填写原密码与新密码');
    return;
  }
  if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
    toast.error('两次输入的新密码不一致');
    return;
  }

  savingPassword.value = true;
  try {
    await api.post('/me/password', {
      currentPassword: passwordForm.currentPassword,
      nextPassword: passwordForm.nextPassword
    });
    passwordForm.currentPassword = '';
    passwordForm.nextPassword = '';
    passwordForm.confirmPassword = '';
    toast.success('密码已修改，其他设备的登录已失效');
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '密码修改失败');
  } finally {
    savingPassword.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header>
      <h1 class="text-xl font-semibold text-foreground">个人资料</h1>
      <p class="mt-1 text-xs text-muted-foreground">
        修改显示名与邮箱，或更换登录密码。改密后其他设备上的会话会被强制失效。
      </p>
    </header>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card class="p-5">
        <div class="flex items-center gap-2">
          <UserRound class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">账户资料</h2>
        </div>

        <dl class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <dt>登录名</dt>
          <dd class="font-mono text-foreground">{{ profile?.username ?? '—' }}</dd>
        </dl>

        <div v-if="profile?.roles.length" class="mt-2 flex flex-wrap items-center gap-1.5">
          <span class="text-xs text-muted-foreground">角色</span>
          <Badge v-for="role in profile.roles" :key="role" variant="outline">{{ role }}</Badge>
        </div>

        <div class="mt-4 flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <Label>显示名</Label>
            <Input v-model="profileForm.displayName" :maxlength="120" placeholder="在后台与前台展示的名字" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>邮箱</Label>
            <Input v-model="profileForm.email" type="email" :maxlength="190" placeholder="name@example.com" />
            <p class="text-[11px] text-muted-foreground">邮箱需唯一，用于账号识别与后续通知。</p>
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <Button :loading="savingProfile" :disabled="loading" @click="saveProfile">保存资料</Button>
        </div>
      </Card>

      <Card class="p-5">
        <div class="flex items-center gap-2">
          <KeyRound class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">修改密码</h2>
        </div>

        <div class="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <ShieldCheck class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            需要先验证原密码。密码至少 8 位，不能是纯数字，也不能与登录名相同。
            修改成功后，其他设备的登录会话会立即失效。
          </p>
        </div>

        <div class="mt-4 flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <Label>原密码</Label>
            <Input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>新密码</Label>
            <Input v-model="passwordForm.nextPassword" type="password" autocomplete="new-password" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>确认新密码</Label>
            <Input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" />
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <Button :loading="savingPassword" @click="savePassword">修改密码</Button>
        </div>
      </Card>
    </div>
  </div>
</template>
