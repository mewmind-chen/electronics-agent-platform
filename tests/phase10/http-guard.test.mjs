import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError, createApiGuard, withRequestDeadline } from "../../apps/agent-api/src/http-guard.js";

function request(chunks, { token = "token", remoteAddress = "127.0.0.1" } = {}) {
  const req = Readable.from(chunks);
  req.headers = { authorization: `Bearer ${token}` };
  req.socket = { remoteAddress };
  req.method = "POST";
  return req;
}

test("HTTP guard bounds streamed bodies without retaining overflow", async () => {
  const guard = createApiGuard({ token: "token", maxBodyBytes: 12, logger: () => {} });
  await assert.rejects(
    guard.readJsonBody(request([Buffer.from('{"value":"'), Buffer.alloc(32, 120), Buffer.from('"}')])),
    (err) => err instanceof ApiRequestError && err.status === 413 && err.code === "payload_too_large",
  );
  assert.equal(guard.snapshot().payloadTooLarge, 1);
  assert.deepEqual(await guard.readJsonBody(request([Buffer.from('{"ok":true}')])), { ok: true });
});

test("HTTP guard rate limits a token fingerprint plus remote address", () => {
  let clock = 1_000;
  const guard = createApiGuard({ token: "token", rateLimit: 2, rateWindowMs: 1_000, now: () => clock, logger: () => {} });
  assert.equal(guard.rate(request([])).ok, true);
  assert.equal(guard.rate(request([])).ok, true);
  const rejected = guard.rate(request([]));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.retryAfterSeconds, 1);
  clock += 1_001;
  assert.equal(guard.rate(request([])).ok, true);
  assert.equal(guard.snapshot().rateLimited, 1);
});

test("request deadline aborts work and emits only a stable error code", async () => {
  let signal;
  let deadlineCount = 0;
  await assert.rejects(
    withRequestDeadline(
      (requestSignal) => {
        signal = requestSignal;
        return new Promise(() => {});
      },
      { timeoutMs: 5, onDeadline: () => deadlineCount++ },
    ),
    (err) => err instanceof ApiRequestError && err.status === 504 && err.code === "deadline_exceeded",
  );
  assert.equal(signal.aborted, true);
  assert.equal(deadlineCount, 1);
});

test("request tracking preserves safe ids and logs no headers", () => {
  const lines = [];
  const guard = createApiGuard({ token: "super-secret", now: () => 10, logger: (line) => lines.push(line) });
  const req = request([], { token: "super-secret" });
  req.headers["x-request-id"] = "caller_01";
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (key, value) => { res.headers[key] = value; };
  assert.equal(guard.track(req, res, "/v1/parts/research"), "caller_01");
  res.emit("finish");
  assert.equal(res.headers["x-request-id"], "caller_01");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("super-secret"), false);
  assert.match(lines[0], /caller_01/);
});
