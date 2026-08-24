/**
 * Markdown parsers extracted from huaqiangbei-workbench src/lib/search/md-parse.ts.
 * Pure functions. No credentials. No DB. No Harness.
 */
/**
 * 从立创 markdown 提取商品图片 URL（真实抓取，不拼接猜测）。
 * 实测立创商品图域为 alimg.szlcsc.com：`upload/public/product/source/`
 * 为高清实物图，`breviary/` 为缩略图。firecrawl 转换后形态：
 *   ![型号实物图](https://alimg.szlcsc.com/upload/public/product/source/….jpg)](...)   ← 链接包图
 *   - ![型号商品缩略图](https://alimg.szlcsc.com/upload/public/product/breviary/….jpg)
 * 优先高清 source，缺失则取首张缩略图；只认这两个真实域。
 */
export function extractLcscImage(markdown) {
  const md = String(markdown || "");
  const sourceRe =
    /!\[[^\]]*\]\(\s*(https?:\/\/alimg\.szlcsc\.com\/upload\/public\/product\/source\/[^)\s]+\.(?:jpe?g|png|webp))/g;
  const breviaryRe =
    /!\[[^\]]*\]\(\s*(https?:\/\/alimg\.szlcsc\.com\/upload\/public\/product\/breviary\/[^)\s]+\.(?:jpe?g|png|webp))/g;
  const pick = (re) => {
    re.lastIndex = 0;
    const m = re.exec(md);
    return m ? m[1].trim() : "";
  };
  return pick(sourceRe) || pick(breviaryRe) || "";
}

function parseMarkdownTables(markdown) {
  const tables = [];
  const lines = String(markdown || "").split("\n");
  let cur = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (cur && cur.rows.length) tables.push(cur);
      cur = null;
      continue;
    }
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((c) => cleanCell(c));
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (!cur) {
      cur = { header: cells, rows: [] };
      continue;
    }
    cur.rows.push(cells);
  }
  if (cur && cur.rows.length) tables.push(cur);
  return tables;
}

export function cleanCell(cell) {
  return cell
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/&/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseNum(text) {
  if (text == null) return null;
  const t = String(text).replace(/,/g, "").trim();
  if (!t || t === "-" || t === "—") return null;
  const m = t.match(/(\d+(?:\.\d+)?)([kKwW万])?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || "").toLowerCase();
  if (u === "k" || u === "w") return Math.round(n * 1000);
  if (u === "万") return Math.round(n * 10000);
  return n;
}

export function cleanShopUrl(raw) {
  const m = String(raw || "").trim().match(/https?:\/\/[^\s)"']+/i);
  return m ? m[0].replace(/\/$/, "") : "";
}

export function parseHqewOffers(markdown) {
  const tables = parseMarkdownTables(markdown);
  const offers = [];
  for (const t of tables) {
    const h = t.header.join("|");
    if (!/供应商/.test(h) || !/型号/.test(h)) continue;
    const supIdx = t.header.findIndex((c) => /供应商/.test(c));
    const modelIdx = t.header.findIndex((c) => /型号/.test(c));
    const brandIdx = t.header.findIndex((c) => /品牌/.test(c));
    const batchIdx = t.header.findIndex((c) => /批号/.test(c));
    const qtyIdx = t.header.findIndex((c) => /数量/.test(c));
    const pkgIdx = t.header.findIndex((c) => /封装/.test(c));
    const whIdx = t.header.findIndex((c) => /仓库/.test(c));
    const noteIdx = t.header.findIndex((c) => /交易说明|说明/.test(c));
    const dateIdx = t.header.findIndex((c) => /日期/.test(c));
    for (const row of t.rows) {
      const supplier = (row[supIdx] || "")
        .replace(/^(商城|广告|推荐|热卖)\s*/, "")
        .replace(/\s*评价\s*/g, " ")
        .replace(/\s*_\d+条_\s*/g, " ")
        .replace(/\s*_(?:原装|正品|渠|推荐参考)_\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const model = (row[modelIdx] || "").replace(/\s.*$/, "").trim();
      if (!model || !/[A-Za-z0-9]/.test(model)) continue;
      const qtyText = row[qtyIdx] || "";
      const qtyMatch = qtyText.match(/\d[\d,]*/);
      const priceMatch = (row[noteIdx] || "").match(/￥?\s*(\d+(?:\.\d+)?)/);
      offers.push({
        supplier,
        model,
        brand: (row[brandIdx] || "").trim(),
        batch: (row[batchIdx] || "").trim(),
        stock: qtyMatch ? Number(qtyMatch[0].replace(/,/g, "")) : null,
        package: (row[pkgIdx] || "").trim(),
        warehouse: (row[whIdx] || "").trim(),
        note: (row[noteIdx] || "").trim(),
        date: (row[dateIdx] || "").replace(/^购买$/, "").trim(),
        price: priceMatch ? Number(priceMatch[1]) : null,
      });
    }
  }
  return offers;
}

export function parseLcscSearchItemUrl(markdown, mpn) {
  const target = String(mpn || "").trim().toUpperCase();
  const re = /\[([^\]]+)\]\((https?:\/\/item\.szlcsc\.com\/(\d+)\.html[^)]*)\)/gi;
  let fallback = "";
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const name = cleanCell(m[1]).replace(/\s+/g, "").toUpperCase();
    const url = `https://item.szlcsc.com/${m[3]}.html`;
    if (name === target) return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

export function parseLcscSearchListing(markdown, mpn) {
  const target = String(mpn || "").trim().toUpperCase();
  const url = parseLcscSearchItemUrl(markdown, mpn);
  if (!url) return null;
  const re = new RegExp(
    `\\[${target}\\]\\([^)]*item\\.szlcsc\\.com/\\d+\\.html[^)]*\\)([\\s\\S]{0,2200})`,
    "i",
  );
  const hit = markdown.match(re);
  const block = hit ? hit[0] + hit[1] : markdown.slice(0, 2800);
  const priceBreaks = [];
  const seen = new Set();
  for (const pm of block.matchAll(/(\d+)\+\s*￥\s*([\d.]+)/g)) {
    const qty = Number(pm[1]);
    if (seen.has(qty)) continue;
    seen.add(qty);
    priceBreaks.push({ qty, price: parseFloat(pm[2]) });
  }
  const brand = (block.match(/品牌\[([^\]]+)\]/) || [])[1] || "";
  const pkg = (block.match(/封装([A-Za-z0-9][A-Za-z0-9()+.\-x×]{1,28})/) || [])[1] || "";
  const cat = (block.match(/类目\[([^\]]+)\]/) || [])[1] || "";
  const stockHit =
    block.match(/嘉立创库存\s*([\d,.]+(?:K\+)?)/i) ||
    block.match(/现货[:：]?\s*([\d,]+(?:K\+)?)/);
  return {
    mpn: target,
    brand: cleanCell(brand),
    category: cleanCell(cat),
    package: pkg,
    desc: "",
    summary: "",
    features: "",
    lcscCode: "",
    specs: [],
    stock: parseNum(stockHit?.[1] || null),
    priceBreaks,
    url,
    alts: [],
    imageUrl: extractLcscImage(block),
  };
}

export function parseGysCompanies(markdown, name) {
  const records = [];
  const cardRe =
    /###\s*\[([^\]]+)\]\(([^)]+)\)[\s\S]*?经营品牌[：:]\s*([^\n]{3,300})[\s\S]*?(?:经营品类[：:]\s*([^\n]{3,300}))?/g;
  let m;
  while ((m = cardRe.exec(markdown)) !== null && records.length < 5) {
    const companyName = m[1].trim();
    const shopUrl = cleanShopUrl(m[2]);
    const cardText = markdown.slice(m.index, m.index + 1200);
    const yearMatch = cardText.match(/会员年限[:：]?\s*(\d+)\s*年/);
    const foundMatch = cardText.match(/成立日期[:：]?\s*([\d-]+)/);
    records.push({
      name: companyName,
      shopUrl,
      brands: m[3]
        .trim()
        .split(/[、,，]/)
        .map((b) => b.trim())
        .filter(Boolean),
      categories: (m[4] || "")
        .trim()
        .split(/[、,，]/)
        .map((c) => c.trim())
        .filter(Boolean),
      memberYears: yearMatch ? yearMatch[1] : "",
      founded: foundMatch ? foundMatch[1] : "",
      matched: sameCompany(name, companyName),
    });
  }
  return records.filter((c) => c.matched);
}

function companyKey(name) {
  const n = String(name || "")
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/^(深圳市?|东莞市?|广州市?|上海市?|北京市?|杭州市?|苏州市?|中山市?|宁波市?|成都市?)/, "")
    .replace(/(股份有限公司|有限责任公司|有限公司|公司)$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return n.length >= 2 ? n : String(name || "").trim().toLowerCase();
}

function companyCore(name) {
  let n = companyKey(name);
  for (let i = 0; i < 4; i++) {
    const next = n.replace(/(电子|科技|实业|贸易|商行|光电|微电子|半导体|器件|元件|技术|发展|集团|控股|国际|股份)+$/, "");
    if (next === n || next.length < 2) break;
    n = next;
  }
  return n;
}

function sameCompany(query, name) {
  const q = String(query || "").trim();
  const n = String(name || "").trim();
  if (!q || !n) return false;
  if (q === n) return true;
  if (companyKey(q) === companyKey(n)) return true;
  const a = companyCore(q);
  const b = companyCore(n);
  return Boolean(a && b && a === b);
}

export function parseShopInventory(markdown) {
  const rows = [];
  for (const t of parseMarkdownTables(markdown)) {
    const h = t.header.join("|");
    if (!/型号/.test(h)) continue;
    const mIdx = t.header.findIndex((c) => /型号/.test(c));
    const bIdx = t.header.findIndex((c) => /品牌|厂商/.test(c));
    const qIdx = t.header.findIndex((c) => /数量/.test(c));
    const batchIdx = t.header.findIndex((c) => /批号/.test(c));
    const pkgIdx = t.header.findIndex((c) => /封装/.test(c));
    const catIdx = t.header.findIndex((c) => /分类/.test(c));
    const dateIdx = t.header.findIndex((c) => /日期|更新/.test(c));
    for (const row of t.rows) {
      const model = (cleanCell(row[mIdx] || "").match(/[A-Za-z0-9][A-Za-z0-9+_.\/-]{2,}/) || [])[0];
      if (!model || model === "暂无数据") continue;
      rows.push({
        model: model.toUpperCase(),
        brand: cleanCell(row[bIdx] || ""),
        category: cleanCell(row[catIdx] || ""),
        package: cleanCell(row[pkgIdx] || ""),
        batch: cleanCell(row[batchIdx] || ""),
        stock: parseNum(row[qIdx]),
        date: cleanCell(row[dateIdx] || ""),
      });
    }
  }
  return rows;
}

export function parseLcscSpecs(markdown) {
  const specs = [];
  const seen = new Set();
  for (const t of parseMarkdownTables(markdown)) {
    const h = t.header.join("|");
    if (!/属性/.test(h) || !/参数/.test(h)) continue;
    const lIdx = t.header.findIndex((c) => /属性/.test(c));
    const vIdx = t.header.findIndex((c) => /参数/.test(c));
    if (lIdx < 0 || vIdx < 0) continue;
    for (const row of t.rows) {
      const label = cleanCell(row[lIdx] || "");
      const value = cleanCell(row[vIdx] || "").replace(/\u200b/g, "");
      if (!label || !value || value === "-") continue;
      if (seen.has(label)) continue;
      seen.add(label);
      specs.push({ label, value });
    }
  }
  return specs;
}

export function parseLcscItem(markdown, mpn, url) {
  const md = String(markdown || "");
  const listing = parseLcscSearchListing(md, mpn);
  const priceBreaks = listing?.priceBreaks?.length
    ? listing.priceBreaks
    : [];
  if (!priceBreaks.length) {
    const seen = new Set();
    for (const m of md.matchAll(/(\d+)\+\s*￥\s*([\d.]+)/g)) {
      const qty = Number(m[1]);
      if (seen.has(qty)) continue;
      seen.add(qty);
      priceBreaks.push({ qty, price: parseFloat(m[2]) });
    }
  }
  const specs = parseLcscSpecs(md);
  const spec = (label) => specs.find((s) => s.label.includes(label))?.value || "";
  const stockMatch = md.match(/现货[:：]\s*([\d,]+(?:K\+)?)/);
  const catMatch = md.match(/商品目录\s*\|\s*([^\n|]+)/) || md.match(/类目\[([^\]]+)\]/);
  const brandMatch = md.match(/品牌名称\[([^\]]+)\]/) || md.match(/品牌\[([^\]]+)\]/);
  const pkgMatch = md.match(/商品封装\s*([A-Za-z0-9()+.\-x×]{2,32})/);
  const summary =
    (md.match(/^#\s*[A-Za-z0-9][^\n]*\n+([^\n#\[]{12,160})/m) || [])[1]?.trim() || "";
  const features = (md.match(/描述特性[：:]\s*([^\n]{20,700})/) || [])[1]?.trim() || "";
  const lcscCode = (md.match(/商品编号\s*(C\d+)/) || [])[1] || "";
  const desc = features || summary || ((md.match(/具有([^。\n]{8,120})/) || [])[0] || "");
  const alts = [];
  for (const t of parseMarkdownTables(md)) {
    const h = t.header.join("|");
    if (!/厂家型号|型号/.test(h) || !/价格|库存/.test(h)) continue;
    const mIdx = t.header.findIndex((c) => /厂家型号|型号/.test(c));
    const pIdx = t.header.findIndex((c) => /价格/.test(c));
    const sIdx = t.header.findIndex((c) => /库存/.test(c));
    const pkgIdx = t.header.findIndex((c) => /封装/.test(c));
    const simIdx = t.header.findIndex((c) => /相似/.test(c));
    for (const row of t.rows) {
      const raw = cleanCell(row[mIdx] || "");
      const mpnHit = (raw.match(/[A-Z0-9][A-Z0-9+_.\/-]{3,}/i) || [])[0];
      if (!mpnHit) continue;
      alts.push({
        mpn: mpnHit.toUpperCase(),
        brand: (raw.match(/ST\([^)]+\)|[\u4e00-\u9fffA-Za-z]{2,12}/) || [])[0] || "",
        package: cleanCell(row[pkgIdx] || ""),
        similarity: cleanCell(row[simIdx] || ""),
        stock: parseNum(row[sIdx]),
        price: parseNum(row[pIdx]),
      });
    }
  }
  const pkg =
    (pkgMatch ? cleanCell(pkgMatch[1]) : "") ||
    spec("封装") ||
    listing?.package ||
    "";
  return {
    mpn: String(mpn || "").toUpperCase(),
    brand: listing?.brand || (brandMatch ? cleanCell(brandMatch[1]) : "") || spec("品牌"),
    category: spec("商品目录") || listing?.category || (catMatch ? cleanCell(catMatch[1]) : ""),
    package: pkg.replace(/\u200b/g, ""),
    desc,
    summary,
    features,
    lcscCode,
    specs,
    stock: parseNum(stockMatch?.[1] || null) ?? listing?.stock ?? null,
    priceBreaks,
    url,
    alts,
    imageUrl: extractLcscImage(md) || listing?.imageUrl || "",
  };
}

export function stProductUrl(mpn) {
  const u = String(mpn || "").toUpperCase();
  if (!u.startsWith("STM32")) return null;
  const base = u.replace(/T\d.*$/i, "").replace(/TR$/i, "").toLowerCase();
  if (base.length < 8) return null;
  return `https://www.st.com/en/microcontrollers-microprocessors/${base}.html`;
}

export function parseStApplications(markdown) {
  const md = String(markdown || "");
  const m = md.match(/applications such as ([^.]{20,400})/i);
  const applications = m
    ? m[1]
        .split(/,\s*|\s+and\s+/)
        .map((s) => s.replace(/^and\s+/i, "").trim())
        .filter((s) => s.length > 2)
        .slice(0, 16)
    : [];
  const descHit = md.match(/The STM32[\s\S]{80,900}?(?:HVACs?\.|\n\n)/i);
  return {
    applications,
    active: /Active/.test(md) || /Product status[\s\S]{0,80}Active/i.test(md),
    longevity: (md.match(/Available until:\s*([0-9/]+)/) || [])[1] || "",
    desc: descHit ? descHit[0].replace(/\s+/g, " ").trim() : "",
  };
}

export function summarizeCompanyInventory(rows) {
  const byBrandMap = new Map();
  const byModel = new Map();
  for (const r of rows || []) {
    const brand = r.brand || "未标品牌";
    const b = byBrandMap.get(brand) || { brand, modelCount: 0, stock: 0, models: [] };
    b.modelCount += 1;
    b.stock += r.stock || 0;
    if (b.models.length < 8) b.models.push(r.model);
    byBrandMap.set(brand, b);
    const prev = byModel.get(r.model) || { model: r.model, brand: r.brand, stock: 0, date: r.date };
    prev.stock += r.stock || 0;
    if (r.date && r.date > (prev.date || "")) prev.date = r.date;
    byModel.set(r.model, prev);
  }
  const byBrand = [...byBrandMap.values()].sort(
    (a, b) => b.stock - a.stock || b.modelCount - a.modelCount,
  );
  const topModels = [...byModel.values()].sort((a, b) => b.stock - a.stock).slice(0, 12);
  return { byBrand, topModels, totalModels: byModel.size, totalRows: (rows || []).length };
}

export function detectQuery(text) {
  const parts = new Set();
  for (const raw of String(text || "").match(/[A-Za-z0-9][A-Za-z0-9+_.\/-]{3,}/g) || []) {
    if (/^\d+(pcs?|片|个|只|件|支|k|m|sets?|reele?|卷|盘)\b/i.test(raw)) continue;
    const value = raw.toUpperCase().replace(/\s+/g, "");
    if (/[A-Z]/.test(value) && /\d/.test(value) && value.length <= 64) parts.add(value);
  }
  if (parts.size) return { kind: "part", candidates: [...parts].slice(0, 12) };
  const company = String(text || "").trim().replace(/\s+/g, " ");
  return /[\u4e00-\u9fffA-Za-z]/.test(company)
    ? { kind: "company", candidates: [company] }
    : { kind: "company", candidates: [] };
}
