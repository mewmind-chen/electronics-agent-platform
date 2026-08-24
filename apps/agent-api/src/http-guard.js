import { createHash, randomUUID } from "node:crypto";

export class ApiRequestError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function boundedInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function safeRequestId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{1,64}$/.test(candidate) ? candidate : randomUUID();
}

export function createApiGuard({
  token = "",
  maxBodyBytes = boundedInt(process.env.AGENT_MAX_BODY_BYTES, 12 * 1024 * 1024),
  rateLimit = boundedInt(process.env.AGENT_RATE_LIMIT_PER_MINUTE, 120, { min: 0, max: 100_000 }),
  rateWindowMs = boundedInt(process.env.AGENT_RATE_WINDOW_MS, 60_000),
  now = Date.now,
  logger = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const requiredToken = String(token || "").trim();
  const buckets = new Map();
  const metrics = {
    total: 0,
    inFlight: 0,
    completed: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0,
    unauthorized: 0,
    rateLimited: 0,
    payloadTooLarge: 0,
    deadlineExceeded: 0,
    durationMsTotal: 0,
  };

  function track(req, res, pathname) {
    const requestId = safeRequestId(req.headers["x-request-id"]);
    const startedAt = now();
    metrics.total += 1;
    metrics.inFlight += 1;
    res.setHeader("x-request-id", requestId);
    res.once("finish", () => {
      const durationMs = Math.max(0, now() - startedAt);
      metrics.inFlight = Math.max(0, metrics.inFlight - 1);
      metrics.completed += 1;
      metrics.durationMsTotal += durationMs;
      if (res.statusCode >= 500) metrics.status5xx += 1;
      else if (res.statusCode >= 400) metrics.status4xx += 1;
      else if (res.statusCode >= 200) metrics.status2xx += 1;
      logger(JSON.stringify({
        event: "http_request",
        requestId,
        method: req.method || "",
        path: pathname,
        statusCode: res.statusCode,
        durationMs,
      }));
    });
    return requestId;
  }

  function authorized(req) {
    const ok = !requiredToken || bearer(req) === requiredToken;
    if (!ok) metrics.unauthorized += 1;
    return ok;
  }

  function rate(req) {
    if (rateLimit === 0) return { ok: true, remaining: null, retryAfterSeconds: 0 };
    const timestamp = now();
    const remote = String(req.socket?.remoteAddress || "unknown");
    const identity = createHash("sha256")
      .update(`${remote}\0${bearer(req) || "local"}`)
      .digest("hex");
    let bucket = buckets.get(identity);
    if (!bucket || timestamp - bucket.startedAt >= rateWindowMs) {
      bucket = { startedAt: timestamp, count: 0 };
      buckets.set(identity, bucket);
    }
    if (bucket.count >= rateLimit) {
      metrics.rateLimited += 1;
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + rateWindowMs - timestamp) / 1000)),
      };
    }
    bucket.count += 1;
    return { ok: true, remaining: Math.max(0, rateLimit - bucket.count), retryAfterSeconds: 0 };
  }

  async function readJsonBody(req) {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBodyBytes) {
        tooLarge = true;
        continue;
      }
      chunks.push(buffer);
    }
    if (tooLarge) {
      metrics.payloadTooLarge += 1;
      throw new ApiRequestError(413, "payload_too_large", `request body exceeds ${maxBodyBytes} bytes`);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  }

  function markDeadline() {
    metrics.deadlineExceeded += 1;
  }

  function snapshot() {
    const completed = metrics.completed || 1;
    return {
      ...metrics,
      averageDurationMs: Number((metrics.durationMsTotal / completed).toFixed(2)),
      limits: { maxBodyBytes, rateLimit, rateWindowMs },
    };
  }

  return { track, authorized, rate, readJsonBody, markDeadline, snapshot };
}

export async function withRequestDeadline(work, {
  timeoutMs = boundedInt(process.env.AGENT_REQUEST_DEADLINE_MS, 120_000),
  onDeadline = () => {},
} = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onDeadline();
      const error = new ApiRequestError(504, "deadline_exceeded", "request deadline exceeded");
      controller.abort(error);
      reject(error);
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
