<script setup lang="ts">
/**
 * 后台 404。
 *
 * 为什么不用"重定向到仪表盘"：那会让"地址打错了"和"插件未启用/没有权限"
 * 表现完全一样（都悄悄回到首页），用户无法判断到底发生了什么。
 * 这里明确区分：本页只处理"确实没有这个地址"。
 */
import { useRouter } from 'vue-router';
import { Button, Card } from '@ricenote/admin-sdk';

const router = useRouter();

function goHome(): void {
  void router.push('/');
}
</script>

<template>
  <Card class="mx-auto mt-10 max-w-xl p-6">
    <h2 class="text-base font-semibold text-foreground">页面不存在</h2>
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      当前地址在后台没有对应页面。可能是链接已失效，或该功能所属的插件已被卸载。
    </p>
    <div class="mt-4 flex items-center gap-2">
      <Button @click="goHome">返回仪表盘</Button>
    </div>
  </Card>
</template>
