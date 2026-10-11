<script setup lang="ts" generic="T extends Record<string, unknown>">
/**
 * 数据表：只负责"表格骨架 + 空态 + 加载态"，单元格内容由具名插槽提供。
 *
 * 用法（插件零构建同样可用，模板里直接写 `<DataTable>`）：
 *
 * ```html
 * <DataTable :columns="columns" :rows="items" :loading="loading">
 *   <template #cell-title="{ row }"><p>{{ row.title }}</p></template>
 *   <template #cell-actions="{ row }"><Button size="sm">编辑</Button></template>
 * </DataTable>
 * ```
 */

export interface DataTableColumn {
  key: string;
  label: string;
  /** Tailwind 宽度类，例如 `w-32`。 */
  width?: string;
  align?: 'left' | 'right' | 'center';
  /** 在小屏隐藏该列（传 `md` 或 `lg`）。 */
  hideBelow?: 'md' | 'lg';
}

const props = withDefaults(
  defineProps<{
    columns: DataTableColumn[];
    rows: T[];
    rowKey?: string;
    loading?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    /** 表头附加类（用于保留各页面原有的表头底色等细节）。 */
    theadClass?: string;
  }>(),
  {
    rowKey: 'id',
    loading: false,
    emptyTitle: '暂无数据',
    theadClass: ''
  }
);

const alignClass: Record<string, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center'
};

function hideClass(column: DataTableColumn): string {
  if (column.hideBelow === 'md') return 'hidden md:table-cell';
  if (column.hideBelow === 'lg') return 'hidden lg:table-cell';
  return '';
}

function keyOf(row: T, index: number): string | number {
  const value = row[props.rowKey];
  return typeof value === 'string' || typeof value === 'number' ? value : index;
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-card">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse">
        <thead :class="['border-b border-border', props.theadClass]">
          <tr>
            <th
              v-for="column in props.columns"
              :key="column.key"
              :class="['rn-th', column.width ?? '', alignClass[column.align ?? 'left'] ?? 'text-left', hideClass(column)]"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-if="props.loading">
            <td class="rn-td py-10 text-center text-sm text-muted-foreground" :colspan="props.columns.length">
              正在加载…
            </td>
          </tr>
          <tr v-else-if="props.rows.length === 0">
            <td class="rn-td py-12 text-center" :colspan="props.columns.length">
              <slot name="empty">
                <p class="text-sm text-foreground">{{ props.emptyTitle }}</p>
                <p v-if="props.emptyDescription" class="mt-1 text-xs text-muted-foreground">
                  {{ props.emptyDescription }}
                </p>
              </slot>
            </td>
          </tr>
          <tr
            v-for="(row, index) in props.rows"
            v-else
            :key="keyOf(row, index)"
            class="transition-colors hover:bg-muted/40"
          >
            <td
              v-for="column in props.columns"
              :key="column.key"
              :class="['rn-td', alignClass[column.align ?? 'left'] ?? 'text-left', hideClass(column)]"
            >
              <slot :name="`cell-${column.key}`" :row="row" :index="index">
                {{ row[column.key] ?? '—' }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
