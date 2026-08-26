/**
 * Safe, configuration-only readiness for public market sources.
 *
 * This intentionally never probes a provider and never returns any part of a
 * credential.  `ready` means the Platform process has the credential needed to
 * attempt that connector; fetch/parser health is reported by source traces.
 */
import { resolveAnysearchKey } from "./anysearch.js";
import { resolveFirecrawlKey } from "./firecrawl.js";
import { resolveIcnetCookie } from "./icnet.js";
import { resolveMouserKey } from "./authorized.js";

function state(configured, optional = false) {
  return {
    configured,
    ready: configured,
    ...(optional ? { optional: true } : {}),
    ...(configured ? {} : { reason: "auth_required" }),
  };
}
export function sourceReadiness(ctx = {}) {
  const firecrawl = Boolean(resolveFirecrawlKey(ctx));
  const anysearch = Boolean(resolveAnysearchKey(ctx));
  const icnet = Boolean(resolveIcnetCookie(ctx));
  const mouser = Boolean(resolveMouserKey(ctx));

  return {
    firecrawl: state(firecrawl),
    anysearch: state(anysearch),
    icnet: state(icnet, true),
    mouser: state(mouser, true),
    findchips: state(firecrawl, true),
  };
}

export function sourceConfigured(sourceKey, ctx = {}) {
  if (["lcsc", "hqew", "gys", "shop", "st", "findchips"].includes(sourceKey)) {
    return Boolean(resolveFirecrawlKey(ctx) || ctx.scrapeMarkdown);
  }
  if (sourceKey === "intel") return Boolean(resolveAnysearchKey(ctx));
  if (sourceKey === "icnet") return Boolean(resolveIcnetCookie(ctx));
  if (sourceKey === "mouser") return Boolean(resolveMouserKey(ctx));
  return false;
}
