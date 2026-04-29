import './styles.css';
import React, { Component, Suspense, useState, useEffect, useCallback, lazy } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

const LazyA = lazy(() => import(/* webpackChunkName: "lazy-a" */ './Lazy'));
const LazyB = lazy(() => import(/* webpackChunkName: "lazy-b" */ './LazyB'));
const LazyC = lazy(() => import(/* webpackChunkName: "lazy-c" */ './LazyC'));

class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[resource-fallback] chunk load failed:', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, background: '#fff3f3', borderRadius: 8, border: '1px solid #ffcdd2', margin: '8px 0' }}>
          <p style={{ margin: 0, color: '#b00020', fontWeight: 600 }}>异步模块加载失败</p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#555' }}>{this.state.error.message}</p>
          <button
            className="rf-btn"
            style={{ marginTop: 8, fontSize: 12 }}
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface RfEvent { ts: number; type: string; detail: unknown }

declare global {
  interface Window { __RF_EVENTS__?: RfEvent[] }
}

const CIRCUIT_KEY = '__rf_circuit__';

const TYPE_COLORS: Record<string, string> = {
  retry: '#b08000',
  fallback: '#c25e00',
  success: '#0f7d2a',
  error: '#b00020',
};

function useRfEvents() {
  const [events, setEvents] = useState<RfEvent[]>(() => {
    return (window.__RF_EVENTS__ || []).slice();
  });

  useEffect(() => {
    const types = ['rf:retry', 'rf:fallback', 'rf:success', 'rf:error'] as const;
    const handler = (e: Event) => {
      setEvents((prev) => [
        ...prev,
        { ts: Date.now(), type: e.type.slice(3), detail: (e as CustomEvent).detail },
      ]);
    };
    types.forEach((t) => window.addEventListener(t, handler));
    return () => types.forEach((t) => window.removeEventListener(t, handler));
  }, []);

  return events;
}

function useCircuitState() {
  const [state, setState] = useState<Record<string, unknown>>({});
  const refresh = useCallback(() => {
    try {
      const raw = localStorage.getItem(CIRCUIT_KEY);
      setState(raw ? JSON.parse(raw) : {});
    } catch { setState({}); }
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => { if (e.key === CIRCUIT_KEY) refresh(); };
    window.addEventListener('storage', onStorage);
    const timer = setInterval(refresh, 1000);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(timer); };
  }, [refresh]);

  return { state, refresh };
}

function hasNewFallbackEvents(since: number): boolean {
  const all = window.__RF_EVENTS__ || [];
  for (let i = since; i < all.length; i++) {
    const t = all[i].type;
    if (t === 'retry' || t === 'fallback') return true;
  }
  return false;
}

function useExternalScript(url: string) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<'intercepted' | 'not-intercepted' | 'success' | null>(null);
  const snapshotRef = React.useRef(0);

  const load = useCallback(() => {
    setLoading(true);
    setResult(null);
    snapshotRef.current = (window.__RF_EVENTS__ || []).length;
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => { setLoading(false); setResult('success'); };
    s.onerror = () => {
      setTimeout(() => {
        setLoading(false);
        setResult(hasNewFallbackEvents(snapshotRef.current) ? 'intercepted' : 'not-intercepted');
      }, 500);
    };
    document.head.appendChild(s);
  }, [url]);

  return { loading, result, load };
}

function App() {
  const events = useRfEvents();
  const { state: circuit, refresh } = useCircuitState();
  const [showA, setShowA] = useState(false);
  const [showB, setShowB] = useState(false);
  const [showC, setShowC] = useState(false);
  const extMatched = useExternalScript('http://cdn-primary.example.invalid/external/lib.js');
  const extUnmatched = useExternalScript('http://other-domain.example.invalid/lib.js');

  const clearCircuit = () => { localStorage.removeItem(CIRCUIT_KEY); refresh(); };
  const circuitEntries = Object.entries(circuit);

  return (
    <div className="rf-app">
      {/* ── Banner ── */}
      <div className="rf-banner">
        <h1 style={{ margin: 0 }}>resource-fallback · webpack demo</h1>
        <p style={{ marginTop: 8, opacity: 0.9, fontSize: 14 }}>
          如果你看到这个页面，说明 JS + CSS 都已成功从 origin 回退加载。
        </p>
      </div>

      {/* ── 配置概览 ── */}
      <div className="rf-card" style={{ fontSize: 13 }}>
        <strong>配置</strong>
        <table style={{ marginTop: 8, borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <tr><td style={{ padding: '2px 8px', color: '#888' }}>Primary</td><td><code>http://cdn-primary.example.invalid/</code> — DNS 不存在</td></tr>
            <tr><td style={{ padding: '2px 8px', color: '#888' }}>Secondary</td><td><code>http://cdn-secondary.example.invalid/</code> — DNS 不存在</td></tr>
            <tr><td style={{ padding: '2px 8px', color: '#888' }}>Backup</td><td><code>http://cdn-backup.example.invalid/</code> — DNS 不存在</td></tr>
            <tr><td style={{ padding: '2px 8px', color: '#888' }}>Origin</td><td><code>/</code> — 同源</td></tr>
            <tr><td style={{ padding: '2px 8px', color: '#888' }}>每 URL 重试</td><td>1 次 · baseDelay 300ms</td></tr>
            <tr><td style={{ padding: '2px 8px', color: '#888' }}>熔断器</td><td>threshold=2 · cooldown=15s · TTL=60s</td></tr>
          </tbody>
        </table>
        <p style={{ marginTop: 8, color: '#555' }}>
          打开 DevTools → Network 面板，可以看到 <code>.invalid</code> 域名的 DNS 失败 → 最终回退到 <code>/</code>。
          <br/>本页加载了 <b>JS 入口 + CSS 样式表</b>，两者都走了完整的回退链。
        </p>
      </div>

      {/* ── 熔断器状态 ── */}
      <div className="rf-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong>熔断器</strong>
          <button className="rf-btn" onClick={clearCircuit} style={{ fontSize: 12 }}>清除</button>
          <button className="rf-btn" onClick={refresh} style={{ fontSize: 12 }}>刷新</button>
        </div>
        {circuitEntries.length === 0 ? (
          <p style={{ color: '#888', fontSize: 13, marginTop: 8 }}>无记录</p>
        ) : (
          <table style={{ fontSize: 13, borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
                <th style={{ padding: '4px 8px' }}>Host</th>
                <th style={{ padding: '4px 8px' }}>Fails</th>
                <th style={{ padding: '4px 8px' }}>Status</th>
                <th style={{ padding: '4px 8px' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {circuitEntries.map(([host, v]) => {
                const s = v as { fails: number; openedAt: number; updatedAt: number };
                const isOpen = s.openedAt > 0;
                return (
                  <tr key={host} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 12 }}>{host}</td>
                    <td style={{ padding: '4px 8px' }}>{s.fails}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <span className={isOpen ? 'rf-badge rf-badge--open' : 'rf-badge rf-badge--closed'}>
                        {isOpen ? 'OPEN' : 'CLOSED'}
                      </span>
                    </td>
                    <td style={{ padding: '4px 8px', color: '#888', fontSize: 12 }}>
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 外部脚本加载 ── */}
      <div className="rf-card">
        <strong>外部脚本加载（Observer 拦截测试）</strong>
        <p style={{ fontSize: 13, color: '#555', margin: '8px 0' }}>
          通过 <code>document.createElement('script')</code> 手动加载外部资源，验证 Observer 行为。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 匹配规则的 URL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="rf-btn" onClick={extMatched.load} disabled={extMatched.loading}>
              {extMatched.loading ? '加载中…' : '加载匹配规则的脚本'}
            </button>
            <code style={{ fontSize: 11, color: '#888' }}>cdn-primary.example.invalid/external/lib.js</code>
            {extMatched.result === 'intercepted' && (
              <span style={{ color: '#0f7d2a', fontSize: 13, fontWeight: 600 }}>✓ 已被 Observer 拦截并回退</span>
            )}
            {extMatched.result === 'not-intercepted' && (
              <span style={{ color: '#b00020', fontSize: 13 }}>✗ 未拦截（异常）</span>
            )}
          </div>
          {/* 不匹配规则的 URL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="rf-btn" onClick={extUnmatched.load} disabled={extUnmatched.loading}>
              {extUnmatched.loading ? '加载中…' : '加载不匹配规则的脚本'}
            </button>
            <code style={{ fontSize: 11, color: '#888' }}>other-domain.example.invalid/lib.js</code>
            {extUnmatched.result === 'not-intercepted' && (
              <span style={{ color: '#0f7d2a', fontSize: 13, fontWeight: 600 }}>✓ 未被拦截（预期行为，不匹配任何规则）</span>
            )}
            {extUnmatched.result === 'intercepted' && (
              <span style={{ color: '#b00020', fontSize: 13 }}>✗ 被拦截了（不应该）</span>
            )}
          </div>
        </div>
      </div>

      {/* ── 异步模块 ── */}
      <div className="rf-card">
        <strong>异步模块加载</strong>
        <p style={{ fontSize: 13, color: '#555', margin: '8px 0' }}>
          逐个点击。Module A 会让 primary/backup 各累积 1 次失败；Module B 再累积 1 次，触发熔断（threshold=2）；Module C 会直接跳过已熔断的 CDN。
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="rf-btn" onClick={() => setShowA(true)} disabled={showA}>Load Module A</button>
          <button className="rf-btn" onClick={() => setShowB(true)} disabled={showB}>Load Module B</button>
          <button className="rf-btn" onClick={() => setShowC(true)} disabled={showC}>Load Module C</button>
        </div>
        <ChunkErrorBoundary>
          <Suspense fallback={<p style={{ padding: 12, color: '#888' }}>Loading…</p>}>
            {showA && <LazyA />}
            {showB && <LazyB />}
            {showC && <LazyC />}
          </Suspense>
        </ChunkErrorBoundary>
      </div>

      {/* ── 事件日志 ── */}
      <div className="rf-card">
        <strong>运行时事件 ({events.length})</strong>
        <p style={{ fontSize: 12, color: '#888', margin: '4px 0 8px' }}>
          包含页面加载时（先于 App 渲染）的事件 — 通过 window.__RF_EVENTS__ 缓冲捕获。
        </p>
        <div style={{ background: '#f8f8f8', padding: 12, borderRadius: 6, fontSize: 12, maxHeight: 360, overflow: 'auto' }}>
          {events.length === 0 ? (
            <p style={{ color: '#888', margin: 0 }}>无事件</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                  <th style={{ padding: '2px 6px' }}>#</th>
                  <th style={{ padding: '2px 6px' }}>Type</th>
                  <th style={{ padding: '2px 6px' }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '2px 6px', color: '#aaa' }}>{i + 1}</td>
                    <td style={{ padding: '2px 6px', fontWeight: 600, color: TYPE_COLORS[e.type] || '#333' }}>
                      {e.type.toUpperCase()}
                    </td>
                    <td style={{ padding: '2px 6px' }}>
                      <code style={{ wordBreak: 'break-all' }}>{JSON.stringify(e.detail)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── 测试指南 ── */}
      <div className="rf-card" style={{ background: '#fffde7', fontSize: 13 }}>
        <strong>测试场景</strong>
        <ol style={{ paddingLeft: 20, margin: '8px 0 0' }}>
          <li><b>JS + CSS 回退</b>：刷新页面，Network 面板可见 JS 和 CSS 都从 <code>.invalid</code> 失败 → 回退到 <code>/</code></li>
          <li><b>外部脚本（匹配）</b>：点击「加载匹配规则的脚本」→ 应出现 ✓ 已被拦截，事件面板有新事件</li>
          <li><b>外部脚本（不匹配）</b>：点击「加载不匹配规则的脚本」→ 应出现 ✓ 未被拦截，事件面板无新事件</li>
          <li><b>熔断跳闸</b>：依次加载 A → B → C，观察 C 跳过已熔断的 CDN（Network 请求更少）</li>
          <li><b>熔断冷却</b>：等 15 秒后加载新模块或刷新</li>
          <li><b>TTL 过期</b>：60 秒后刷新，localStorage 条目自动清除</li>
          <li><b>跨 Tab</b>：新 Tab 打开同一页面，熔断状态已共享</li>
          <li><b>手动重置</b>：点「清除」后刷新</li>
        </ol>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
