/**
 * Findchips parser extracted from Workbench findchips.server.ts.
 * Pure markdown → offers. Fetch is injected via scrapeMarkdown(url, ctx).
 */
function normalizeMpn(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "");
}

function distributorFromHeading(h) {
  const cleaned = h
    .replace(/^#+\s*/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\\+/g, "")
    .replace(/\]\([^)]*\)/g, "")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const authorized = /Authorized\s+Distributor|ECIA/i.test(cleaned);
  const name =
    cleaned.split(/(?:\s+ECIA\b|\s+Authorized\s+Distributor|\s*•|\s*\(NEDA\))/i)[0].trim() ||
    cleaned.slice(0, 40);
  return { name, authorized };
}

function num(s) {
  const n = Number(String(s).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseFindchipsPage(markdown) {
  const rows = [];
  let authorized = true;
  let distributor = "";
  for (const rawLine of String(markdown || "").split("\n")) {
    const line = rawLine.trim();
    if (/^##\s+\[/.test(line)) {
      const h = distributorFromHeading(line);
      distributor = h.name;
      authorized = h.authorized;
      continue;
    }
    if (!line.startsWith("|") || !line.includes("$")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || !cells[1]) continue;
    const detailCell = cells[1];
    const mpnMatch = detailCell.match(/\[([A-Za-z0-9][A-Za-z0-9./_-]*)\]/);
    if (!mpnMatch) continue;
    const disti = detailCell.match(/DISTI\s*#([A-Za-z0-9-]+)/i)?.[1] ?? "";
    const manufacturer = cells[2]?.replace(/<br[^>]*/g, " ").trim() ?? "";
    const description = cells[3]?.replace(/<br[^>]*/g, " ").replace(/Min Qty:\d+/i, "").trim() ?? "";
    const stockNum = cells[4]?.match(/^\s*(\d[\d,]*)/)?.[1];
    const stock = stockNum != null ? Number(stockNum.replace(/,/g, "")) : null;
    const container = cells[4]?.split(/<br\s*\/?>/i)[1]?.trim() ?? "";
    const breaks = [];
    const ladder = cells[5] ?? "";
    const tokens = ladder.match(/-\s*<br>\s*(\d[\d,]*)|(?:^|<br>)\s*\$\s?([\d,]+\.\d{2,4})/g) ?? [];
    let pendingQty = null;
    for (const t of tokens) {
      const q = t.match(/-\s*<br>\s*(\d[\d,]*)/);
      const p = t.match(/\$\s?([\d,]+\.\d{2,4})/);
      if (q && !p) {
        pendingQty = Number(q[1].replace(/,/g, ""));
        continue;
      }
      if (p) {
        const priceUsd = Number(p[1].replace(/,/g, ""));
        const qty = pendingQty ?? 1;
        pendingQty = null;
        if (priceUsd > 0) breaks.push({ qty, priceUsd });
      }
    }
    const range = (cells[6] ?? "").match(/\$\s?([\d,.]+)\s*\/\s*\$\s?([\d,.]+)/);
    const priceMinUsd = range ? num(range[1]) : (breaks[0]?.priceUsd ?? null);
    const priceMaxUsd = range ? num(range[2]) : breaks.length ? breaks[breaks.length - 1].priceUsd : null;
    rows.push({
      mpn: mpnMatch[1],
      distiPart: disti,
      manufacturer,
      description,
      stock,
      container,
      breaks: breaks.sort((a, b) => a.qty - b.qty),
      priceMinUsd,
      priceMaxUsd,
      authorized,
      distributor: distributor || "Findchips",
    });
  }
  return rows;
}

export function parseFindchipsOffers(markdown, mpn) {
  const want = normalizeMpn(mpn);
  const rows = parseFindchipsPage(markdown).filter(
    (r) => normalizeMpn(r.mpn) === want && ((r.stock != null && r.stock > 0) || r.breaks.length > 0),
  );
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.distributor}|${r.distiPart}|${r.stock}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceKey: "findchips",
      sourceName: `Findchips·${r.distributor}${r.authorized ? "(授权)" : "(独立)"}`,
      supplier: r.distributor.slice(0, 40),
      model: r.mpn,
      brand: r.manufacturer,
      batch: "",
      stock: r.stock,
      price: r.breaks[0]?.priceUsd ?? r.priceMinUsd,
      priceBreaks: r.breaks.map((b) => ({ qty: b.qty, price: b.priceUsd })),
      package: r.container,
      warehouse: r.authorized ? "authorized(US)" : "independent(US)",
      note: `USD; DISTI#${r.distiPart}`,
      date: new Date().toISOString().slice(0, 10),
      url: `https://www.findchips.com/search/${encodeURIComponent(r.mpn)}`,
      currency: "USD",
    });
  }
  out.sort(
    (a, b) =>
      Number(b.warehouse.startsWith("authorized")) - Number(a.warehouse.startsWith("authorized")),
  );
  return out.slice(0, 20);
}
