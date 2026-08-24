/**
 * Domain supply / market cards extracted from Workbench analyze.ts.
 * No UI. No database. No Harness.
 */

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function batchLabel(raw) {
  const t = String(raw || "").trim();
  const y = t.match(/(?:20)?(\d{2})\s*\+/);
  if (y) return `${y[1]}+`;
  if (!t) return "未标批号";
  return t.slice(0, 8);
}

export function analyzePart(mpn, offers = [], identity = null) {
  const key = String(mpn || "").trim().toUpperCase();
  const hqew = offers.filter((o) => o.sourceKey === "hqew");
  const exact = hqew.filter((o) => String(o.model || o.mpn || "").toUpperCase() === key);
  const lcsc = offers.find((o) => o.sourceKey === "lcsc");
  const prices = exact
    .map((o) => o.price)
    .filter((n) => typeof n === "number")
    .sort((a, b) => a - b);
  const lcscPrice = identity?.priceBreaks?.[0]?.price ?? lcsc?.price ?? null;
  const batchMap = new Map();
  const supplierMap = new Map();
  for (const o of exact) {
    const label = batchLabel(o.batch);
    const b = batchMap.get(label) || { label, count: 0, stock: 0 };
    b.count += 1;
    b.stock += o.stock || 0;
    batchMap.set(label, b);
    const name = o.supplier || "未标供应商";
    const prev = supplierMap.get(name);
    const stock = o.stock || 0;
    if (!prev || stock > prev.stock) supplierMap.set(name, { name, stock, price: o.price, batch: o.batch });
  }
  return {
    exact,
    ads: Math.max(0, hqew.length - exact.length),
    offerCount: exact.length,
    totalStock: exact.reduce((s, o) => s + (o.stock || 0), 0),
    priced: prices.length,
    minPrice: prices[0] ?? null,
    medianPrice: median(prices),
    maxPrice: prices.length ? prices[prices.length - 1] : null,
    lcscStock: identity?.lcscStock ?? lcsc?.stock ?? null,
    lcscPrice,
    lcscBreaks: identity?.priceBreaks?.length ? identity.priceBreaks : lcsc?.priceBreaks || [],
    spread: lcscPrice != null && prices[0] != null ? lcscPrice - prices[0] : null,
    batches: [...batchMap.values()].sort((a, b) => b.stock - a.stock || b.count - a.count),
    suppliers: [...supplierMap.values()].sort((a, b) => b.stock - a.stock).slice(0, 8),
  };
}

export function partPositioning(identity) {
  if (!identity) return "";
  const spec = (k) => identity.specs?.find((s) => String(s.label || "").includes(k))?.value || "";
  const bits = [];
  if (identity.brand && identity.category) bits.push(`${identity.brand} 的${identity.category}`);
  else if (identity.category) bits.push(identity.category);
  const core = spec("CPU内核") || spec("内核");
  const freq = spec("主频");
  const flash = spec("程序存储容量") || spec("Flash");
  const ram = spec("RAM");
  if (core) bits.push(core);
  if (freq) bits.push(`主频 ${freq}`);
  if (flash) bits.push(`Flash ${flash}`);
  if (ram) bits.push(`RAM ${ram}`);
  if (identity.package) bits.push(identity.package);
  return bits.join(" · ");
}

export function buildMarketCards({ analysis, identity, internalQuoteCount = 0, previousLcscPrice = null }) {
  const suppliers = analysis.suppliers.length || analysis.offerCount;
  const local = Number(internalQuoteCount || 0);
  let hotVerdict = "公开页挂得不多";
  let hotLevel = "low";
  if (local >= 2 && suppliers >= 12) {
    hotVerdict = "手头在询，市场上也常挂";
    hotLevel = "high";
  } else if (suppliers >= 20) {
    hotVerdict = "挂货商家多";
    hotLevel = "high";
  } else if (local >= 1) {
    hotVerdict = "至少有内部询价信号";
    hotLevel = "mid";
  } else if (suppliers >= 8) {
    hotVerdict = "有一定挂货，谈不上爆款";
    hotLevel = "mid";
  }

  const lcsc = analysis.lcscStock;
  const hang = analysis.totalStock;
  let supplyVerdict = "公开页上看一般";
  let supplyLevel = "mid";
  if (lcsc != null && lcsc >= 50000) {
    supplyVerdict = "立创现货足，偏松";
    supplyLevel = "low";
  } else if (lcsc != null && lcsc < 1000 && hang < 5000) {
    supplyVerdict = "立创和挂货都不多，偏紧";
    supplyLevel = "high";
  } else if (lcsc != null && lcsc < 3000) {
    supplyVerdict = "立创现货不多";
    supplyLevel = "high";
  } else if (lcsc == null && hang === 0) {
    supplyVerdict = "这一页没取到库存数字";
    supplyLevel = "unknown";
  }

  let priceVerdict = "还不能判断涨跌";
  let priceLevel = "unknown";
  if (previousLcscPrice != null && analysis.lcscPrice != null && previousLcscPrice > 0) {
    const pct = ((analysis.lcscPrice - previousLcscPrice) / previousLcscPrice) * 100;
    if (pct >= 5) {
      priceVerdict = `比上次立创 1+ 高 ${pct.toFixed(1)}%`;
      priceLevel = "high";
    } else if (pct <= -5) {
      priceVerdict = `比上次立创 1+ 低 ${Math.abs(pct).toFixed(1)}%`;
      priceLevel = "low";
    } else {
      priceVerdict = "和上次立创价差不多";
      priceLevel = "mid";
    }
  }

  return {
    hot: { title: "热门", verdict: hotVerdict, level: hotLevel, suppliers, local },
    supply: { title: "供应", verdict: supplyVerdict, level: supplyLevel, lcscStock: lcsc, hangStock: hang },
    price: {
      title: "价格",
      verdict: priceVerdict,
      level: priceLevel,
      lcscPrice: analysis.lcscPrice,
      minPrice: analysis.minPrice,
      brand: identity?.brand || "",
    },
  };
}
