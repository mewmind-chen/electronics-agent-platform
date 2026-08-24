/**
 * ICNet HTML parser (from Workbench parseIcnetHtml).
 * Cookie is an argument. No Playwright singleton. No /workspace file probe.
 */
function normMpn(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function resolveIcnetCookie(ctx = {}) {
  return String(ctx.icnetCookie || process.env.ICNET_COOKIE || "").trim();
}

export function parseIcnetHtml(html, mpn) {
  const out = [];
  const seen = new Set();
  const want = normMpn(mpn);
  const marks = [...String(html || "").matchAll(/class="(?:result_son|stair_tr)[^"]*"/g)].map((m) => m.index ?? 0);
  if (!marks.length) return out;
  const bodyStart = html.indexOf("<body");
  const slices = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i] < bodyStart) continue;
    const end2 = i + 1 < marks.length ? marks[i + 1] : Math.min(html.length, marks[i] + 8000);
    slices.push(html.slice(marks[i], end2));
  }
  const YUAN = "\uFFE5";
  const isNum = (t) => !!t && /^\d[\d,]*$/.test(t);
  const numOf = (t) => Number(String(t).replace(/,/g, ""));

  for (const block of slices) {
    const text = block
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    if (!text.toUpperCase().includes(want)) continue;
    const toks = text.split(" ").filter(Boolean);

    for (let i = 0; i + 5 < toks.length; i += 1) {
      if (!(isNum(toks[i]) && toks[i + 1] === "+" && toks[i + 2] === "$:" && toks[i + 4].startsWith(YUAN))) continue;
      const qty = numOf(toks[i]);
      const priceUsd = Number(toks[i + 3]);
      const priceCny = numOf(toks[i + 5]);
      if (!(qty > 0 && priceUsd > 0 && priceCny > 0)) continue;
      let batch = "";
      for (let k = i - 1; k >= Math.max(0, i - 8); k -= 1) {
        if (/^\d{4}$/.test(toks[k] ?? "")) {
          batch = toks[k];
          break;
        }
      }
      const key = `ICGOO|${batch}|${priceCny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        sourceKey: "icnet",
        sourceName: "IC交易网·ICGOO",
        supplier: "ICGOO商城",
        model: want,
        brand: "",
        batch,
        stock: null,
        price: priceCny,
        priceBreaks: [{ qty, price: priceCny }],
        package: "",
        warehouse: "icgoo",
        note: "CNY; ICGOO双币阶梯",
        date: new Date().toISOString().slice(0, 10),
        url: `https://www.ic.net.cn/search/${encodeURIComponent(want)}.html`,
        currency: "CNY",
      });
      break;
    }

    const lowIdx = toks.indexOf("低至");
    if (lowIdx < 6) continue;
    let priceTok = null;
    for (let k = lowIdx + 1; k <= lowIdx + 3 && k < toks.length; k += 1) {
      const m = toks[k].match(new RegExp(YUAN + "?\\s*([\\d,.]+)"));
      if (m) {
        priceTok = m[1];
        break;
      }
    }
    if (!priceTok) continue;
    const pkg = toks[lowIdx - 1];
    const region = toks[lowIdx - 2];
    const stockTok = toks[lowIdx - 3];
    const batchTok = toks[lowIdx - 4];
    const brand = toks[lowIdx - 5];
    const modelTok = toks[lowIdx - 6];
    if (normMpn(modelTok ?? "") !== want) continue;
    if (!/^\d{2,4}\+?$/.test(batchTok)) continue;
    if (!isNum(stockTok)) continue;
    let supplier = "IC交易网供应商";
    for (let k = lowIdx - 7; k >= Math.max(0, lowIdx - 40); k -= 1) {
      if (/公司|电子|科技|贸易|实业|微电子/.test(toks[k]) && toks[k].length >= 4) {
        supplier = toks[k];
        break;
      }
    }
    const key = `${supplier}|${batchTok}|${stockTok}|${priceTok}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceKey: "icnet",
      sourceName: "IC交易网",
      supplier,
      model: want,
      brand,
      batch: batchTok,
      stock: numOf(stockTok),
      price: numOf(priceTok),
      package: pkg,
      warehouse: region,
      note: `CNY; 地区:${region || "未知"}`,
      date: new Date().toISOString().slice(0, 10),
      url: `https://www.ic.net.cn/search/${encodeURIComponent(want)}.html`,
      currency: "CNY",
    });
    if (out.length >= 40) break;
  }
  return out.slice(0, 40);
}

/** Structured degrade when cookie is absent. Browser session stays in the business app. */
export function icnetAuthOrParse(html, mpn, ctx = {}) {
  const cookie = resolveIcnetCookie(ctx);
  const url = `https://www.ic.net.cn/search/${encodeURIComponent(mpn)}.html`;
  if (!cookie && !html) {
    return {
      status: "auth_required",
      detail: "IC交易网需会员 cookie（从 ctx.icnetCookie 传入，平台不读业务项目文件）",
      url,
    };
  }
  if (!html) return { status: "empty", detail: "no html", url };
  const offers = parseIcnetHtml(html, mpn);
  if (!offers.length) return { status: "empty", detail: "未解析到结构化挂货行", url };
  return { status: "ok", offers, url };
}
