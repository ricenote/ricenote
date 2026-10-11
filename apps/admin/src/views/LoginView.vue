<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { KeyRound, User } from 'lucide-vue-next';
import { ApiError, Button, Card, Input, Label } from '@ricenote/admin-sdk';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';

const auth = useAuth();
const toast = useToast();
const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const errorMessage = ref('');
const submitting = ref(false);

async function submit(): Promise<void> {
  errorMessage.value = '';

  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入用户名与密码';
    return;
  }

  submitting.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    toast.success(`欢迎回来，${auth.displayName.value}`);
    const redirect = route.query.redirect;
    await router.push(typeof redirect === 'string' && redirect ? redirect : { name: 'dashboard' });
  } catch (error) {
    errorMessage.value =
      error instanceof ApiError ? error.message : '登录失败，请检查服务端是否可用';
  } finally {
    submitting.value = false;
  }
}

/**
 * 版本号取自公开的健康端点，避免在视图里硬编码造成版本漂移。
 * 获取失败时只显示占位符，不影响登录流程。
 */
const version = ref('');

async function loadVersion(): Promise<void> {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = (await response.json()) as { version?: string };
    version.value = payload.version ?? '';
  } catch {
    // 服务端尚未就绪时静默忽略
  }
}

onMounted(() => {
  if (!username.value) username.value = '';
  void loadVersion();
});
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
    <!-- 品牌区：柔和线性渐变背景，无模糊层、无玻璃层 -->
    <div class="w-full max-w-sm">
      <div class="mb-6 flex items-center justify-center gap-2.5">
        <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
          R
        </span>
        <div>
          <p class="text-base font-semibold leading-tight text-foreground">RiceNote</p>
          <p class="text-[11px] leading-tight text-muted-foreground">插件优先的博客系统</p>
        </div>
      </div>

      <Card class="p-6">
        <h1 class="text-lg font-semibold text-foreground">登录管理后台</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          使用管理员账号登录；首次部署的初始账号由环境变量
          <code class="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[11px]">BOOTSTRAP_ADMIN_*</code>
          决定。
        </p>

        <form class="mt-5 flex flex-col gap-4" @submit.prevent="submit">
          <div class="flex flex-col gap-1.5">
            <Label for="username">用户名</Label>
            <div class="relative">
              <User class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                v-model="username"
                class="pl-8"
                autocomplete="username"
                placeholder="admin"
                @enter="submit"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="password">密码</Label>
            <div class="relative">
              <KeyRound class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                v-model="password"
                class="pl-8"
                type="password"
                autocomplete="current-password"
                placeholder="••••••••"
                @enter="submit"
              />
            </div>
          </div>

          <p
            v-if="errorMessage"
            class="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {{ errorMessage }}
          </p>

          <Button type="submit" class="w-full" :loading="submitting || auth.pending">
            {{ submitting ? '正在登录…' : '进入后台' }}
          </Button>
        </form>
      </Card>

      <p class="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
        RiceNote {{ version ? `v${version}` : '' }} · 会话使用 HttpOnly Cookie，写操作校验 CSRF Token<br />
        连续失败会触发限流，请勿在公共环境使用弱口令
      </p>
    </div>
  </div>
</template>
