<script setup lang="ts">
import { RouterView } from 'vue-router';
// 提示条容器由 SDK 提供：插件页面调用 useToast() 时弹出的提示也渲染在这里
import { Toaster } from '@ricenote/admin-sdk';

</script>

<template>
  <RouterView />
  <Toaster />
</template>
