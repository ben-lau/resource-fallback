import type { HookBus } from './hooks';
import type { Logger } from './logger';
import type { Resolver } from './resolver';

interface WebpackRequireLike {
  l?: (
    url: string,
    done: (event?: Event | { type: string }) => void,
    key?: string,
    chunkId?: string | number,
  ) => void;
  __rfWrapped?: boolean;
  // Module Federation v2 扩展点——此处保留以兼容后续版本
  f?: { remotes?: unknown };
}

type ChunkPushArg = [
  chunkIds: Array<string | number>,
  modules: Record<string, unknown>,
  runtimeFn?: (req: WebpackRequireLike) => unknown,
];

interface ChunkArrayLike extends Array<ChunkPushArg> {
  __rfHooked?: boolean;
}

interface AdapterDeps {
  resolver: Resolver;
  bus: HookBus;
  log: Logger;
  /**
   * 要预创建并包装的 `chunkLoadingGlobal` 名称。webpack 插件会将实际值注入此处，
   * 以便在运行时 chunk 首次 push 之前（`__webpack_require__` 可用之前）就拦截。
   */
  chunkLoadingGlobals?: string[];
}

/**
 * 钩入 webpack 5 的 chunk loader，使异步 chunk（React.lazy / Vue
 * defineAsyncComponent / `import()`）能够透明地重试和回退。
 *
 * 策略：
 *  - 预创建 `window[chunkLoadingGlobal]` 并包装其 `push` 方法。
 *  - 当 webpack 推入运行时 chunk 时会调用 `chunk[2](__webpack_require__)`，
 *    我们拦截该调用并包装 `__webpack_require__.l`。
 *
 * 如果 `chunkLoadingGlobals` 未知（例如运行时未通过 webpack 插件加载），
 * 则回退到扫描 window 上可枚举的 `webpackChunk*` 属性，并进行短时间轮询。
 */
export function installWebpackAdapter(deps: AdapterDeps): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;

  const knownGlobals = deps.chunkLoadingGlobals || [];
  for (let i = 0; i < knownGlobals.length; i++) {
    const name = knownGlobals[i];
    const existing = (w[name] as ChunkArrayLike | undefined) || ([] as ChunkArrayLike);
    w[name] = existing;
    hookArray(existing, deps);
  }

  scanAndHook(deps);

  // 尽力轮询：等待后创建的数组（当我们的运行时无法预创建时）
  const intervals = [50, 150, 400, 1000];
  for (let i = 0; i < intervals.length; i++) {
    setTimeout(() => scanAndHook(deps), intervals[i]);
  }
}

function scanAndHook(deps: AdapterDeps): void {
  const w = window as unknown as Record<string, unknown>;
  for (const key in w) {
    if (key.indexOf('webpackChunk') !== 0) continue;
    try {
      const candidate = w[key];
      if (Array.isArray(candidate)) hookArray(candidate as ChunkArrayLike, deps);
    } catch {
      /* 访问某些 window 属性可能抛异常（跨域 frame 等） */
    }
  }
}

function hookArray(arr: ChunkArrayLike, deps: AdapterDeps): void {
  if (arr.__rfHooked) return;
  arr.__rfHooked = true;

  // 包装在我们之前已经推入的 chunk（head-prepend 注入时很少出现，
  // 但运行时异步加载时有可能）
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && typeof arr[i][2] === 'function') {
      // 无法重放运行时调用，但可以通过下一个安全网（轮询）扫描
      // 其产生的 __webpack_require__
    }
  }

  const origPush = arr.push;
  arr.push = function (chunk: ChunkPushArg) {
    if (chunk && typeof chunk[2] === 'function') {
      const origRuntime = chunk[2];
      chunk[2] = function (req: WebpackRequireLike) {
        const ret = origRuntime(req);
        wrapRequire(req, deps);
        return ret;
      };
    }
    return origPush.apply(this, arguments as unknown as [ChunkPushArg]);
  };
}

function wrapRequire(req: WebpackRequireLike, deps: AdapterDeps): void {
  if (!req || req.__rfWrapped) return;
  req.__rfWrapped = true;

  if (typeof req.l !== 'function') {
    deps.log.warn('检测到 webpack runtime 但没有 .l 方法——跳过 chunk hook');
    return;
  }

  // webpack 插件的 `RuntimeModule` 已经从 bundle *内部*包装了 `__webpack_require__.l`
  // 并用 `__rf_wrapped` 标记。如果已有该包装则无需再次包装——否则会导致每次
  // retry/success 事件被重复触发，并且争抢重试预算。保留现有包装即可。
  if ((req.l as { __rf_wrapped?: boolean }).__rf_wrapped) {
    deps.log.debug('webpack 插件已包装 .l；chunk-array adapter 让步');
    return;
  }

  const origL = req.l;
  const wrapped = function (url: string, done: (event?: Event | { type: string }) => void, key?: string, chunkId?: string | number) {
    let attempt = 1;
    let isFallback = false;
    // 跟踪当前尝试的 URL。如果闭包捕获 `url` 不变，resolver 会始终基于
    // *原始*主 URL 做决策——即使我们已经 fallback 到备用 CDN，resolver 仍然
    // 回答 "fallback primary -> secondary"，导致死循环。
    let currentUrl = url;

    function onComplete(event?: Event | { type: string }) {
      if (!event || (event.type !== 'error' && event.type !== 'timeout')) {
        deps.bus.emitSuccess({ url: currentUrl, attempts: attempt });
        deps.resolver.recordSuccess(currentUrl);
        return done(event);
      }

      const result = deps.resolver.resolve(currentUrl, attempt, isFallback);

      if (result.kind === 'giveup') {
        deps.bus.emitError({ url: currentUrl, reason: result.reason });
        return done(event);
      }

      if (result.kind === 'retry') {
        attempt = result.attempt + 1;
        deps.bus.emitRetry({ url: result.url, attempt: result.attempt });
      } else {
        isFallback = true;
        attempt = 1;
        deps.bus.emitFallback({ from: result.from, to: result.url, reason: 'retry-budget-exhausted' });
      }
      currentUrl = result.url;
      retryWith(result.url, result.delay, key, chunkId, onComplete);
    }

    origL(url, onComplete, key, chunkId);
  };
  // 匹配 webpack 插件 RuntimeModule 使用的标记，这样任一侧的后续扫描
  // 都能识别该包装已安装。
  (wrapped as { __rf_wrapped?: boolean }).__rf_wrapped = true;
  req.l = wrapped;
}

/**
 * 通过自建 `<script>` 元素加载脚本，而非再次调用 webpack 的
 * `__webpack_require__.l`。绕过原始 loader 是因为它会缓存正在加载的 URL，
 * 后续尝试会被短路。
 */
function retryWith(
  url: string,
  delay: number,
  key: string | undefined,
  _chunkId: string | number | undefined,
  cb: (event: Event | { type: string }) => void,
): void {
  const run = () => {
    const script = document.createElement('script');
    script.charset = 'utf-8';
    script.async = true;
    if (key) script.setAttribute('data-webpack', key);
    script.src = url;

    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    script.onload = (e) => {
      cleanup();
      cb(e);
    };
    script.onerror = () => {
      cleanup();
      // 脚本加载失败的 DOM 事件不携带 HTTP 状态码，
      // 构造一个符合 webpack `{ type: 'error' }` 契约的对象。
      cb({ type: 'error' });
    };

    (document.head || document.body || document.documentElement).appendChild(script);
  };

  if (delay > 0) setTimeout(run, delay);
  else run();
}
