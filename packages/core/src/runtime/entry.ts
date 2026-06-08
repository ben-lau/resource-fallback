import type { FallbackRule, RuntimeConfig } from '../types';
import { installObserver } from './observer';
import { installViteAdapter } from './adapter-vite';
import { installWebpackAdapter } from './adapter-webpack';
import { installSystemJSAdapter } from './adapter-systemjs';
import { installSwAdapter } from './adapter-sw';
import { createHookBus } from './hooks';
import { createLogger, type Logger } from './logger';
import { createResolver } from './resolver';
import { isDisabled } from './kill-switch';

interface InstallOptions extends RuntimeConfig {
  /** 可选的 webpack chunkLoadingGlobal 名称列表，用于包装。由 webpack 插件设置。 */
  webpackChunkLoadingGlobals?: string[];
}

interface RfGlobal {
  install: (config: InstallOptions) => void;
  url: (filename: string) => string;
  resolver?: ReturnType<typeof createResolver>;
  /** 卸载运行时：移除所有监听器、清理全局状态。 */
  dispose: () => void;
  /** 标记位，供消费者/测试检测是否已安装。 */
  installed: boolean;
  /** 版本号，用于诊断。 */
  version: string;
}

declare const __RF_VERSION__: string;

const RUNTIME_VERSION = typeof __RF_VERSION__ === 'string' ? __RF_VERSION__ : '0.0.1';

const w =
  typeof window !== 'undefined'
    ? (window as unknown as Record<string, unknown> & { __RF__?: RfGlobal })
    : null;

function noop(): string {
  return '';
}

function ensureGlobal(): RfGlobal | null {
  if (!w) return null;
  if (!w.__RF__) {
    w.__RF__ = {
      install,
      url: noop,
      dispose() {},
      installed: false,
      version: RUNTIME_VERSION,
    };
  }
  return w.__RF__;
}

export function install(config: InstallOptions): void {
  if (!w) return; // SSR / Worker 环境——静默跳过

  const g = ensureGlobal()!;
  if (g.installed) {
    // 幂等：第二次 install()（例如 HMR 触发的）直接跳过
    return;
  }

  if (isDisabled(config)) {
    // Kill switch 激活——保留全局 stub 但不接线任何逻辑
    g.installed = true;
    g.url = (f) => f;
    return;
  }

  const log = createLogger(config.debug);
  warnDuplicateRules(config.rules, log);
  const resolver = createResolver(config);
  const bus = createHookBus(config.hooks, log);

  installSwAdapter({ config, bus, log });
  const observerCtl = installObserver({
    resolver,
    bus,
    log,
    sri: config.sri || 'strip',
  });
  installWebpackAdapter({
    resolver,
    bus,
    log,
    chunkLoadingGlobals: config.webpackChunkLoadingGlobals,
  });
  const viteCtl = installViteAdapter({ resolver, bus, log });
  installSystemJSAdapter({ resolver, bus, log });

  g.url = (filename) => resolver.resolveBuiltUrl(filename);
  g.resolver = resolver;
  g.installed = true;
  g.dispose = () => {
    observerCtl.dispose();
    viteCtl.dispose();
    // webpack adapter 的 setTimeout 轮询为一次性且短暂（最多 1s），不需清理。
    // systemjs adapter 覆写了 System.constructor.prototype，无法安全还原。
    // sw adapter 的 message listener 绑定在 navigator.serviceWorker 上，
    // 页面卸载时自动回收。
    if (w) delete w.__RF__;
  };

  log.info('installed', {
    version: RUNTIME_VERSION,
    rules: (config.rules || []).length,
  });
}

function matchKey(rule: FallbackRule): string | null {
  const m = rule.match;
  if (typeof m === 'string') return m;
  if (m instanceof RegExp) return m.toString();
  return null;
}

function warnDuplicateRules(rules: FallbackRule[] | undefined, log: Logger): void {
  if (!rules || rules.length < 2) return;
  const seen = new Map<string, number>();
  for (let i = 0; i < rules.length; i++) {
    const key = matchKey(rules[i]);
    if (key === null) continue;
    const prev = seen.get(key);
    if (prev !== undefined) {
      log.warn('重复的 match 规则，以最后一个为准', { match: key, indices: [prev, i] });
    }
    seen.set(key, i);
  }
}

// 让 install 函数在 IIFE 运行时即可访问——即使嵌入的 `install(...)` 调用
// 尚未执行（该调用来自插件添加的兄弟表达式）。
// 非浏览器环境下 ensureGlobal() 直接返回 null，无副作用。
ensureGlobal();
