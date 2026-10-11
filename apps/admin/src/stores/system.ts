/**
 * 运行状态与重启流程门面。
 *
 * 实现已迁入 `@ricenote/admin-sdk`：插件后台界面在保存"需要重启才生效"的设置后，
 * 可以调用 `markPending()` 让顶栏「重启」按钮立刻出现，因此状态必须是全局单例。
 */

export { isRestartingError, useSystemState } from '@ricenote/admin-sdk';
