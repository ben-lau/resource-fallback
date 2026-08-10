import { compileRuntimeConfig, type PreparedRuntimeConfig } from '../internal/config';
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
  type RecoveryRequest,
} from '../internal/coordinator';
import { createLifecycleManager } from '../internal/lifecycle';
import { createOwnershipRegistry } from '../internal/ownership';
import type { RuntimeConfig } from '../types';
import { installSystemJSAdapter } from './adapter-systemjs';
import { installViteAdapter } from './adapter-vite';
import { installWebpackAdapter } from './adapter-webpack';
import { installSwAdapter } from './adapter-sw';
import { createCircuitRegistry, mergeCircuit } from './circuit';
import { createHookBus } from './hooks';
import { isDisabled } from './kill-switch';
import { createLogger } from './logger';
import { installObserver } from './observer';

interface InstallOptions extends RuntimeConfig {
  /** 可选的 webpack chunkLoadingGlobal 名称列表，用于包装。由 webpack 插件设置。 */
  webpackChunkLoadingGlobals?: string[];
}

/**
 * 构建器适配器使用的私有桥接。它不属于公开运行时 API，只把构建器的
 * 加载语义接入同一个 coordinator，避免在插件里复制另一套回退状态机。
 */
type RuntimeBridge = Pick<RecoveryCoordinator, 'cancelOwner'> & {
  recover<T>(request: RecoveryRequest<T>): Promise<T>;
};

interface RfGlobal {
  install: (config: InstallOptions) => void;
  url: (filename: string) => string;
  /** 构建器运行时桥接；不作为公开 semver API。 */
  internal?: RuntimeBridge;
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

function noop(filename: string): string {
  return filename;
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

  // 编译必须发生在任何适配器接线之前。配置错误时保留可重试的 stub，
  // 不让页面得到一个只安装了一半的运行时。
  const prepared = compileRuntimeConfig(config);

  if (isDisabled(config)) {
    // Kill switch 激活——保留全局 stub 但不接线任何逻辑
    let disposed = false;
    g.installed = true;
    g.url = noop;
    g.dispose = () => {
      if (disposed) return;
      disposed = true;
      if (w?.__RF__ === g) delete w.__RF__;
    };
    return;
  }

  const log = createLogger(config.debug);
  const bus = createHookBus(config.hooks, log);
  const ownership = createOwnershipRegistry();
  const circuitOptions = prepared.rules[0]
    ? { ...prepared.rules[0].circuit }
    : mergeCircuit(config.defaults?.circuit, undefined);
  const circuit = createCircuitRegistry(circuitOptions);
  const coordinator = createRecoveryCoordinator({
    config: prepared,
    bus,
    circuit,
  });
  const internal: RuntimeBridge = {
    recover: (request) => coordinator.recover(request),
    cancelOwner: (owner) => coordinator.cancelOwner(owner),
  };
  const controls: Array<{ dispose(): void }> = [];

  try {
    const swCtl = installSwAdapter({ config, bus, log });
    controls.push(swCtl);
    const observerCtl = installObserver({
      coordinator,
      ownership,
      log,
      sri: prepared.sri,
    });
    controls.push(observerCtl);
    const webpackCtl = installWebpackAdapter({
      coordinator,
      ownership,
      log,
      chunkLoadingGlobals: config.webpackChunkLoadingGlobals,
    });
    controls.push(webpackCtl);
    const viteCtl = installViteAdapter({
      config: prepared,
      coordinator,
      ownership,
      log,
      target: g as unknown as Record<string, unknown>,
      resolveUrl: (filename) => resolveBuiltUrl(prepared, filename),
    });
    controls.push(viteCtl);
    const systemJsCtl = installSystemJSAdapter({
      config: prepared,
      coordinator,
      ownership,
      log,
    });
    controls.push(systemJsCtl);

    const lifecycle = createLifecycleManager();
    lifecycle.add(() => {
      if (w.__RF__ === g) delete w.__RF__;
    });
    lifecycle.add(() => {
      if (g.internal === internal) delete g.internal;
    });
    lifecycle.add(() => bus.dispose());
    lifecycle.add(() => ownership.dispose());
    lifecycle.add(() => swCtl.dispose());
    lifecycle.add(() => systemJsCtl.dispose());
    lifecycle.add(() => viteCtl.dispose());
    lifecycle.add(() => webpackCtl.dispose());
    lifecycle.add(() => observerCtl.dispose());
    lifecycle.add(() => coordinator.dispose());

    g.url = (filename) => resolveBuiltUrl(prepared, filename);
    g.internal = internal;
    g.installed = true;
    g.dispose = () => lifecycle.dispose();

    log.info('installed', {
      version: RUNTIME_VERSION,
      rules: prepared.rules.length,
    });
  } catch (error) {
    for (let i = controls.length - 1; i >= 0; i--) controls[i].dispose();
    coordinator.dispose();
    ownership.dispose();
    bus.dispose();
    throw error;
  }
}

function resolveBuiltUrl(config: PreparedRuntimeConfig, filename: string): string {
  if (!filename || /^https?:\/\//.test(filename) || filename[0] === '/') return filename;
  const prefix = config.rules[0]?.base;
  return prefix ? joinAssetPrefix(prefix, filename) : filename;
}

function joinAssetPrefix(prefix: string, filename: string): string {
  if (!filename) return prefix.replace(/\/?$/, '') || '/';
  const name = filename.replace(/^\/+/, '');
  const separator = /[/\\]$/.test(prefix) ? '' : '/';
  return `${prefix}${separator}${name}`;
}

// 让 install 函数在 IIFE 运行时即可访问——即使嵌入的 `install(...)` 调用
// 尚未执行（该调用来自插件添加的兄弟表达式）。
// 非浏览器环境下 ensureGlobal() 直接返回 null，无副作用。
ensureGlobal();
