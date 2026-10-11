/** 插件可用的结构化日志接口。日志会自动附加插件 ID 与请求 ID。 */
export interface PluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** 资源注销句柄：插件 `stop()` 时必须调用全部句柄以释放注册项。 */
export type Dispose = () => void;

/** 事件取消订阅句柄。 */
export type Unsubscribe = () => void;
