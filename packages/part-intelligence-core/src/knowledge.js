/** Series knowledge extracted from Workbench part-dossier.ts. Domain rules, not a Skill. */
const CATALOG = [
  {
    test: /^STM32F103C8/i,
    knowledge: {
      family: "STM32F1 主流增强型",
      what: "ST 入门工控 MCU，C8 为 64KB Flash。",
      notes: ["先对 C8/CB 和 T6/T7，不要只听 F103。"],
      related: ["STM32F103CBT6", "APM32F103C8T6"],
    },
  },
  {
    test: /^STM32F103CB/i,
    knowledge: {
      family: "STM32F1 主流增强型",
      what: "F103 的 128KB Flash 档，不能用 C8 顶。",
      notes: ["和 C8T6 不是同一颗料。"],
      related: ["STM32F103C8T6"],
    },
  },
  {
    test: /^STM32F103/i,
    knowledge: {
      family: "STM32F1",
      what: "ST 最常见 F1 家族。报价前对完整型号。",
      notes: ["不要只听 F103。"],
      related: [],
    },
  },
  {
    test: /^STM32F4/i,
    knowledge: { family: "STM32F4", what: "Cortex-M4F 高性能线。", notes: ["不要用 F1 的价套 F4。"], related: [] },
  },
  {
    test: /^ESP32/i,
    knowledge: {
      family: "乐鑫 Wi-Fi / 蓝牙",
      what: "WROOM / WROVER / C3 / S3 不是同一颗。",
      notes: ["问清 Flash、天线和封装。"],
      related: [],
    },
  },
  {
    test: /^W25Q/i,
    knowledge: {
      family: "华邦 SPI NOR Flash",
      what: "容量看数字：64=64Mbit。",
      notes: ["对容量、电压和封装。"],
      related: [],
    },
  },
];

export function extraKnowledge(mpn) {
  const key = String(mpn || "").trim().toUpperCase();
  const hit = CATALOG.find((row) => row.test.test(key));
  return hit ? hit.knowledge : null;
}

export function buildDossier(identity, alts = [], intel = null) {
  const extra = extraKnowledge(identity?.mpn || "");
  const replacements = (alts || [])
    .filter((a) => a.mpn && a.mpn.toUpperCase() !== String(identity?.mpn || "").toUpperCase())
    .slice(0, 8);
  return {
    extra,
    headline: extra?.what || identity?.summary || intel?.summary || identity?.category || identity?.mpn,
    specs: identity?.specs || [],
    apps: identity?.applications || [],
    replacements,
    notes: [...(extra?.notes || []), ...((intel?.notes || []).slice(0, 4))].slice(0, 8),
  };
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeMarketAnalysis({ mpn, snapshots = [], internalQuoteCount = 0, currentOffers = [] }) {
  const latest = snapshots[snapshots.length - 1] ?? null;
  const lcscStock = latest?.lcscStock ?? currentOffers.find((o) => o.sourceKey === "lcsc")?.stock ?? null;
  const hqewCount = latest?.hqewOfferCount ?? currentOffers.filter((o) => o.sourceKey === "hqew").length;
  const inquiryScore = internalQuoteCount >= 6 ? 85 : internalQuoteCount >= 3 ? 60 : internalQuoteCount >= 1 ? 30 : 0;
  const supplierScore = hqewCount >= 40 ? 85 : hqewCount >= 8 ? 45 : 20;
  const hot = clamp(inquiryScore * 0.7 + supplierScore * 0.3);
  const shortage = lcscStock == null ? 0 : lcscStock === 0 ? 90 : lcscStock < 500 ? 70 : 20;
  const prices = currentOffers.map((o) => o.price).filter((p) => typeof p === "number");
  const priceTrend = prices.length >= 2 ? 40 : 0;
  return {
    mpn,
    hotness: { score: hot, level: hot >= 60 ? "高" : "低", confidence: internalQuoteCount ? "medium" : "low" },
    shortage: { score: shortage, level: shortage >= 60 ? "高" : "低", confidence: lcscStock == null ? "low" : "medium" },
    priceTrend: { score: priceTrend, level: "低", confidence: "low" },
    dataBasis: { snapshotCount: snapshots.length, internalQuoteCount, currentOfferCount: currentOffers.length },
  };
}
