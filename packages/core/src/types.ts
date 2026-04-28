/**
 * 用于判断失败 URL 是否受某条规则管辖的匹配模式。
 *  - `string` 前缀匹配（区分大小写）
 *  - `RegExp` 对 URL 做正则测试
 *  - 函数针对每个 URL 自行决定
 */
export type MatchPattern =
  | string
  | RegExp
  | ((url: string) => boolean);

export interface RetryOptions {
  /** 同一 URL 的重试预算。超过此次数后切换到下一个 URL。默认 2。 */
  max?: number;
  /** 首次重试前的初始延迟（ms）。默认 300。 */
  baseDelay?: number;
  /** 指数退避的延迟上限（ms）。默认 3000。 */
  maxDelay?: number;
  /** 软超时时间（ms）。默认 10000。用作 HEAD 探测的提示。 */
  timeout?: number;
  /** 为每次延迟添加最多 50% 的随机抖动，分散重试风暴。默认 true。 */
  jitter?: boolean;
}

export interface CircuitOptions {
  /** 同一 host 连续失败多少次后触发熔断。默认 5。 */
  threshold?: number;
  /** 熔断后的冷却时长（ms），到期后重新尝试该 host。默认 30000。 */
  cooldown?: number;
  /**
   * 将熔断状态持久化到 `localStorage`，让同源下多个标签页共享已挂掉的 host 信息。
   * 其他 tab 通过 `storage` 事件实时感知变更。
   * 设为 false 则仅在当前页面内存中保持熔断状态，tab 间互不影响。
   * 默认 true。存储不可用时优雅降级。
   */
  shareAcrossTabs?: boolean;
  /**
   * localStorage 中熔断条目的存活时长（ms）。超过此时间的条目在读取时自动丢弃，
   * 避免过期数据残留导致用户长时间无法正常加载。默认 120000（2 分钟）。
   */
  storageTtl?: number;
}

export interface FallbackRule {
  /** 决定该规则是否应用于某个失败 URL。 */
  match: MatchPattern;
  /**
   * 有序的候选 base URL 列表。当某 URL 的重试预算耗尽后，运行时会用下一个候选
   * 替换匹配的前缀。最后一个通常指向自建源站。
   *
   * 每项应为 base URL 前缀，例如 `https://cdn.example.com/`。
   */
  urls: string[];
  retry?: RetryOptions;
  circuit?: CircuitOptions;
}

export type RetryEvent = { url: string; attempt: number };
export type FallbackEvent = { from: string; to: string; reason?: unknown };
export type SuccessEvent = { url: string; attempts: number };
export type ErrorEvent = { url: string; reason?: unknown };

export interface RuntimeHooks {
  onRetry?: (e: RetryEvent) => void;
  onFallback?: (e: FallbackEvent) => void;
  onSuccess?: (e: SuccessEvent) => void;
  /**
   * 所有候选 URL（包括源站）均失败后触发。
   * 不会自动执行 `location.reload()` ——由业务决定如何兜底。
   */
  onError?: (e: ErrorEvent) => void;
}

export type SriPolicy = 'strip' | 'keep' | 'strict';

export type DebugFlag = boolean | 'auto';

/**
 * 浏览器运行时使用的配置对象。
 *
 * 注意：该对象会被 JSON 序列化并嵌入页面，所有值必须是原始类型（不能有函数）。
 * {@link FallbackRule.match} 此处仅支持 string 或 RegExp。
 * （在运行时通过 JS 调用 `install()` 时才支持函数形式的 `match`。）
 */
export interface RuntimeConfig {
  rules: FallbackRule[];
  defaults?: { retry?: RetryOptions; circuit?: CircuitOptions };
  hooks?: RuntimeHooks;
  /** 除 `__RF_DISABLE__` 外额外检查的全局 kill-switch 变量名。 */
  disableGlobals?: string[];
  /** 设为 `off` 时禁用运行时的 URL 查询参数名。默认 `__rf`。 */
  disableQueryParam?: string;
  /** 值为 `1` 时禁用运行时的 cookie 名。默认 `__rf_disable`。 */
  disableCookie?: string;
  /**
   * - `true` 始终打印日志
   * - `false` 永不打印（生产环境默认）
   * - `'auto'` 当 `localStorage.__RF_DEBUG__` 为真值时打印
   */
  debug?: DebugFlag;
  /** SRI 处理策略。默认 `'strip'`。 */
  sri?: SriPolicy;
}

export interface HtmlTagAttributes {
  [name: string]: string | boolean | undefined;
}

export interface HtmlTag {
  tagName: 'script' | 'link';
  voidTag?: boolean;
  attributes: HtmlTagAttributes;
  innerHTML?: string;
}

/**
 * 插件构建时的配置选项。不在 {@link RuntimeConfig} 中的字段仅供
 * webpack/vite 插件消费，序列化到浏览器前会被剥离。
 */
export interface PluginOptions extends RuntimeConfig {
  /** 在 dev/serve 模式下也注入运行时。默认 false。 */
  enableDev?: boolean;
  /** 附加到注入的 `<script>` 标签上的 CSP nonce。 */
  nonce?: string;
  /**
   * 将运行时作为独立资源输出并通过 `<script src>` 引用，而非内联。
   * 当 CSP 禁止 `unsafe-inline` 时适用。默认 false。
   */
  externalRuntime?: boolean;
  /** 当 {@link externalRuntime} 为 true 时使用的外链路径。默认 `/__rf/runtime.js`。 */
  externalRuntimePath?: string;
  /** 为每个 fallback host 注入 `<link rel=preconnect>`。默认 true。 */
  injectPreconnect?: boolean;
  /** 注入到 `<head>` 中的位置。默认 `head-prepend`（最前面）。 */
  htmlInject?: 'head-prepend' | 'head-append';
}

/** 供 resolver 模块使用；install 入口仅消费公共 RuntimeConfig。 */
export type AttemptKind = 'retry' | 'fallback' | 'giveup';

export type ResolveResult =
  | { kind: 'retry'; url: string; delay: number; attempt: number }
  | { kind: 'fallback'; url: string; delay: number; from: string; attempt: number }
  | { kind: 'giveup'; reason: 'rules-exhausted' | 'no-match' | 'circuit-open' };
