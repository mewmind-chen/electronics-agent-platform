/**
 * Deterministic domain parsers extracted from xinghao-radar src/lib/domain.ts.
 * Matching windows / stock ledger / Cross Match stay in Radar.
 */
import { displayMpn, normalizeMpnKey } from "@electronics/contracts";

export { displayMpn, normalizeMpnKey };

export function correctTradeText(raw) {
  return String(raw ?? "")
    .replace(/板田/g, "坂田")
    .replace(/香港仓/g, "HK")
    .replace(/HK仓/gi, "HK")
    .replace(/\bAOT\b/gi, "LT")
    .replace(/货期\s*[:=]?\s*AOT/gi, "货期 LT");
}

export function parseQty(raw) {
  if (raw == null) return null;
  let s = String(raw).normalize("NFKC").trim().replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return null;
  s = s.replace(/[片个只颗PCS|EA|pcs]+$/i, "");
  const m = s.match(/^([+-]?)(\d+(?:\.\d+)?)(万|W|K|M)?$/i);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[3] || "").toUpperCase();
  let qty = n;
  if (unit === "K") qty = n * 1000;
  else if (unit === "万" || unit === "W") qty = n * 10000;
  else if (unit === "M") qty = n * 1_000_000;
  return sign * Math.round(qty);
}

export function parseCost(raw) {
  if (!raw) return { amount: null, currency: null, tax: null, isTp: false };
  const s = String(raw).normalize("NFKC").trim();
  if (!s) return { amount: null, currency: null, tax: null, isTp: false };
  if (/^(TP|目标价|请报价|报TP)$/i.test(s)) {
    return { amount: null, currency: null, tax: null, isTp: true };
  }
  let tax = null;
  let t = s;
  if (t.includes("⁻") || /未税/.test(t)) tax = "exclusive";
  if (t.includes("⁺") || /含税/.test(t)) tax = "inclusive";
  t = t.replace(/[⁻⁺]|未税|含税/g, "");
  let currency = null;
  if (/[$＄USD|美金|美元]/i.test(t)) currency = "USD";
  if (/[¥￥RMB|CNY|人民币]/i.test(t)) currency = "CNY";
  const num = t.replace(/[^0-9.+-]/g, "");
  const amount = num ? Number(num) : null;
  if (currency === "USD") tax = tax ?? "none";
  if (currency === "CNY" && !tax) tax = "exclusive";
  return {
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    currency,
    tax,
    isTp: false,
  };
}

const WH_ALIASES = {
  香港: "HK",
  香港仓: "HK",
  hk: "HK",
  HK: "HK",
  HK仓: "HK",
  板田: "坂田",
  坂田: "坂田",
  坂田仓: "坂田",
  交通: "交通",
  交通仓: "交通",
  交通银行: "交通",
};

export function resolveWarehouseCode(raw) {
  if (!raw) return null;
  const s = String(raw).normalize("NFKC").trim();
  if (!s) return null;
  return WH_ALIASES[s] ?? WH_ALIASES[s.toUpperCase()] ?? s;
}

export function brandShort(raw) {
  if (!raw) return null;
  const s = String(raw).normalize("NFKC").trim();
  if (!s) return null;
  const map = {
    "TEXAS INSTRUMENTS": "TI",
    德州仪器: "TI",
    意法: "ST",
    STMicroelectronics: "ST",
    恩智浦: "NXP",
    亚德诺: "ADI",
    "Analog Devices": "ADI",
    乐鑫: "Espressif",
    微芯: "Microchip",
    华邦: "Winbond",
    安森美: "ON",
    英飞凌: "Infineon",
  };
  return map[s] ?? map[s.toUpperCase()] ?? s;
}
