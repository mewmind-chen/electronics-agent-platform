/**
 * Parse-health extracted from Workbench parse-health.server.ts.
 */
const RATE = (n, total) => (total === 0 ? 0 : n / total);

export function assessParseHealth(sourceKey, offers) {
  const total = offers.length;
  const modelRate = RATE(offers.filter((o) => !!o.model).length, total);
  const stockRate = RATE(offers.filter((o) => o.stock != null).length, total);
  const priceRate = RATE(
    offers.filter((o) => o.price != null || (o.priceBreaks?.length ?? 0) > 0).length,
    total,
  );
  const issues = [];
  if (total === 0) issues.push("解析出 0 条 offers");
  const structuredSource = ["lcsc", "hqew", "findchips", "icnet", "shop"].includes(sourceKey);
  const thresholds =
    sourceKey === "hqew" ? { model: 0.9, stock: 0.4, price: 0.05 } : { model: 0.9, stock: 0.4, price: 0.4 };
  if (structuredSource && total > 0) {
    if (modelRate < thresholds.model) {
      issues.push(`型号字段完整率 ${(modelRate * 100).toFixed(0)}% < ${(thresholds.model * 100).toFixed(0)}%`);
    }
    if (stockRate < thresholds.stock) {
      issues.push(`库存字段完整率 ${(stockRate * 100).toFixed(0)}% < ${(thresholds.stock * 100).toFixed(0)}%`);
    }
    if (priceRate < thresholds.price) {
      issues.push(`价格字段完整率 ${(priceRate * 100).toFixed(0)}% < ${(thresholds.price * 100).toFixed(0)}%`);
    }
  }
  return {
    sourceKey,
    healthy: issues.length === 0,
    offerCount: total,
    completeness: {
      model: Number(modelRate.toFixed(2)),
      stock: Number(stockRate.toFixed(2)),
      price: Number(priceRate.toFixed(2)),
    },
    issues,
  };
}
