/**
 * Request-scoped business context. Never opens Radar / Workbench DBs.
 */
import { parseBusinessContext } from "@electronics/contracts";

export function resolveBusinessContext(input = {}, ctx = {}) {
  const fromRequest = input.context && typeof input.context === "object" ? input.context : {};
  const merged = {
    ...fromRequest,
    inventory: fromRequest.inventory || ctx.inventory || input.inventory,
    quotation:
      fromRequest.quotation ||
      ctx.quotation ||
      input.quotation ||
      (ctx.internalQuoteCount || input.internalQuoteCount
        ? { openCount: ctx.internalQuoteCount || input.internalQuoteCount, source: ctx.quotation?.origin || "caller" }
        : null),
    customer: fromRequest.customer || ctx.customer,
    snapshots: fromRequest.snapshots || ctx.snapshots || [],
    previousLcscPrice: fromRequest.previousLcscPrice ?? ctx.previousLcscPrice ?? null,
  };
  const parsed = parseBusinessContext(merged);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, value: null };
  return { ok: true, value: parsed.value };
}

export function adviseFromContext(business, publicState) {
  const inv = business?.inventory;
  const quote = business?.quotation;
  const onHand = Number(inv?.onHand || 0);
  const open = Number(quote?.openCount || 0);
  const hasInternal = Boolean(inv || quote);
  if (!hasInternal) {
    return {
      action: publicState === "未知" ? "补公开数据后再判断是否开发" : "仅公开市场：人工确认后报价",
      internalView: "未注入内部库存/询价上下文。",
      combined: publicState === "未知" ? "综合建议：先补市场证据。" : "综合建议：按公开市场谨慎报价。",
      usedInternal: false,
    };
  }
  if (onHand >= 5000 && open >= 2) {
    return {
      action: "内部有货且询价活跃：优先消化库存、按询报价",
      internalView: `库存在手 ${onHand}，未完成询价 ${open} 条（${quote?.origin || "caller"} / ${inv?.origin || "caller"}）。`,
      combined: "综合建议：公开市场仅作对照，先服务已有询价。",
      usedInternal: true,
    };
  }
  if (onHand === 0 && open >= 2) {
    return {
      action: "内部无货但询价多：评估外购，不盲目备货",
      internalView: `在手 0，未完成询价 ${open} 条（${quote?.origin || "caller"}）。`,
      combined: "综合建议：用询价验证需求后再决定是否备货。",
      usedInternal: true,
    };
  }
  if (onHand > 0 && open === 0) {
    return {
      action: "有库存无询价：控制新进，优先出货",
      internalView: `库存在手 ${onHand}（${inv?.origin || "caller"}），无打开询价。`,
      combined: "综合建议：先出库存，不按公开热度加仓。",
      usedInternal: true,
    };
  }
  return {
    action: "已注入内部上下文：对照公开市场后人工确认",
    internalView: `库存 ${onHand}，询价 ${open}（来源已标记，不是公开 evidence）。`,
    combined: "综合建议：内部数字优先于无证据的公开判断。",
    usedInternal: true,
  };
}
