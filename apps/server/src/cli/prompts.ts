/**
 * 安装向导的交互原语（零新增依赖，只用 `node:readline`）。
 *
 * 两条硬要求决定了这里的实现方式：
 * 1. **无 TTY 必须可用**：容器构建、CI、`--yes` 场景下不能卡在等待输入。
 *    因此每个方法都有"非交互降级"：有默认值就取默认值，没有就抛出
 *    `SetupInputError`（由调用方转成"请显式传 --xxx"的可操作提示）。
 * 2. **密码不回显**：`text({ secret: true })` 临时屏蔽 stdout 写入，
 *    避免密码被记进终端历史/日志/录屏。
 */

import * as readlinePromises from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

/** 非交互模式下缺少必需输入时抛出（调用方据此给出可操作提示）。 */
export class SetupInputError extends Error {
  constructor(readonly label: string) {
    super(`需要「${label}」，但当前不是交互式终端：请通过命令行参数提供该值（或使用 --yes 采用默认值）。`);
    this.name = 'SetupInputError';
  }
}

export interface TextPromptOptions {
  /** 非交互模式下的取值；交互模式下作为回车默认值。 */
  defaultValue?: string;
  /** 是否隐藏输入（密码）。 */
  secret?: boolean;
  /** 不允许为空。 */
  required?: boolean;
  /** 自定义校验：返回错误信息表示不通过。 */
  validate?: (value: string) => string | undefined;
}

export interface SelectItem {
  value: string;
  label: string;
  hint?: string;
  /** 锁定项（必需插件）：始终被选中且不可取消。 */
  locked?: boolean;
  /** 默认是否勾选。 */
  checked?: boolean;
}

export interface PrompterOptions {
  /** 覆盖交互判定（测试用）。 */
  interactive?: boolean;
  input?: Readable;
  output?: Writable;
}

/** 终端交互封装。 */
export class Prompter {
  readonly interactive: boolean;
  private readonly input: Readable;
  private readonly output: Writable;
  private rl: readlinePromises.Interface | undefined;

  constructor(options: PrompterOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.interactive =
      options.interactive ?? (process.stdout.isTTY === true && process.stdin.isTTY === true);
  }

  private interface(): readlinePromises.Interface {
    if (!this.rl) {
      this.rl = readlinePromises.createInterface({
        input: this.input,
        output: this.output,
        terminal: true
      });
    }
    return this.rl;
  }

  close(): void {
    this.rl?.close();
    this.rl = undefined;
  }

  /** 分节标题（终端输出规范的统一入口）。 */
  section(title: string): void {
    this.output.write(`\n▸ ${title}\n`);
  }

  info(message: string): void {
    this.output.write(`  ${message}\n`);
  }

  success(message: string): void {
    this.output.write(`  \u001b[32m✓\u001b[0m ${message}\n`);
  }

  skip(message: string): void {
    this.output.write(`  \u001b[2m· ${message}\u001b[0m\n`);
  }

  warn(message: string): void {
    this.output.write(`  \u001b[33m!\u001b[0m ${message}\n`);
  }

  error(message: string): void {
    this.output.write(`  \u001b[31m✗\u001b[0m ${message}\n`);
  }

  /** 读取一行文本（密码可隐藏回显）。 */
  async text(label: string, options: TextPromptOptions = {}): Promise<string> {
    if (!this.interactive) {
      if (options.defaultValue !== undefined) return options.defaultValue;
      if (!options.required) return '';
      throw new SetupInputError(label);
    }

    for (;;) {
      const hint = options.defaultValue ? ` \u001b[2m[${options.secret ? '保持默认' : options.defaultValue}]\u001b[0m` : '';
      const raw = options.secret
        ? await this.secretLine(`  ${label}${hint}: `)
        : await this.interface().question(`  ${label}${hint}: `);

      const value = raw.trim().length === 0 ? (options.defaultValue ?? '') : raw.trim();
      if (options.required && value.length === 0) {
        this.warn('该项不能为空');
        continue;
      }
      const problem = options.validate?.(value);
      if (problem) {
        this.warn(problem);
        continue;
      }
      return value;
    }
  }

  /** 是/否确认。 */
  async confirm(label: string, defaultValue = true): Promise<boolean> {
    if (!this.interactive) return defaultValue;
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = (await this.interface().question(`  ${label} ${suffix} `)).trim().toLowerCase();
    if (answer.length === 0) return defaultValue;
    return answer === 'y' || answer === 'yes' || answer === '是';
  }

  /**
   * 多选（按编号输入，逗号分隔；回车保持默认）。
   *
   * 刻意不做光标/按键式多选：纯行输入在 Windows、各种终端、以及
   * 通过 SSH/CI 的会话里行为一致，也不需要 raw mode 与 ANSI 擦除技巧。
   */
  async multiSelect(label: string, items: SelectItem[]): Promise<string[]> {
    const locked = new Set(items.filter((item) => item.locked).map((item) => item.value));
    const checked = new Set(
      items.filter((item) => item.locked || item.checked).map((item) => item.value)
    );

    this.output.write(`  ${label}\n`);
    for (const [index, item] of items.entries()) {
      const mark = checked.has(item.value) ? 'x' : ' ';
      const lock = item.locked ? ' \u001b[2m（必需，不可取消）\u001b[0m' : '';
      const hint = item.hint ? ` \u001b[2m- ${item.hint}\u001b[0m` : '';
      this.output.write(`    [${mark}] ${index + 1}. ${item.label}${lock}${hint}\n`);
    }

    if (!this.interactive) {
      this.info(`非交互模式：采用默认选择（${checked.size} 项）`);
      return [...checked];
    }

    for (;;) {
      const answer = (
        await this.interface().question(
          '  输入要安装的编号（逗号分隔，回车保持默认，all 全选 / none 仅必需项）: '
        )
      ).trim();

      if (answer.length === 0) return [...checked];

      if (answer === 'all') {
        return items.map((item) => item.value);
      }
      if (answer === 'none') {
        return [...locked];
      }

      const picked = new Set(locked);
      let invalid = false;
      for (const token of answer.split(',').map((item) => item.trim()).filter((item) => item.length > 0)) {
        const index = Number.parseInt(token, 10);
        const item = items[index - 1];
        if (!item) {
          this.warn(`没有编号 ${token}，请重新输入`);
          invalid = true;
          break;
        }
        picked.add(item.value);
      }
      if (invalid) continue;
      return [...picked];
    }
  }

  /**
   * 隐藏回显地读一行。
   *
   * 做法：临时替换 stdout 的 `write`，只放行换行（否则用户完全看不到自己敲了什么，
   * 连"回车了没有"都不知道）。readline 自身仍负责行编辑与退格。
   */
  private async secretLine(prompt: string): Promise<string> {
    const output = this.output as Writable & { write: (...args: unknown[]) => boolean };
    const originalWrite = output.write.bind(output);
    output.write(prompt);

    output.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      const text = typeof chunk === 'string' ? chunk : '';
      if (text.includes('\n')) originalWrite('\n', ...rest);
      return true;
    }) as typeof output.write;

    try {
      return await this.interface().question('');
    } finally {
      output.write = originalWrite as typeof output.write;
    }
  }
}
