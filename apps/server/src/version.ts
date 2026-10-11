/**
 * 服务端版本号。
 *
 * 直接复用 Core 的 `APP_VERSION`，避免"两处各写一个版本号"导致
 * 诊断页显示 0.1.0、内核日志显示 0.2.0 这类不一致。
 */

export { APP_VERSION } from '@ricenote/core';
