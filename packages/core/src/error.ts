/** 日志与抛错统一使用的产品前缀。 */
export const RF_PREFIX = '[resource-fallback]';

/** 构造带统一前缀的 Error，便于控制台检索与文档对齐。 */
export function rfError(message: string): Error {
  return new Error(`${RF_PREFIX} ${message}`);
}
