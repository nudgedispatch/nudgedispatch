var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
__name(isBytes, "isBytes");
var atitle = /* @__PURE__ */ __name((title) => title ? `"${title}" ` : "", "atitle");
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
__name(anumber, "anumber");
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
__name(abytes, "abytes");
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
__name(ahash, "ahash");
var aobject = /* @__PURE__ */ __name((value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
}, "aobject");
var aopts = /* @__PURE__ */ __name((value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
}, "aopts");
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
__name(aexists, "aexists");
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
__name(aoutput, "aoutput");
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
__name(clean, "clean");
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
__name(createView, "createView");
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
__name(rotr, "rotr");
function utf8ToBytes(str2) {
  if (typeof str2 !== "string")
    throw new TypeError("string expected");
  const encoded = new TextEncoder().encode(str2);
  try {
    return new Uint8Array(encoded);
  } finally {
    clean(encoded);
  }
}
__name(utf8ToBytes, "utf8ToBytes");
function kdfInputToBytes(data, errorTitle = "") {
  if (typeof data === "string")
    return utf8ToBytes(data);
  return abytes(data, void 0, errorTitle);
}
__name(kdfInputToBytes, "kdfInputToBytes");
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
__name(checkOpts, "checkOpts");
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = /* @__PURE__ */ __name((msg, opts) => hashCons(opts).update(msg).digest(), "hashC");
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
__name(createHasher, "createHasher");
var oidNist = /* @__PURE__ */ __name((suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
}), "oidNist");

// node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  static {
    __name(this, "_HMAC");
  }
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = /* @__PURE__ */ __name(((hash, key, message) => new _HMAC(hash, key).update(message).digest()), "hmac_");
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@noble/hashes/pbkdf2.js
function pbkdf2Init(hash, _password, _salt, _opts) {
  ahash(hash);
  const opts = checkOpts({ dkLen: 32, asyncTick: 10 }, _opts);
  const { c, dkLen, asyncTick } = opts;
  anumber(c, "c");
  anumber(dkLen, "dkLen");
  anumber(asyncTick, "asyncTick");
  if (c < 1)
    throw new Error('"c" (iterations) must be >= 1');
  if (dkLen < 1)
    throw new Error('"dkLen" must be >= 1');
  if (dkLen > (2 ** 32 - 1) * hash.outputLen)
    throw new Error("derived key too long");
  const p = kdfInputToBytes(_password, "password");
  try {
    const s = kdfInputToBytes(_salt, "salt");
    try {
      const DK = new Uint8Array(dkLen);
      const { iHash, oHash, outputLen } = hmac.create(hash, p);
      const u = new Uint8Array(outputLen);
      const eng = pbkdf2Engine(iHash, oHash, s, u);
      return { c, dkLen, asyncTick, DK, outputLen, eng };
    } finally {
      if (typeof _salt === "string")
        clean(s);
    }
  } finally {
    if (typeof _password === "string")
      clean(p);
  }
}
__name(pbkdf2Init, "pbkdf2Init");
function pbkdf2Engine(iHash, oHash, salt, u) {
  const counter = new Uint8Array(4);
  const view = createView(counter);
  const salted = iHash._cloneInto().update(salt);
  const work = oHash._cloneInto();
  const iClone = iHash._cloneInto;
  const oClone = oHash._cloneInto;
  return {
    u1: /* @__PURE__ */ __name((ti, Ti) => {
      view.setInt32(0, ti, false);
      salted._cloneInto(work).update(counter).digestInto(u);
      oHash._cloneInto(work).update(u).digestInto(u);
      Ti.set(u.subarray(0, Ti.length));
    }, "u1"),
    // Whole `F` inner loop for the sync variant: one optimized function owns the hot loop.
    rounds: /* @__PURE__ */ __name((c, Ti) => {
      for (let ui = 1; ui < c; ui++) {
        iClone.call(iHash, work).update(u).digestInto(u);
        oClone.call(oHash, work).update(u).digestInto(u);
        for (let i = 0; i < Ti.length; i++)
          Ti[i] ^= u[i];
      }
    }, "rounds"),
    output: /* @__PURE__ */ __name((DK) => {
      iHash.destroy();
      oHash.destroy();
      salted.destroy();
      work.destroy();
      clean(u);
      return DK;
    }, "output")
  };
}
__name(pbkdf2Engine, "pbkdf2Engine");
function pbkdf2(hash, password, salt, opts) {
  const { c, dkLen, DK, outputLen, eng } = pbkdf2Init(hash, password, salt, opts);
  for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += outputLen) {
    const Ti = DK.subarray(pos, pos + outputLen);
    eng.u1(ti, Ti);
    eng.rounds(c, Ti);
  }
  return eng.output(DK);
}
__name(pbkdf2, "pbkdf2");

// node_modules/@noble/hashes/_u64.js
var fromNumH = /* @__PURE__ */ __name((n) => n / 2 ** 32 | 0, "fromNumH");
var fromNumL = /* @__PURE__ */ __name((n) => n >>> 0, "fromNumL");
function setU64FromNum(view, byteOffset, n, isLE) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE ? l : h, isLE);
  view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}
__name(setU64FromNum, "setU64FromNum");

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
__name(Chi, "Chi");
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
__name(Maj, "Maj");
var HashMD = class {
  static {
    __name(this, "HashMD");
  }
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  static {
    __name(this, "SHA2_32B");
  }
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  static {
    __name(this, "_SHA256");
  }
  constructor() {
    super(32, SHA256_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// src/util.ts
function json(data, status = 200, extra) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}
__name(json, "json");
function fail(status, error) {
  return json({ ok: false, error }, status);
}
__name(fail, "fail");
function isResponse(v) {
  return v instanceof Response;
}
__name(isResponse, "isResponse");
async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return fail(415, "Expected JSON.");
  const len = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(len) && len > 25e4) return fail(413, "That upload is too large.");
  const text = await request.text();
  if (text.length > 25e4) return fail(413, "That upload is too large.");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail(400, "Expected an object.");
    return value;
  } catch {
    return fail(400, "Expected JSON.");
  }
}
__name(readJson, "readJson");
function str(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}
__name(str, "str");
function normEmail(v) {
  const email = str(v, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}
__name(normEmail, "normEmail");
function todayIso(now = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  return parts;
}
__name(todayIso, "todayIso");
function money(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + "$" + (abs / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
__name(money, "money");
function parseFare(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 0 || v > 1e5) return null;
    return Math.round(v * 100);
  }
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (n > 1e5) return null;
  return Math.round(n * 100);
}
__name(parseFare, "parseFare");
function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
__name(validDate, "validDate");
function validTime(v) {
  const match = /^(\d{2}):(\d{2})$/.exec(v);
  if (!match) return false;
  const h = Number(match[1]);
  const min = Number(match[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}
__name(validTime, "validTime");
function readCookie(header, name) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}
__name(readCookie, "readCookie");
function longDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1];
  return `${dow}, ${mon} ${Number(match[3])}, ${match[1]}`;
}
__name(longDate, "longDate");
function time12(t) {
  const match = /^(\d{2}):(\d{2})$/.exec(t);
  if (!match) return t;
  let h = Number(match[1]);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${match[2]} ${ap}`;
}
__name(time12, "time12");

// src/auth.ts
var PASSWORD_KDF = "pbkdf2-sha256";
var PASSWORD_ITERATIONS = 1e5;
var WORKERS_PBKDF2_CALL_LIMIT = 1e5;
var SESSION_MS = 14 * 24 * 60 * 60 * 1e3;
var INVITE_MS = 72 * 60 * 60 * 1e3;
var LOCK_WINDOW_MS = 15 * 60 * 1e3;
var LOCK_MAX = 8;
var DUMMY_SALT = new Uint8Array(new ArrayBuffer(16));
function inviteTtl() {
  return INVITE_MS;
}
__name(inviteTtl, "inviteTtl");
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
__name(bytesToB64, "bytesToB64");
function b64ToBytes(value) {
  const bin = atob(value);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(b64ToBytes, "b64ToBytes");
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(randomToken, "randomToken");
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b))
  ]);
  return crypto.subtle.timingSafeEqual(new Uint8Array(ha), new Uint8Array(hb));
}
__name(safeEqual, "safeEqual");
async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PASSWORD_ITERATIONS) {
  const bits = iterations > WORKERS_PBKDF2_CALL_LIMIT ? pbkdf2(sha256, new TextEncoder().encode(password), salt, { c: iterations, dkLen: 32 }) : new Uint8Array(await deriveBits(password, salt, iterations));
  return { salt: bytesToB64(salt), hash: bytesToB64(bits), iterations, kdf: PASSWORD_KDF };
}
__name(hashPassword, "hashPassword");
async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}
__name(deriveBits, "deriveBits");
async function verifyPassword(password, saltB64, hashB64, iterations) {
  const next = await hashPassword(password, b64ToBytes(saltB64), iterations);
  return safeEqual(next.hash, hashB64);
}
__name(verifyPassword, "verifyPassword");
async function dummyVerify(password) {
  const hashed = await hashPassword(password, DUMMY_SALT);
  await safeEqual(hashed.hash, "not-a-real-password-hash");
}
__name(dummyVerify, "dummyVerify");
function passwordProblem(password, email) {
  if (typeof password !== "string" || password.length < 12 || password.length > 200) {
    return "Use a password between 12 and 200 characters.";
  }
  if (password.toLowerCase() === email.toLowerCase()) return "Use a password that is not your email.";
  return "";
}
__name(passwordProblem, "passwordProblem");
function sessionCookie(token, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `nudge_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
__name(sessionCookie, "sessionCookie");
function clearCookie(request) {
  return sessionCookie("", request, 0);
}
__name(clearCookie, "clearCookie");
function profileFromRow(userId, row, env) {
  if (row.platform_admin === 1 && isListedPlatformAdmin(env, row.email)) {
    return {
      userId,
      email: row.email,
      companyId: "",
      companyName: "",
      role: "platform_admin",
      accountKind: "",
      platformAdmin: true,
      suspended: false
    };
  }
  if (!row.company_id || !row.company_name) return null;
  return {
    userId,
    email: row.email,
    companyId: row.company_id,
    companyName: row.company_name,
    role: row.member_role === "driver" ? "driver" : "owner",
    accountKind: row.company_kind === "fleet" ? "fleet" : "individual",
    platformAdmin: false,
    suspended: row.company_status !== "active"
  };
}
__name(profileFromRow, "profileFromRow");
async function accountProfile(env, userId) {
  const row = await env.DB.prepare(
    `SELECT u.email, u.company_id, u.platform_admin, c.name AS company_name, c.kind AS company_kind,
            c.status AS company_status, m.role AS member_role, d.deleted_at AS driver_deleted_at
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     LEFT JOIN memberships m ON m.user_id = u.id AND m.company_id = u.company_id
     LEFT JOIN drivers d ON d.user_id = u.id AND d.company_id = u.company_id
     WHERE u.id = ?`
  ).bind(userId).first();
  if (!row || row.driver_deleted_at) return null;
  return profileFromRow(userId, row, env);
}
__name(accountProfile, "accountProfile");
async function currentUser(request, env) {
  const token = readCookie(request.headers.get("cookie"), "nudge_session");
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, u.id AS user_id, u.email,
            u.company_id, u.platform_admin, c.name AS company_name, c.kind AS company_kind,
            c.status AS company_status, m.role AS member_role, d.deleted_at AS driver_deleted_at, c.stripe_customer_id, c.stripe_subscription_id, c.billing_status, c.billing_past_due_at, c.billing_paid_through, c.billing_last_paid_at, c.billing_event_at, c.billing_updated_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN companies c ON c.id = u.company_id
     LEFT JOIN memberships m ON m.user_id = u.id AND m.company_id = u.company_id
     LEFT JOIN drivers d ON d.user_id = u.id AND d.company_id = u.company_id
     WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at < Date.now() || row.driver_deleted_at) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }
  const profile = profileFromRow(row.user_id, row, env);
  if (!profile || profile.suspended) return null;
  return {
    sessionId: row.session_id,
    csrf: row.csrf_token,
    userId: profile.userId,
    email: profile.email,
    companyId: profile.companyId,
    companyName: profile.companyName,
    role: profile.role,
    accountKind: profile.accountKind,
    platformAdmin: profile.platformAdmin,
    // Billing access for the company (never applies to the platform admin, who has no company).
    access: profile.platformAdmin ? billingAccess(null) : withCustomer(billingAccess(row, Date.now()), row)
  };
}
__name(currentUser, "currentUser");
async function companyAccess(env, profile) {
  if (!profile || profile.platformAdmin || !profile.companyId) return billingAccess(null);
  const row = await env.DB.prepare(`SELECT c.stripe_customer_id, c.stripe_subscription_id, c.billing_status, c.billing_past_due_at, c.billing_paid_through, c.billing_last_paid_at, c.billing_event_at, c.billing_updated_at FROM companies c WHERE c.id = ?`).bind(profile.companyId).first();
  return withCustomer(billingAccess(row, Date.now()), row);
}
__name(companyAccess, "companyAccess");
function withCustomer(access, row) {
  return { ...access, hasCustomer: !!(row && row.stripe_customer_id) };
}
__name(withCustomer, "withCustomer");
async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) return fail(401, "Sign in required.");
  return user;
}
__name(requireUser, "requireUser");
async function requireCsrf(request, user) {
  const sent = request.headers.get("x-csrf-token") || "";
  if (!sent || !await safeEqual(sent, user.csrf)) return fail(403, "The form expired. Reload and try again.");
  return null;
}
__name(requireCsrf, "requireCsrf");
async function requireAdmin(request, env) {
  const configured = env.ADMIN_TOKEN || "";
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!configured || !token || !await safeEqual(token, configured)) return fail(404, "Not found.");
  return null;
}
__name(requireAdmin, "requireAdmin");
async function loginLocked(env, email) {
  const row = await env.DB.prepare("SELECT failures, window_started FROM login_attempts WHERE email = ?").bind(email).first();
  if (!row) return false;
  if (Date.now() - row.window_started > LOCK_WINDOW_MS) return false;
  return row.failures >= LOCK_MAX;
}
__name(loginLocked, "loginLocked");
async function noteFailure(env, email) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT failures, window_started FROM login_attempts WHERE email = ?").bind(email).first();
  if (!row || now - row.window_started > LOCK_WINDOW_MS) {
    await env.DB.prepare(
      `INSERT INTO login_attempts (email, failures, window_started) VALUES (?, 1, ?)
       ON CONFLICT(email) DO UPDATE SET failures = 1, window_started = excluded.window_started`
    ).bind(email, now).run();
    return;
  }
  await env.DB.prepare("UPDATE login_attempts SET failures = failures + 1 WHERE email = ?").bind(email).run();
}
__name(noteFailure, "noteFailure");
async function clearFailures(env, email) {
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
}
__name(clearFailures, "clearFailures");
async function checkPassword(env, email, password) {
  if (isRosterEmail(email)) {
    await dummyVerify(password);
    return null;
  }
  const user = await env.DB.prepare(
    "SELECT id, company_id, password_hash, password_salt, password_iterations, password_kdf FROM users WHERE email = ?"
  ).bind(email).first();
  if (!user) {
    await dummyVerify(password);
    return null;
  }
  if (user.password_kdf !== PASSWORD_KDF) {
    await dummyVerify(password);
    return null;
  }
  const iterations = user.password_iterations || 1e5;
  const ok = await verifyPassword(password, user.password_salt, user.password_hash, iterations);
  if (!ok) return null;
  if (iterations < PASSWORD_ITERATIONS) {
    const hashed = await hashPassword(password);
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_kdf = ? WHERE id = ?"
    ).bind(hashed.hash, hashed.salt, hashed.iterations, hashed.kdf, user.id).run();
  }
  return { id: user.id, company_id: user.company_id };
}
__name(checkPassword, "checkPassword");
async function startSession(env, request, userId) {
  const token = randomToken();
  const csrf = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), userId, await sha256Hex(token), csrf, now + SESSION_MS, now).run();
  return { cookie: sessionCookie(token, request, Math.floor(SESSION_MS / 1e3)), csrf };
}
__name(startSession, "startSession");
async function revokeSession(env, sessionId) {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}
__name(revokeSession, "revokeSession");
async function revokeAll(env, userId) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}
__name(revokeAll, "revokeAll");

// src/trip.ts
var TRIP_ZONE = "America/New_York";
var PROGRESS_STEPS = ["", "En route", "Arrived", "Picked up", "Completed"];
var STEP_BUTTON = {
  "En route": "On my way",
  Arrived: "Arrived",
  "Picked up": "Picked up",
  Completed: "Dropped off \xB7 complete ride"
};
var STEP_NOW = {
  "": "Not started",
  "En route": "On the way to pickup",
  Arrived: "Driver arrived",
  "Picked up": "Rider on board",
  Completed: "Ride complete"
};
var LOC_TTL_MS = 15 * 60 * 1e3;
var LOC_STALE_MS = 5 * 60 * 1e3;
var LOC_MIN_WRITE_MS = 90 * 1e3;
var LOC_MIN_MOVE_M = 150;
var LOC_HEARTBEAT_MS = 180 * 1e3;
var LOC_MAX_FIX_AGE_MS = 10 * 60 * 1e3;
var LOCATION_LINK_MS = 2 * 60 * 60 * 1e3;
function isProgressStep(value) {
  return PROGRESS_STEPS.includes(value);
}
__name(isProgressStep, "isProgressStep");
function stepIndex(step) {
  return PROGRESS_STEPS.indexOf(step);
}
__name(stepIndex, "stepIndex");
function zonedWallToUnix(date, time, timeZone = TRIP_ZONE) {
  if (!validDate(date) || !validTime(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const want = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = want;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
    let h = Number(parts.hour);
    let d = Number(parts.day);
    let m = Number(parts.month);
    let y = Number(parts.year);
    if (h === 24) h = 0;
    const shown = Date.UTC(y, m - 1, d, h, Number(parts.minute), Number(parts.second));
    const diff = want - shown;
    if (diff === 0) return utc;
    utc += diff;
  }
  return utc;
}
__name(zonedWallToUnix, "zonedWallToUnix");
function formatEt(ms) {
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: TRIP_ZONE,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(ms));
  return text.replace(",", "");
}
__name(formatEt, "formatEt");
function minutesBetween(start, end) {
  if (start === null || end === null || end < start) return null;
  return Math.round((end - start) / 6e4);
}
__name(minutesBetween, "minutesBetween");
function mapsDirectionsUrl(address, waypoints) {
  const via = Array.isArray(waypoints) && waypoints.length ? "&waypoints=" + encodeURIComponent(waypoints.join("|")) : "";
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(address) + via;
}
__name(mapsDirectionsUrl, "mapsDirectionsUrl");
function rideSchedule(ride) {
  const progress = isProgressStep(ride.progress) ? ride.progress : "";
  const index = stepIndex(progress);
  const next = index >= 0 && index < PROGRESS_STEPS.length - 1 ? PROGRESS_STEPS[index + 1] : null;
  const previous = index > 0 ? PROGRESS_STEPS[index - 1] : null;
  const plannedPickupAt = zonedWallToUnix(ride.pickupDate, ride.pickupTime);
  const toDropoff = progress === "Picked up" || progress === "Completed";
  const navAddress = toDropoff ? ride.dropoff : ride.pickup;
  const stops = toDropoff && Array.isArray(ride.stops) ? ride.stops : [];
  const navLabel = toDropoff ? (stops.length ? "Navigate to drop-off via " + stops.length + " stop" + (stops.length === 1 ? "" : "s") : "Navigate to drop-off") : "Navigate to pickup";
  const arrivedAt = ride.arrivedAt == null ? null : ride.arrivedAt;
  return {
    progress,
    now: ride.status === "requested" ? "Requested" : ride.status === "declined" ? "Declined" : STEP_NOW[progress],
    nextStep: ride.status === "scheduled" ? next : null,
    nextLabel: next && ride.status === "scheduled" ? STEP_BUTTON[next] : null,
    undoStep: ride.status === "cancelled" || ride.status === "requested" || ride.status === "declined" ? null : previous,
    plannedPickupAt,
    plannedDropoffAt: null,
    enRouteAt: ride.enRouteAt,
    arrivedAt,
    pickedUpAt: ride.pickedUpAt,
    droppedOffAt: ride.completedAt,
    enRouteLabel: ride.enRouteAt === null ? null : formatEt(ride.enRouteAt),
    arrivedLabel: arrivedAt === null ? null : formatEt(arrivedAt),
    pickedUpLabel: ride.pickedUpAt === null ? null : formatEt(ride.pickedUpAt),
    droppedOffLabel: ride.completedAt === null ? null : formatEt(ride.completedAt),
    toPickupMinutes: minutesBetween(ride.enRouteAt, arrivedAt == null ? ride.pickedUpAt : arrivedAt),
    waitingMinutes: minutesBetween(arrivedAt, ride.pickedUpAt),
    tripMinutes: minutesBetween(ride.pickedUpAt, ride.completedAt),
    nav: navAddress ? { label: navLabel, url: mapsDirectionsUrl(navAddress, stops) } : null
  };
}
__name(rideSchedule, "rideSchedule");
function haversineM(a, b) {
  const rad = /* @__PURE__ */ __name((deg) => deg * Math.PI / 180, "rad");
  const earth = 63710088e-1;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}
__name(haversineM, "haversineM");
function cleanFix(body, now) {
  if (typeof body.lat !== "number" || typeof body.lng !== "number") return null;
  const lat = body.lat;
  const lng = body.lng;
  const acc = typeof body.acc === "number" ? body.acc : Number.NaN;
  const ts = typeof body.ts === "number" ? body.ts : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  if (!Number.isFinite(ts) || ts < now - LOC_MAX_FIX_AGE_MS || ts > now + 6e4) return null;
  return {
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    acc: Number.isFinite(acc) && acc >= 0 ? Math.min(Math.round(acc), 1e5) : null,
    fixAt: Math.min(ts, now)
  };
}
__name(cleanFix, "cleanFix");
function shouldWriteLocation(prev, next, now) {
  if (!prev || !Number.isFinite(prev.savedAt) || now - prev.fixAt > LOC_TTL_MS) return true;
  const since = now - prev.savedAt;
  if (since >= LOC_HEARTBEAT_MS) return true;
  return since >= LOC_MIN_WRITE_MS && haversineM(prev, next) >= LOC_MIN_MOVE_M;
}
__name(shouldWriteLocation, "shouldWriteLocation");

// src/promote-admin.ts
var PLACEHOLDER_COMPANY_NAME = "Iron Gate Executive Transport LLC";
async function promotePlatformAdmin(env, email) {
  const empty = {
    found: false,
    email,
    platformAdmin: false,
    companyId: null,
    companyName: null,
    clients: 0,
    rides: 0,
    invoices: 0,
    otherLogins: 0,
    companyRemoved: false,
    sessionsBefore: 0,
    sessionsAfter: 0,
    passwordUnchanged: true
  };
  const user = await env.DB.prepare(
    `SELECT id, company_id, password_hash, password_salt, password_iterations, password_kdf, password_changed_at
     FROM users WHERE email = ?`
  ).bind(email).first();
  if (!user) return empty;
  const sessionsBefore = await count(env, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", user.id);
  let companyName = null;
  let clients = 0;
  let rides = 0;
  let invoices = 0;
  let otherLogins = 0;
  if (user.company_id) {
    const company = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(user.company_id).first();
    companyName = company?.name || null;
    clients = await count(env, "SELECT COUNT(*) AS n FROM clients WHERE company_id = ?", user.company_id);
    rides = await count(env, "SELECT COUNT(*) AS n FROM rides WHERE company_id = ?", user.company_id);
    invoices = await count(env, "SELECT COUNT(*) AS n FROM invoices WHERE company_id = ?", user.company_id);
    otherLogins = await count(env, "SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND id != ?", user.company_id, user.id);
  }
  const remove = !!user.company_id && companyName === PLACEHOLDER_COMPANY_NAME && clients === 0 && rides === 0 && invoices === 0 && otherLogins === 0;
  const statements = [
    env.DB.prepare("UPDATE users SET platform_admin = 1, company_id = NULL WHERE id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM memberships WHERE user_id = ?").bind(user.id)
  ];
  if (remove && user.company_id) {
    const companyId = user.company_id;
    statements.push(
      env.DB.prepare("DELETE FROM invoice_settings WHERE company_id = ?").bind(companyId),
      env.DB.prepare("DELETE FROM driver_locations WHERE company_id = ?").bind(companyId),
      env.DB.prepare("DELETE FROM location_links WHERE company_id = ?").bind(companyId),
      env.DB.prepare("DELETE FROM memberships WHERE company_id = ?").bind(companyId),
      env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(companyId)
    );
  }
  await env.DB.batch(statements);
  const after = await env.DB.prepare(
    `SELECT password_hash, password_salt, password_iterations, password_kdf, password_changed_at, platform_admin, company_id
     FROM users WHERE id = ?`
  ).bind(user.id).first();
  const sessionsAfter = await count(env, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", user.id);
  const passwordUnchanged = !!after && after.password_hash === user.password_hash && after.password_salt === user.password_salt && after.password_iterations === user.password_iterations && after.password_kdf === user.password_kdf && after.password_changed_at === user.password_changed_at;
  if (!after || after.platform_admin !== 1 || after.company_id || !passwordUnchanged || sessionsAfter !== sessionsBefore) {
    throw new Error("Platform admin promotion changed a password or a session.");
  }
  return {
    found: true,
    email,
    platformAdmin: true,
    companyId: user.company_id,
    companyName,
    clients,
    rides,
    invoices,
    otherLogins,
    companyRemoved: remove,
    sessionsBefore,
    sessionsAfter,
    passwordUnchanged: true
  };
}
__name(promotePlatformAdmin, "promotePlatformAdmin");
async function count(env, sql, a, b) {
  const query = env.DB.prepare(sql);
  const row = await (b === void 0 ? query.bind(a) : query.bind(a, b)).first();
  return row?.n || 0;
}
__name(count, "count");

// src/api.ts
function clientHeader(request) {
  return request.headers.get("x-nudge-client") === "1";
}
__name(clientHeader, "clientHeader");
function publicUser(user) {
  return {
    email: isRosterEmail(user.email) ? "" : user.email,
    companyName: user.companyName,
    csrf: user.csrf,
    role: user.role,
    accountKind: user.accountKind,
    platformAdmin: user.role === "platform_admin",
    access: accessJson(user)
  };
}
__name(publicUser, "publicUser");
function accessJson(user) {
  const a = user && user.access;
  if (!a || user.role === "platform_admin") return { state: "none", locked: false, until: null, banner: null, lockedView: null, canManageBilling: false };
  return {
    state: a.state,
    locked: a.locked,
    until: a.until,
    banner: user.role === "owner" ? billingBanner(a) : null,
    lockedView: lockedView(a, user.role),
    // Owner-only self-serve card update (Stripe customer portal). Only when the company has a Stripe customer.
    canManageBilling: user.role === "owner" && !!a.hasCustomer
  };
}
__name(accessJson, "accessJson");
// While billing has paused a company, these still work so the app can show the locked page and the owner can take their data.
var LOCKED_ALLOWED = new Set(["/api/trial", "/api/billing", "/api/billing/payment-method", "/api/export/rides.csv", "/api/export/clients.csv"]);
// A paused owner can still fix billing: open the portal, add/update a card, and pay the open invoice.
var LOCKED_POST_ALLOWED = new Set(["/api/billing/portal", "/api/billing/payment-method/session", "/api/billing/payment-method/confirm", "/api/billing/pay-invoice"]);
function billingLockedResponse(user) {
  return json({ ok: false, error: lockedMessage(user.access, user.role), billingLocked: true, lockedView: lockedView(user.access, user.role) }, 403);
}
__name(billingLockedResponse, "billingLockedResponse");
function ownerOnly(user) {
  if (user.role !== "owner") return fail(403, "Only the account owner can do that.");
  return null;
}
__name(ownerOnly, "ownerOnly");
function clientJson(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    updatedAt: row.updated_at,
    // Nov 20, 2026 (migration 0018): archived clients keep their history but are hidden by default.
    archived: !!row.archived_at,
    archivedAt: row.archived_at || null
  };
}
__name(clientJson, "clientJson");
function isMissingArchiveCol(err) {
  return /no such column: archived_at|has no column named archived_at/i.test(String(err && err.message || err));
}
__name(isMissingArchiveCol, "isMissingArchiveCol");
// Auto-restore (Nov 20, 2026, Jesse): any NEW ride attached to an archived client (public booking page, owner
// New ride, schedule confirm) un-archives that client. Schedules stay paused. Before migration 0018: no-op.
async function autoRestoreClient(env, companyId, clientId, rideId, actorId, source) {
  try {
    const now = Date.now();
    const res = await env.DB.batch([
      env.DB.prepare("UPDATE clients SET archived_at = NULL, updated_at = ? WHERE company_id = ? AND id = ? AND archived_at IS NOT NULL").bind(now, companyId, clientId),
      env.DB.prepare("INSERT INTO admin_audit (id, actor_user_id, action, target_type, target_id, detail, created_at) SELECT ?, ?, 'client.auto_restore', 'client', ?, ?, ? WHERE changes() > 0").bind(crypto.randomUUID(), actorId || "", clientId, JSON.stringify({ companyId, rideId, source }), now)
    ]);
    return !!res[0].meta.changes;
  } catch (err) {
    if (isMissingArchiveCol(err)) return false;
    throw err;
  }
}
__name(autoRestoreClient, "autoRestoreClient");
function displayRideStatus(row) {
  if (row.approval === "requested") return "requested";
  if (row.approval === "declined") return "declined";
  return row.status;
}
__name(displayRideStatus, "displayRideStatus");
function rideQuoteJson(row) {
  if (row.quote_cents === null || row.quote_cents === void 0) return null;
  const q = parseQuoteJson(row.quote_json) || {};
  return {
    totalCents: row.quote_cents,
    total: money(row.quote_cents),
    basis: q.basis || "",
    label: q.label || "",
    lines: Array.isArray(q.lines) ? q.lines.map((line) => ({ label: String(line.label || ""), amount: money(Number(line.cents) || 0) })) : [],
    notes: Array.isArray(q.notes) ? q.notes.map(String) : [],
    miles: q.miles ?? row.quoted_miles ?? null,
    minutes: q.minutes ?? row.quoted_minutes ?? null,
    status: row.quote_status || "",
    quotedAt: row.quoted_at ?? q.at ?? null
  };
}
__name(rideQuoteJson, "rideQuoteJson");
// Landing time for the owner/driver ride view: the flight cron's latest snapshot (actual, else latest
// estimate), else the lookup saved at booking. The existing free wait after landing starts here.
function rideLanding(row) {
  const airport = parseStoredAirport(row.airport_json);
  if (!airport || airport.side !== "pickup") return null;
  let snap = null;
  try { snap = row.flight_status_json ? JSON.parse(row.flight_status_json) : null; } catch { snap = null; }
  const landed = !!(snap && snap.landed);
  const at = snap ? (snap.actualArrival ?? snap.estimatedArrival ?? null) : airport.landingAt ?? null;
  const gate = (snap && snap.gate) || airport.gate || "";
  if (!at && !gate) return null;
  const waitEnds = freeWaitEnds(at);
  return { at: at || null, label: clockEastern(at), landed, gate, freeWaitEndsAt: waitEnds, freeWaitEndsLabel: clockEastern(waitEnds), terminalSource: airport.terminalSource || "" };
}
__name(rideLanding, "rideLanding");
function rideJson(row, role = "owner") {
  const owner = role === "owner";
  const status = displayRideStatus(row);
  return {
    id: row.id,
    clientName: row.client_name,
    date: row.pickup_date,
    time: row.pickup_time,
    pickup: row.pickup,
    dropoff: row.dropoff,
    stops: parseStoredStops(row.stops_json),
    passengers: row.passengers,
    flight: row.flight,
    driverUserId: row.driver_user_id,
    driverName: row.assigned_driver_name || "",
    status,
    approval: row.approval || "none",
    tripType: row.trip_type || "",
    tripTypeLabel: TRIP_LABELS[row.trip_type] || "",
    vehicleName: row.vehicle_name || "",
    hours: row.hours ?? null,
    airport: parseStoredAirport(row.airport_json),
    airportLine: airportSummary(parseStoredAirport(row.airport_json)),
    luggage: row.luggage ?? null,
    landing: rideLanding(row),
    flightAlert: row.flight_alert ? { kind: row.flight_alert_kind, message: row.flight_alert, at: row.flight_alert_at } : null,
    updatedAt: row.updated_at,
    ...owner ? { clientId: row.client_id, clientPhone: row.client_phone || "", clientEmail: row.client_email || "", fareCents: row.fare_cents, fare: money(row.fare_cents), notes: row.notes, payment: row.payment, source: row.source || "", quote: rideQuoteJson(row), quoteStatus: row.quote_status || "", manualReason: row.quote_cents == null ? (parseQuoteJson(row.quote_json) || {}).manualReason || "" : "", priceNeeded: row.approval === "requested" && (row.quote_status === "manual" || row.quote_cents === null || row.quote_cents === void 0) } : {},
    schedule: rideSchedule({
      pickupDate: row.pickup_date,
      pickupTime: row.pickup_time,
      pickup: row.pickup,
      dropoff: row.dropoff,
      stops: parseStoredStops(row.stops_json),
      progress: row.progress || "",
      status,
      enRouteAt: row.en_route_at,
      arrivedAt: row.arrived_at,
      pickedUpAt: row.picked_up_at,
      completedAt: row.completed_at
    })
  };
}
__name(rideJson, "rideJson");
function settingsJson(row) {
  return {
    businessName: row.business_name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    paymentInstructions: row.payment_instructions,
    gratuityNote: row.gratuity_note,
    terms: row.terms,
    prefix: row.prefix,
    nextNumber: row.next_number,
    logoDataUrl: row.logo_data_url,
    themeColor: row.theme_color || "",
    paymentMethods: parseStoredPaymentMethods(row.payment_methods_json),
    updatedAt: row.updated_at
  };
}
__name(settingsJson, "settingsJson");
var LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
async function createInvite(env, email, purpose, companyName, userId, extras = {}) {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + inviteTtl();
  const accountKind = extras.accountKind === "fleet" ? "fleet" : "individual";
  const joinRole = extras.joinRole === "driver" ? "driver" : "owner";
  const billingPlan = normPlan(extras.billingPlan) || null;
  const smsAddon = extras.smsAddon && billingPlan && smsAllowed(billingPlan) ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO invites (id, email, company_name, user_id, purpose, token_hash, expires_at, used_at, created_at, account_kind, join_company_id, join_role, billing_plan, sms_addon)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), email, companyName || null, userId, purpose, await sha256Hex(token), expiresAt, now, accountKind, extras.joinCompanyId || null, joinRole, billingPlan, smsAddon).run();
  return { token, expiresAt };
}
__name(createInvite, "createInvite");
async function claimInvite(env, token) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT id, email, company_name, user_id, purpose, account_kind, join_company_id, join_role, billing_plan, sms_addon FROM invites
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
  ).bind(await sha256Hex(token), now).first();
  if (!row) return null;
  const claim = await env.DB.prepare(
    "UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL"
  ).bind(now, row.id).run();
  if (!claim.meta.changes) return null;
  return row;
}
__name(claimInvite, "claimInvite");
async function releaseInvite(env, id) {
  await env.DB.prepare("UPDATE invites SET used_at = NULL WHERE id = ?").bind(id).run();
}
__name(releaseInvite, "releaseInvite");

function slugBase(name) {
  return slugBaseFromName(str(name, 80));
}
__name(slugBase, "slugBase");
async function allocateSlug(env, name) {
  let base = slugBase(name);
  if (BOOKING_RESERVED.has(base)) base = base + "-rides";
  for (let i = 0; i < 30; i++) {
    const slug = i === 0 ? base : i < 20 ? `${base}-${i + 1}` : `${base}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    if (!BOOKING_SLUG_RE.test(slug) || BOOKING_RESERVED.has(slug)) continue;
    const taken = await env.DB.prepare("SELECT id FROM companies WHERE booking_slug = ?").bind(slug).first();
    if (!taken) return slug;
  }
  return "c-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}
__name(allocateSlug, "allocateSlug");
async function ensureBookingSlug(env, companyId) {
  const company = await env.DB.prepare("SELECT id, name, booking_slug FROM companies WHERE id = ?").bind(companyId).first();
  if (!company) return "";
  if (company.booking_slug) return company.booking_slug;
  const settings = await loadSettings(env, companyId);
  const source = settings && str(settings.business_name, 80) || company.name || "book";
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = await allocateSlug(env, attempt === 0 ? source : source + "-" + (attempt + 1));
    try {
      const result = await env.DB.prepare("UPDATE companies SET booking_slug = ? WHERE id = ? AND booking_slug IS NULL").bind(slug, companyId).run();
      if (result.meta.changes) return slug;
      const again = await env.DB.prepare("SELECT booking_slug FROM companies WHERE id = ?").bind(companyId).first();
      if (again && again.booking_slug) return again.booking_slug;
    } catch {
    }
  }
  const again = await env.DB.prepare("SELECT booking_slug FROM companies WHERE id = ?").bind(companyId).first();
  return again && again.booking_slug || "";
}
__name(ensureBookingSlug, "ensureBookingSlug");
function phoneDigits(value) {
  return str(value, 40).replace(/\D/g, "");
}
__name(phoneDigits, "phoneDigits");
function phonesMatch(a, b) {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return false;
}
__name(phonesMatch, "phonesMatch");
function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return request.headers.get("cf-connecting-ip") || forwarded.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}
__name(clientIp, "clientIp");
async function bookingAllowed(env, request, slug) {
  const ipHash = await sha256Hex("book-ip:" + clientIp(request));
  const now = Date.now();
  const windowMs = 15 * 60 * 1e3;
  const maxHits = 30;
  async function hit(bucket) {
    const row = await env.DB.prepare("SELECT hits, window_started FROM booking_limits WHERE bucket = ?").bind(bucket).first();
    if (!row || now - row.window_started > windowMs) {
      await env.DB.prepare(
        `INSERT INTO booking_limits (bucket, hits, window_started) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET hits = 1, window_started = excluded.window_started`
      ).bind(bucket, now).run();
      return true;
    }
    if (row.hits >= maxHits) return false;
    await env.DB.prepare("UPDATE booking_limits SET hits = hits + 1 WHERE bucket = ?").bind(bucket).run();
    return true;
  }
  __name(hit, "hit");
  if (!await hit("ip:" + ipHash)) return false;
  if (!await hit("slug:" + slug)) return false;
  return true;
}
__name(bookingAllowed, "bookingAllowed");
async function publicBookingCompany(env, slug) {
  if (typeof slug !== "string" || !BOOKING_SLUG_RE.test(slug)) return null;
  const row = await env.DB.prepare(
    `SELECT c.id, c.status, c.name, c.booking_slug, c.created_at, c.trial_status, c.trial_started_at, c.trial_ride_limit,
            c.trial_days, c.trial_ended_at, c.trial_end_reason, c.stripe_customer_id, c.stripe_subscription_id, c.billing_status, c.billing_past_due_at, c.billing_paid_through, c.billing_last_paid_at, c.billing_event_at, c.billing_updated_at, s.business_name, s.logo_data_url, s.theme_color, s.brand_json, s.phone AS contact_phone, s.email AS contact_email
     FROM companies c
     LEFT JOIN invoice_settings s ON s.company_id = c.id
     WHERE c.booking_slug = ?`
  ).bind(slug).first();
  if (!row || row.status !== "active") return null;
  return row;
}
__name(publicBookingCompany, "publicBookingCompany");
function publicCompanyName(row) {
  return str(row.business_name, 80) || str(row.name, 80) || "the operator";
}
__name(publicCompanyName, "publicCompanyName");

// ---- Free trial: 15 completed rides, no time expiry (Jesse, Nov 17, 2026) ----
// Self-serve signups (trial_billing = 'auto') convert to paid Solo automatically at the 15th completed ride.
var TRIAL_COLS = "c.id, c.created_at, c.trial_status, c.trial_started_at, c.trial_ride_limit, c.trial_days, c.trial_ended_at, c.trial_end_reason, c.trial_billing, c.trial_converted_at, c.trial_canceled_at, c.trial_notice_dismissed_at, c.stripe_subscription_id, c.billing_plan, c.billing_status, c.billing_paid_through";
var TRIAL_CONVERT_RETRY_MS = 5 * 60 * 1000;
async function completedRides(env, companyId) {
  // A "ride" = status 'completed'. Requests, drafts, declined and cancelled rides never count.
  return count(env, "SELECT COUNT(*) AS n FROM rides WHERE company_id = ? AND status = 'completed'", companyId);
}
__name(completedRides, "completedRides");
async function companyTrial(env, companyId, row) {
  const company = row && row.trial_billing !== void 0 ? row : await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(companyId).first();
  if (!company) return null;
  const completed = await completedRides(env, companyId);
  const now = Date.now();
  let t = trialState(company, completed, now);
  if (t.newlyEnded) {
    // Record the end once, so undoing a drop-off later does not quietly reopen the trial.
    await env.DB.prepare("UPDATE companies SET trial_status = 'ended', trial_ended_at = ?, trial_end_reason = ? WHERE id = ? AND trial_status = 'trial'").bind(now, t.endedReason, companyId).run();
  }
  if (t.needsConversion) {
    const converted = await convertTrial(env, companyId, now);
    if (converted) {
      const fresh = await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(companyId).first();
      if (fresh) t = trialState(fresh, completed, Date.now());
    }
  }
  return t;
}
__name(companyTrial, "companyTrial");
// Ends the Stripe trial (trial_end=now) exactly once: a conditional claim in D1 plus a Stripe idempotency key.
// No prompt, no opt-in. If Stripe is unreachable the claim is released and the next check retries.
// If the card is declined, Stripe marks the subscription past_due and invoice.payment_failed starts the grace period.
async function convertTrial(env, companyId, now = Date.now()) {
  const claim = await env.DB.prepare(
    `UPDATE companies SET trial_convert_claimed_at = ?
     WHERE id = ? AND trial_billing = 'auto' AND trial_status = 'trial' AND trial_converted_at IS NULL AND trial_canceled_at IS NULL
       AND stripe_subscription_id IS NOT NULL AND (trial_convert_claimed_at IS NULL OR trial_convert_claimed_at < ?)`
  ).bind(now, companyId, now - TRIAL_CONVERT_RETRY_MS).run();
  if (!claim.meta.changes) return false;
  const row = await env.DB.prepare("SELECT stripe_subscription_id FROM companies WHERE id = ?").bind(companyId).first();
  let sub;
  try {
    sub = await stripe(env, "POST", "/v1/subscriptions/" + encodeURIComponent(row.stripe_subscription_id), { trial_end: "now", proration_behavior: "none" }, "nudge-trial-convert-" + companyId);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "error";
    await env.DB.prepare("UPDATE companies SET trial_convert_claimed_at = NULL, trial_convert_error = ? WHERE id = ? AND trial_converted_at IS NULL").bind(message, companyId).run();
    console.log(JSON.stringify({ level: "warn", msg: "trial conversion failed", companyId, error: message }));
    return false;
  }
  const done = await env.DB.prepare(
    `UPDATE companies SET trial_converted_at = ?, trial_status = 'active', trial_ended_at = NULL, trial_end_reason = '', trial_convert_error = '',
       billing_paid_through = COALESCE(?, billing_paid_through) WHERE id = ? AND trial_converted_at IS NULL`
  ).bind(Date.now(), subPeriodEndMs(sub), companyId).run();
  if (done.meta.changes) await writeAudit(env, "system", "trial.converted", "company", companyId, { rides: TRIAL_RIDE_LIMIT });
  return true;
}
__name(convertTrial, "convertTrial");
// End of the first paid month after conversion. Replaces any paid-through date recorded from the trial period.
function subPeriodEndMs(sub) {
  const item = sub && sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const end = Number(item && item.current_period_end || sub && sub.current_period_end || 0);
  return end > 0 ? end * 1000 : null;
}
__name(subPeriodEndMs, "subPeriodEndMs");
function trialBlocked() {
  return json({ ok: false, error: trialBlockedMessage(), trialEnded: true }, 403);
}
__name(trialBlocked, "trialBlocked");
function publicBillingLocked(company) {
  return billingAccess(company, Date.now()).locked;
}
__name(publicBillingLocked, "publicBillingLocked");
function publicPausedView(company) {
  // Billing pause: polite, and says nothing about billing to the public.
  const name = publicCompanyName(company).replace(/\.+$/, "");
  const phone = str(company.contact_phone, 40);
  const email = str(company.contact_email, 120);
  const how = phone && email ? "Please call or email them to book." : phone ? "Please call them to book." : email ? "Please email them to book." : "Please contact them directly to book.";
  return { message: `${name} is not taking online bookings right now. ${how}`, phone, email };
}
__name(publicPausedView, "publicPausedView");
function publicClosedView(company) {
  const name = publicCompanyName(company).replace(/\.+$/, "");
  const phone = str(company.contact_phone, 40);
  const email = str(company.contact_email, 120);
  const how = phone && email ? "Please call or email to book." : phone ? "Please call to book." : email ? "Please email to book." : "Please contact them directly to book.";
  return { message: `${name} is not taking online requests right now. ${how}`, phone, email };
}
__name(publicClosedView, "publicClosedView");
async function getTrial(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  if (user.role !== "owner") return json({ ok: true, trial: null, banner: null });
  const company = await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(user.companyId).first();
  if (!company) return fail(404, "Company not found.");
  const t = await companyTrial(env, user.companyId, company);
  const fresh = await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(user.companyId).first();
  return json({ ok: true, trial: trialJson(t, fresh || company), banner: trialBanner(t), cancelReasons: CANCEL_REASONS });
}
__name(getTrial, "getTrial");
// Informational ride-15 notice: dismiss only, no choices.
async function dismissTrialNotice(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  await env.DB.prepare("UPDATE companies SET trial_notice_dismissed_at = COALESCE(trial_notice_dismissed_at, ?) WHERE id = ? AND trial_converted_at IS NOT NULL").bind(Date.now(), user.companyId).run();
  return json({ ok: true });
}
__name(dismissTrialNotice, "dismissTrialNotice");
// Cancel a self-serve trial from More > Your plan (exit survey screen). Before the 15th ride: never charged.
// The Stripe subscription is canceled immediately with no proration and no final invoice.
async function cancelTrial(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  if (body.confirm !== true) return fail(400, "Confirm to cancel the trial.");
  const feedback = cancelFeedback(body);
  if (feedback.error) return fail(400, feedback.error);
  const company = await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(user.companyId).first();
  if (!company) return fail(404, "Company not found.");
  // Refresh first: a 15th ride may have just converted the trial.
  await companyTrial(env, user.companyId, company);
  const current = await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(user.companyId).first();
  if (current && canCancelPaid(current)) return cancelPaidSolo(env, user, current, feedback);
  if (!canCancelTrial(current)) return fail(409, "There is nothing to cancel on this account.");
  const now = Date.now();
  // Claim the cancel first so a ride completed at the same moment cannot convert the trial.
  const mode = TRIAL_CANCEL_MODE;
  const cols = trialCancelColumns(now);
  const claimed = await env.DB.prepare(
    `UPDATE companies SET trial_canceled_at = ?, trial_status = ?, trial_ended_at = ?, trial_end_reason = ?
     WHERE id = ? AND trial_billing = 'auto' AND trial_converted_at IS NULL AND trial_canceled_at IS NULL
       AND (trial_convert_claimed_at IS NULL OR trial_convert_claimed_at < ?)`
  ).bind(cols.trial_canceled_at, cols.trial_status, cols.trial_ended_at, cols.trial_end_reason, user.companyId, now - TRIAL_CONVERT_RETRY_MS).run();
  if (!claimed.meta.changes) return fail(409, "Your Solo plan is starting right now. Refresh in a moment, or email nudgedispatch@gmail.com.");
  try {
    await stripe(env, "DELETE", "/v1/subscriptions/" + encodeURIComponent(current.stripe_subscription_id), { invoice_now: false, prorate: false });
  } catch (error) {
    const gone = error instanceof StripeError && error.status === 404;
    if (!gone) {
      // Put the trial back so nothing is half-done, and let the owner try again.
      await env.DB.prepare("UPDATE companies SET trial_canceled_at = NULL, trial_status = 'trial', trial_ended_at = NULL, trial_end_reason = '' WHERE id = ? AND trial_canceled_at = ?").bind(user.companyId, now).run();
      return stripeFail(env, error);
    }
  }
  await env.DB.prepare("UPDATE companies SET billing_status = 'canceled', billing_event_at = ?, billing_updated_at = ? WHERE id = ?").bind(now, now, user.companyId).run();
  const ridesUsed = await completedRides(env, user.companyId);
  const feedbackId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO cancellation_feedback (id, company_id, plan, rides_used, reasons, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(feedbackId, user.companyId, (current.billing_plan || "solo") + "-trial", ridesUsed, feedback.reasons ? JSON.stringify(feedback.reasons) : null, feedback.details, now).run();
  await writeAudit(env, user.userId, "trial.canceled", "company", user.companyId, { mode, ridesUsed, skipped: feedback.skipped });
  try {
    await notifyCancellation(env, { companyId: user.companyId, ridesUsed, reasons: feedback.reasons, details: feedback.details, mode });
  } catch (error) {
    console.log(JSON.stringify({ level: "warn", msg: "cancel notify", name: error instanceof Error ? error.name : "Error" }));
  }
  const t = await companyTrial(env, user.companyId);
  return json({ ok: true, canceled: true, kind: "trial", charged: false, mode, trial: t ? trialJson(t) : null, banner: t ? trialBanner(t) : null });
}
__name(cancelTrial, "cancelTrial");
// Paid Solo (after the 15th ride): cancel the Stripe subscription now with no proration and no final invoice,
// so there are no further charges. No refund for the current month; access runs to the paid-through date
// (the existing "ending" billing banner), then the account locks with data kept.
async function cancelPaidSolo(env, user, current, feedback) {
  const now = Date.now();
  try {
    await stripe(env, "DELETE", "/v1/subscriptions/" + encodeURIComponent(current.stripe_subscription_id), { invoice_now: false, prorate: false });
  } catch (error) {
    if (!(error instanceof StripeError && error.status === 404)) return stripeFail(env, error);
  }
  await env.DB.prepare("UPDATE companies SET billing_status = 'canceled', billing_event_at = ?, billing_updated_at = ? WHERE id = ?").bind(now, now, user.companyId).run();
  const ridesUsed = await completedRides(env, user.companyId);
  await env.DB.prepare(
    "INSERT INTO cancellation_feedback (id, company_id, plan, rides_used, reasons, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), user.companyId, current.billing_plan || "solo", ridesUsed, feedback.reasons ? JSON.stringify(feedback.reasons) : null, feedback.details, now).run();
  await writeAudit(env, user.userId, "plan.canceled", "company", user.companyId, { ridesUsed, skipped: feedback.skipped });
  try {
    await notifyCancellation(env, { companyId: user.companyId, ridesUsed, reasons: feedback.reasons, details: feedback.details, mode: "paid" });
  } catch (error) {
    console.log(JSON.stringify({ level: "warn", msg: "cancel notify", name: error instanceof Error ? error.name : "Error" }));
  }
  const until = Number(current.billing_paid_through) > now ? Number(current.billing_paid_through) : null;
  return json({ ok: true, canceled: true, kind: "paid", charged: false, accessUntil: until });
}
__name(cancelPaidSolo, "cancelPaidSolo");
// Email to nudgedispatch@gmail.com when an account is canceled (Jesse approved, Nov 17, 2026).
// Sends only when CANCEL_NOTIFY = "on" AND the RESEND_API_KEY secret is set; otherwise a no-op.
// From: CANCEL_NOTIFY_FROM, or Resend's shared test sender until nudgedispatch.com is verified in Resend
// (that sender only delivers to the Resend account owner's own address, which is this notice's recipient).
// Fails soft: a Resend error is logged (status only) and never breaks the cancel.
var RESEND_TEST_FROM = "Nudge Dispatch <onboarding@resend.dev>";
async function notifyCancellation(env, info) {
  if (!env || env.CANCEL_NOTIFY !== "on" || !env.RESEND_API_KEY) return { sent: false };
  const to = (env.CANCEL_NOTIFY_TO || "nudgedispatch@gmail.com").trim();
  const from = (env.CANCEL_NOTIFY_FROM || "").trim() || RESEND_TEST_FROM;
  const company = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(info.companyId).first();
  const text = [
    info.mode === "paid" ? "A paid Solo subscription was canceled." : "A free trial was canceled.",
    "Company: " + (company && company.name || info.companyId),
    "Rides used: " + info.ridesUsed + " of " + TRIAL_RIDE_LIMIT,
    "Reasons: " + (info.reasons ? info.reasons.join(", ") : "(skipped)"),
    "Comment: " + (info.details || "(none)")
  ].join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: info.mode === "paid" ? "Nudge Dispatch subscription canceled" : "Nudge Dispatch trial canceled", text })
  });
  if (!res.ok) console.log(JSON.stringify({ level: "warn", msg: "cancel notify not sent", status: res.status, testSender: from === RESEND_TEST_FROM }));
  return { sent: res.ok };
}
__name(notifyCancellation, "notifyCancellation");
async function platformCancellationFeedback(request, env) {
  const user = await platformUser(request, env, false);
  if (isResponse(user)) return user;
  const rows = await env.DB.prepare(
    `SELECT f.id, f.company_id, f.plan, f.rides_used, f.reasons, f.details, f.created_at, c.name AS company_name
     FROM cancellation_feedback f LEFT JOIN companies c ON c.id = f.company_id ORDER BY f.created_at DESC LIMIT 200`
  ).all();
  const labels = Object.fromEntries(CANCEL_REASONS);
  const feedback = (rows.results || []).map((r) => {
    let reasons = null;
    try { reasons = r.reasons ? JSON.parse(r.reasons) : null; } catch { reasons = null; }
    return { id: r.id, companyId: r.company_id, companyName: r.company_name || "", plan: r.plan, ridesUsed: r.rides_used, reasons, reasonLabels: reasons ? reasons.map((k) => labels[k] || k) : [], details: r.details || "", createdAt: r.created_at };
  });
  return json({ ok: true, feedback });
}
__name(platformCancellationFeedback, "platformCancellationFeedback");
async function loadBookingSettings(env, companyId) {
  let row = null;
  try {
    row = await env.DB.prepare("SELECT airports_json, capacities_json, flight_rules_json, updated_at FROM booking_settings WHERE company_id = ?").bind(companyId).first();
  } catch {
    row = null;
  }
  const parse = (text, fallback) => {
    try { return JSON.parse(text || ""); } catch { return fallback; }
  };
  const airports = validateAirportConfig(row ? parse(row.airports_json, null) : null).config || { version: 1, airports: [] };
  const capacities = validateCapacities(row ? parse(row.capacities_json, null) : null).capacities || { ...DEFAULT_CAPACITIES };
  return { airports, capacities, flightRules: flightRules(row ? parse(row.flight_rules_json, {}) : {}), updatedAt: row ? row.updated_at : null };
}
__name(loadBookingSettings, "loadBookingSettings");
async function fleetClassSet(env, companyId) {
  const rows = await env.DB.prepare("SELECT vehicle, deleted_at FROM drivers WHERE company_id = ? AND deleted_at IS NULL").bind(companyId).all();
  return fleetClasses(rows.results || []);
}
__name(fleetClassSet, "fleetClassSet");
// Rate-sheet vehicles this fleet can run (an SUV-only roster hides Sedan), with seats capped by the
// fleet's passenger limit for that class (sedans hold 3 by default).
function offeredVehicles(sheet, classes, capacities) {
  return bookableVehicles(sheet.vehicles || [], classes).map((v) => ({ ...v, seats: seatsFor(v, capacities) }));
}
__name(offeredVehicles, "offeredVehicles");
async function publicQuoteInfo(env, companyId, settings) {
  const saved = await loadRateSheet(env, companyId);
  if (!(saved && saved.enabled && saved.sheet)) return null;
  const s = settings || await loadBookingSettings(env, companyId);
  const classes = await fleetClassSet(env, companyId);
  const info = publicSheetInfo({ ...saved.sheet, vehicles: offeredVehicles(saved.sheet, classes, s.capacities) });
  info.vehicles = info.vehicles.map((v) => ({ ...v, vehicleClass: vehicleClassOf(v.name) }));
  return info;
}
__name(publicQuoteInfo, "publicQuoteInfo");
// Browser key for Google Places Autocomplete on the booking page (GOOGLE_MAPS_BROWSER_KEY). It is a
// public, referrer-restricted key (nudgedispatch.com and subdomains), separate from the server-only
// GOOGLE_ROUTES_KEY. Unset: plain address fields.
function mapsBrowserKey(env) {
  const k = String(env.GOOGLE_MAPS_BROWSER_KEY || "").trim();
  return /^[A-Za-z0-9_-]{20,80}$/.test(k) ? k : "";
}
__name(mapsBrowserKey, "mapsBrowserKey");
// Fleet home base and service radius (companies.base_*). Bias for Places Autocomplete only, never a
// restriction. Places caps a bias circle at 50 km, so a larger service radius is clamped for the bias.
const DEFAULT_SERVICE_RADIUS_MILES = 50;
async function loadFleetBase(env, companyId) {
  if (!companyId) return null;
  let row = null;
  try {
    row = await env.DB.prepare("SELECT base_address, base_lat, base_lng, service_radius_miles FROM companies WHERE id = ?").bind(companyId).first();
  } catch {
    row = null;
  }
  if (!row || !row.base_address) return null;
  return { address: row.base_address, lat: row.base_lat ?? null, lng: row.base_lng ?? null, radiusMiles: row.service_radius_miles || DEFAULT_SERVICE_RADIUS_MILES };
}
__name(loadFleetBase, "loadFleetBase");
function readFleetBase(input) {
  if (input === null) return { base: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Expected a home base." };
  const address = str(input.address, 200);
  if (!address) return { base: null };
  const lat = input.lat === null || input.lat === "" || input.lat === void 0 ? null : Number(input.lat);
  const lng = input.lng === null || input.lng === "" || input.lng === void 0 ? null : Number(input.lng);
  if ((lat === null) !== (lng === null)) return { error: "Pick the home base from the address suggestions." };
  if (lat !== null && !(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180)) return { error: "That home base location is not valid." };
  const r = input.radiusMiles === "" || input.radiusMiles === void 0 || input.radiusMiles === null ? DEFAULT_SERVICE_RADIUS_MILES : Number(input.radiusMiles);
  if (!Number.isFinite(r) || r < 1 || r > 300) return { error: "Service radius must be from 1 to 300 miles." };
  return { base: { address, lat, lng, radiusMiles: Math.round(r) } };
}
__name(readFleetBase, "readFleetBase");
// What a page may know: the base rounded to about 1 km (it may be an owner's home), and the radius.
function biasFor(base) {
  if (!base || base.lat == null || base.lng == null) return null;
  return { lat: Math.round(base.lat * 100) / 100, lng: Math.round(base.lng * 100) / 100, radiusMeters: Math.min(5e4, Math.round(base.radiusMiles * 1609.344)) };
}
__name(biasFor, "biasFor");
function placesEnabled(env) {
  return String(env.PLACES_AUTOCOMPLETE || "off").toLowerCase() === "on" && !!env.GOOGLE_MAPS_SERVER_KEY;
}
__name(placesEnabled, "placesEnabled");
// Airport side of a public booking or quote. Replaces the typed pickup or drop-off with the terminal.
function applyAirportChoice(body, settings, vehicleName) {
  const choice = readAirportChoice(body, settings.airports, vehicleClassOf(vehicleName));
  if (choice.error) return { error: choice.error };
  if (!choice.airport) return { airport: null, pickup: str(body.pickup, 200), dropoff: str(body.dropoff, 200) };
  const pickup = choice.airport.side === "pickup" ? choice.address : str(body.pickup, 200);
  const dropoff = choice.airport.side === "dropoff" ? choice.address : str(body.dropoff, 200);
  return { airport: choice.airport, pickup, dropoff };
}
__name(applyAirportChoice, "applyAirportChoice");
async function getPublicBook(request, env, slug) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return fail(404, "Booking page not found.");
  if (publicBillingLocked(company)) {
    return json({ ok: true, open: false, companyName: publicCompanyName(company), logoDataUrl: company.logo_data_url || "", themeColor: (company.theme_color || ""), theme: themeVars(company.theme_color || ""), quotes: null, closed: publicPausedView(company) });
  }
  const trial = await companyTrial(env, company.id, company);
  const settings = await loadBookingSettings(env, company.id);
  if (trial && !trial.open) {
    return json({
      ok: true,
      open: false,
      companyName: publicCompanyName(company),
      logoDataUrl: company.logo_data_url || "", themeColor: (company.theme_color || ""), theme: themeVars(company.theme_color || ""),
      quotes: null,
      closed: publicClosedView(company)
    });
  }
  return json({
    ok: true,
    open: true,
    companyName: publicCompanyName(company),
    logoDataUrl: company.logo_data_url || "", themeColor: (company.theme_color || ""), theme: themeVars(company.theme_color || ""),
    quotes: await publicQuoteInfo(env, company.id, settings),
    airports: publicAirportInfo(settings.airports),
    capacities: settings.capacities,
    places: placesEnabled(env),
    mapsKey: mapsBrowserKey(env),
    bias: biasFor(await loadFleetBase(env, company.id))
  });
}
__name(getPublicBook, "getPublicBook");
async function readPublicJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return fail(415, "Expected JSON.");
  const len = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(len) && len > 8e3) return fail(413, "That request is too large.");
  const text = await request.text();
  if (text.length > 8e3) return fail(413, "That request is too large.");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail(400, "Expected an object.");
    return value;
  } catch {
    return fail(400, "Expected JSON.");
  }
}
__name(readPublicJson, "readPublicJson");
// Why a request has no automatic price (owner view only): stops on an old rate sheet, no rates,
// or the quote engine's reason (no-distance = Google down / cap / no route, too-far, ...).
function manualReason(sheet, stops, q) {
  if (!sheet) return "no-rates";
  if (stops.length && !sheet.distance) return "stops";
  return q && q.reason ? String(q.reason).slice(0, 24) : "no-quote";
}
__name(manualReason, "manualReason");
async function postPublicBook(request, env, slug) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return fail(404, "Booking page not found.");
  if (publicBillingLocked(company)) {
    const paused = publicPausedView(company);
    return json({ ok: false, error: paused.message, closed: paused }, 403);
  }
  const trial = await companyTrial(env, company.id, company);
  if (trial && !trial.open) {
    const closed = publicClosedView(company);
    return json({ ok: false, error: closed.message, closed }, 403);
  }
  const body = await readPublicJson(request);
  if (isResponse(body)) return body;
  // Trap only fields a real browser form never autofills. "company_website" used to be
  // the honeypot name in the form; browsers filled it from a saved profile, the API
  // returned 201 with the company name, and no ride was stored.
  if (str(body.hp_extra, 200) || str(body.website, 200)) {
    return json({ ok: true, companyName: publicCompanyName(company) }, 201);
  }
  if (!await bookingAllowed(env, request, slug)) return fail(429, "Please wait a few minutes and try again.");
  const name = str(body.name, 80);
  const phone = str(body.phone, 40);
  const emailRaw = body.email;
  const email = emailRaw ? normEmail(emailRaw) : "";
  const date = str(body.date, 10);
  const time = str(body.time, 5);
  const tripTypeIn = TRIP_TYPES.includes(body.tripType) ? body.tripType : "";
  const settings = await loadBookingSettings(env, company.id);
  const rates = await loadRateSheet(env, company.id);
  const sheet = rates && rates.enabled ? rates.sheet : null;
  const classes = sheet ? await fleetClassSet(env, company.id) : /* @__PURE__ */ new Set();
  const offered = sheet ? offeredVehicles(sheet, classes, settings.capacities) : [];
  const passengers = Number(body.passengers ?? 1);
  let vehicleRow = sheet ? offered.find((v) => v.id === str(body.vehicle, 40)) || null : null;
  if (sheet && str(body.vehicle, 40) && !vehicleRow) return fail(400, "That vehicle isn't available. Choose another.");
  if (sheet && !vehicleRow && Number.isInteger(passengers)) vehicleRow = vehicleForPassengers(offered, passengers, settings.capacities);
  if (sheet && vehicleRow && Number.isInteger(passengers) && !vehiclesForPassengers([vehicleRow], passengers, settings.capacities).length) {
    return fail(400, `${vehicleRow.name} seats up to ${vehicleRow.seats}. Choose a larger vehicle.`);
  }
  const placed = applyAirportChoice(body, settings, vehicleRow ? vehicleRow.name : "");
  if (placed.error) return fail(400, placed.error);
  const stopsIn = readStops(body.stops);
  if (stopsIn.error) return fail(400, stopsIn.error);
  const stops = stopsIn.stops;
  const pickup = placed.pickup;
  const dropoff = placed.dropoff || (tripTypeIn === "hourly" ? "As directed (hourly)" : "");
  const flight = str(body.flight, 12).toUpperCase();
  const notes = str(body.notes, 2e3);
  const luggageRaw = body.luggage === "" || body.luggage == null ? null : Number(body.luggage);
  if (luggageRaw !== null && (!Number.isInteger(luggageRaw) || luggageRaw < 0 || luggageRaw > 30)) return fail(400, "Enter luggage from 0 to 30 pieces.");
  if (!name) return fail(400, "Enter your name.");
  if (phoneDigits(phone).length < 7) return fail(400, "Enter a valid mobile phone.");
  if (emailRaw && !email) return fail(400, "Enter a valid email, or leave it blank.");
  if (!validDate(date)) return fail(400, "Enter the pickup date.");
  if (date < todayIso()) return fail(400, "Choose a pickup date of today or later.");
  if (!validTime(time)) return fail(400, "Enter the pickup time.");
  if (!pickup) return fail(400, "Enter the pickup address.");
  if (!dropoff) return fail(400, "Enter the drop-off address.");
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 14) return fail(400, "Enter passengers from 1 to 14.");
  const trip = readTrip({ ...body, pickup, dropoff, vehicle: vehicleRow ? vehicleRow.id : "" }, sheet);
  if (tripTypeIn === "hourly" && trip.hours === null) return fail(400, "Choose how many hours.");
  // Server-side estimate only. Any price fields in the request body are ignored.
  // Old rate sheets: a trip with stops gets no automatic estimate. With distance rates, stops are
  // routed and priced. No price for any reason (Google down, cap reached): quote_status manual,
  // the owner sees "Price needed" and types it; the booking always goes through.
  const places = readPlaces(body);
  const q = sheet && (!stops.length || sheet.distance) ? await quoteTrip(env, request, company.id, sheet, trip, { places, airport: placed.airport, stops, settings }) : null;
  const quoted = q && q.available ? q : null;
  const now = Date.now();
  if (placed.airport) {
    // Flight lookup the page already made (same Worker cache, no new provider call).
    const looked = flight ? await cachedFlightLookup(placed.airport.code, normalizeFlight(flight), date) : null;
    if (looked) {
      if (looked.gate) placed.airport.gate = looked.gate;
      if (looked.landingAt) placed.airport.landingAt = looked.landingAt;
    }
    placed.airport.flight = flight ? normalizeFlight(flight) || flight : "";
  }
  const existingClients = await env.DB.prepare("SELECT id, name, phone, email, notes FROM clients WHERE company_id = ? LIMIT 500").bind(company.id).all();
  let clientId;
  const match = (existingClients.results || []).find((row) => phonesMatch(row.phone, phone));
  if (match) {
    clientId = match.id;
    if (email && !match.email) {
      await env.DB.prepare("UPDATE clients SET email = ?, updated_at = ? WHERE company_id = ? AND id = ?").bind(email, now, company.id, clientId).run();
    }
  } else {
    clientId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO clients (id, company_id, name, phone, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(clientId, company.id, name, phone, email, "", now, now).run();
  }
  const rideId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO rides (id, company_id, client_id, driver_user_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight, fare_cents, notes, status, payment, created_at, updated_at, approval, source, trip_type, vehicle_name, hours, quote_cents, quote_json, airport_json, luggage, stops_json, quoted_miles, quoted_minutes, quote_status, quote_rates_json, quoted_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, 'scheduled', 'unpaid', ?, ?, 'requested', 'booking-page', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    rideId, company.id, clientId, date, time, pickup, dropoff, passengers, flight, notes, now, now,
    trip.tripType, trip.vehicleName, trip.tripType === "hourly" ? trip.hours : null,
    quoted ? quoted.totalCents : null,
    quoted ? JSON.stringify({ v: 1, basis: quoted.basis, label: quoted.label, vehicle: quoted.vehicle, lines: quoted.lines, notes: quoted.notes, miles: quoted.miles ?? null, minutes: quoted.minutes ?? null, at: now }) : JSON.stringify({ v: 1, manualReason: manualReason(sheet, stops, q) }),
    placed.airport ? JSON.stringify(placed.airport) : null,
    luggageRaw,
    stopsToStored(stops),
    quoted && quoted.miles != null ? quoted.miles : null,
    quoted && quoted.minutes != null ? quoted.minutes : null,
    quoted ? "auto" : "manual",
    quoted && quoted.rates ? JSON.stringify(quoted.rates) : null,
    quoted ? now : null
  ).run();
  if (!quoted) console.log(JSON.stringify({ level: "info", msg: "manual quote", reason: q ? q.reason || "unavailable" : sheet ? "no-quote" : "no-rates" }));
  await autoRestoreClient(env, company.id, clientId, rideId, "", "booking-page");
  const view = quoted ? quoteView(quoted, publicCompanyName(company)) : null;
  return json({
    ok: true,
    companyName: publicCompanyName(company),
    estimate: view ? { total: view.total, estimate: view.estimate, label: view.label, confirm: view.confirm } : null,
    priceMessage: view ? "" : CONFIRM_SHORTLY,
    trip: { pickup, dropoff, stops, vehicle: trip.vehicleName || "", airport: placed.airport ? airportSummary(placed.airport) : "", meeting: riderMeetingNote(placed.airport) }
  }, 201);
}
__name(postPublicBook, "postPublicBook");
async function decideBooking(request, env, id, decision) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const existing = await ownedRide(env, user, id);
  if (!existing) return fail(404, "Ride not found.");
  if (existing.approval !== "requested") return fail(409, "This request has already been decided.");
  const now = Date.now();
  let result;
  if (decision === "approve") {
    // Declining always works; approving a new request is paused once the trial has ended.
    const trial = await companyTrial(env, user.companyId);
    if (trial && !trial.open) return trialBlocked();
    let finalCents = null;
    const type = request.headers.get("content-type") || "";
    const body = type.toLowerCase().includes("application/json") ? await readJson(request) : {};
    if (isResponse(body)) return body;
    // A typed final price is required. The estimate is only a suggestion and is never used silently.
    const fareRaw = typeof body.fare === "string" ? body.fare.trim() : body.fare;
    if (fareRaw === void 0 || fareRaw === null || fareRaw === "") return fail(400, "Enter the final price to approve.");
    finalCents = parseFare(fareRaw);
    if (finalCents === null) return fail(400, "Enter the final price in dollars, such as 125 or 125.50.");
    const driverId = user.accountKind === "individual" ? user.userId : existing.driver_user_id;
    result = await env.DB.prepare("UPDATE rides SET approval = 'approved', status = 'scheduled', driver_user_id = ?, fare_cents = ?, updated_at = ? WHERE company_id = ? AND id = ? AND approval = 'requested'").bind(driverId, finalCents, now, user.companyId, id).run();
    if (result.meta.changes) queueRideAlert(request, env, user, id, driverId, "assigned");
  } else {
    result = await env.DB.prepare("UPDATE rides SET approval = 'declined', status = 'cancelled', updated_at = ? WHERE company_id = ? AND id = ? AND approval = 'requested'").bind(now, user.companyId, id).run();
  }
  if (!result.meta.changes) return fail(409, "This request has already been decided.");
  const row = await ownedRide(env, user, id);
  return json({ ok: true, ride: row ? rideJson(row, user.role) : null });
}
__name(decideBooking, "decideBooking");

// ---- Rate sheet + instant quotes (draft, Nov 10, 2026) ----
// Prices are always computed here from the company's saved rate sheet. The booking page only
// displays what this returns; any price a browser sends is ignored.
async function limitHit(env, bucket, maxHits, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT hits, window_started FROM booking_limits WHERE bucket = ?").bind(bucket).first();
  if (!row || now - row.window_started > windowMs) {
    await env.DB.prepare(
      `INSERT INTO booking_limits (bucket, hits, window_started) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET hits = 1, window_started = excluded.window_started`
    ).bind(bucket, now).run();
    return true;
  }
  if (row.hits >= maxHits) return false;
  await env.DB.prepare("UPDATE booking_limits SET hits = hits + 1 WHERE bucket = ?").bind(bucket).run();
  return true;
}
__name(limitHit, "limitHit");
async function loadRateSheet(env, companyId) {
  const row = await env.DB.prepare("SELECT enabled, sheet_json, updated_at FROM rate_sheets WHERE company_id = ?").bind(companyId).first();
  if (!row) return null;
  let sheet = null;
  try {
    sheet = JSON.parse(row.sheet_json || "{}");
  } catch {
    sheet = null;
  }
  if (!sheet || sheet.version !== 1 || !Array.isArray(sheet.vehicles) || !sheet.vehicles.length) return { enabled: false, sheet: null, updatedAt: row.updated_at };
  return { enabled: !!row.enabled, sheet, updatedAt: row.updated_at };
}
__name(loadRateSheet, "loadRateSheet");
async function getRateSheet(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const saved = await loadRateSheet(env, user.companyId);
  return json({
    ok: true,
    enabled: !!(saved && saved.enabled),
    rateSheet: saved && saved.sheet ? sheetForEditor(saved.sheet) : null,
    updatedAt: saved ? saved.updatedAt : null,
    distanceLookup: routingProvider(env, request) !== "none"
  });
}
__name(getRateSheet, "getRateSheet");
async function putRateSheet(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const enabled = body.enabled === true;
  const parsed = validateRateSheet(body.rateSheet);
  if (parsed.error) return fail(400, parsed.error);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO rate_sheets (company_id, enabled, sheet_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET enabled = excluded.enabled, sheet_json = excluded.sheet_json, updated_at = excluded.updated_at`
  ).bind(user.companyId, enabled ? 1 : 0, JSON.stringify(parsed.sheet), now).run();
  return json({ ok: true, enabled, rateSheet: sheetForEditor(parsed.sheet), updatedAt: now, distanceLookup: routingProvider(env, request) !== "none" });
}
__name(putRateSheet, "putRateSheet");
function readTrip(body, sheet) {
  const tripType = TRIP_TYPES.includes(body.tripType) ? body.tripType : "";
  const vehicleId = str(body.vehicle, 40);
  const vehicle = sheet && Array.isArray(sheet.vehicles) ? sheet.vehicles.find((v) => v.id === vehicleId) : null;
  const hoursNum = Number(body.hours);
  const hours = tripType === "hourly" && Number.isFinite(hoursNum) && hoursNum > 0 && hoursNum <= 24 && Math.round(hoursNum * 2) === hoursNum * 2 ? hoursNum : null;
  const passengers = Number(body.passengers ?? 1);
  return {
    tripType,
    vehicle: vehicle ? vehicle.id : "",
    vehicleName: vehicle ? vehicle.name : "",
    hours,
    pickup: str(body.pickup, 200),
    dropoff: str(body.dropoff, 200),
    passengers: Number.isInteger(passengers) ? passengers : 1
  };
}
__name(readTrip, "readTrip");
// Road distance: Google Routes API computeRoutes (Compute Routes Essentials: TRAFFIC_UNAWARE, field
// mask routes.distanceMeters,routes.duration, up to 10 intermediates). Server-only key in the
// GOOGLE_ROUTES_KEY Worker secret; it is never sent to the page or returned in a response. Without
// the key there is no distance, and one-way / round-trip requests come through with "We'll confirm
// your price shortly" (quote_status manual). QUOTE_DEV_FAKE_ROUTE=1 (local .dev.vars only, and only
// on localhost) returns a made-up distance so the distance path can be tested without a key.
function routingProvider(env, request) {
  if (env.GOOGLE_ROUTES_KEY) return "google";
  if (env.QUOTE_DEV_FAKE_ROUTE === "1") {
    const host = new URL(request.url).hostname;
    if (host === "127.0.0.1" || host === "localhost") return "fake";
  }
  return "none";
}
__name(routingProvider, "routingProvider");
function routesDailyCap(env) {
  const n = Number(env.ROUTES_DAILY_CAP);
  return Number.isInteger(n) && n >= 0 ? n : 500;
}
__name(routesDailyCap, "routesDailyCap");
function flightDailyCap(env) {
  const n = Number(env.FLIGHT_DAILY_CAP);
  return Number.isInteger(n) && n >= 0 ? n : 200;
}
__name(flightDailyCap, "flightDailyCap");
// Our own daily cap across all fleets. Counts one call and returns true while under the cap.
async function underDailyCap(env, kind, cap) {
  if (cap <= 0) return false;
  const day = todayIso();
  try {
    const row = await env.DB.prepare(
      `INSERT INTO api_daily_usage (day, kind, calls) VALUES (?, ?, 1)
       ON CONFLICT(day, kind) DO UPDATE SET calls = calls + 1 RETURNING calls`
    ).bind(day, kind).first();
    return !!row && row.calls <= cap;
  } catch (error) {
    // No usage table (migration not applied): fail closed, so we never call Google uncounted.
    console.log(JSON.stringify({ level: "error", msg: "daily cap", kind, name: error instanceof Error ? error.name : "Error" }));
    return false;
  }
}
__name(underDailyCap, "underDailyCap");
// Place picked in the booking page's autocomplete: { placeId, lat, lng, types }. Validated loosely;
// anything odd is dropped and the typed address is used.
function readPlace(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const placeId = typeof v.placeId === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(v.placeId) ? v.placeId : "";
  const lat = Number(v.lat), lng = Number(v.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const types = Array.isArray(v.types) ? v.types.filter((t) => typeof t === "string" && /^[a-z_]{2,40}$/.test(t)).slice(0, 12) : [];
  if (!placeId && !hasLoc) return null;
  return { placeId, lat: hasLoc ? lat : null, lng: hasLoc ? lng : null, types };
}
__name(readPlace, "readPlace");
function readPlaces(body) {
  const p = body && body.places && typeof body.places === "object" ? body.places : {};
  const stops = Array.isArray(p.stops) ? p.stops.slice(0, 5).map(readPlace) : [];
  return { pickup: readPlace(p.pickup), dropoff: readPlace(p.dropoff), stops };
}
__name(readPlaces, "readPlaces");
function placeWaypoint(text, place) {
  if (place && place.placeId) return { placeId: place.placeId };
  if (place && place.lat != null) return { location: { latLng: { latitude: place.lat, longitude: place.lng } } };
  const t = String(text || "").trim();
  return t.length >= 4 ? { address: t } : null;
}
__name(placeWaypoint, "placeWaypoint");
// Waypoints for the Routes call. The airport side uses that terminal's curb pin (or, until Devo sets
// the pin, the terminal's address), so International vs Domestic mileage differs.
function tripWaypoints(trip, places, airport, stops) {
  const side = (which) => {
    if (airport && airport.side === which) return terminalWaypoint(airport.code, airport.spot);
    return placeWaypoint(trip[which], places[which]);
  };
  const origin = side("pickup");
  const destination = side("dropoff");
  if (!origin || !destination) return null;
  const intermediates = [];
  for (const [i, s] of (stops || []).entries()) {
    const w = placeWaypoint(s, places.stops[i]);
    if (!w) return null;
    intermediates.push(w);
  }
  return { origin, destination, intermediates };
}
__name(tripWaypoints, "tripWaypoints");
// Airport fee and airport detection: the rider chose an airport connection (always one of our
// airports), or an autocomplete Place of type "airport" that is one of this fleet's airports.
function tripAirportCode(airport, places, settings) {
  if (airport && airport.code) return airport.code;
  const codes = ((settings && settings.airports && settings.airports.airports) || []).map((a) => a.code);
  return detectAirport(places.pickup, codes) || detectAirport(places.dropoff, codes) || "";
}
__name(tripAirportCode, "tripAirportCode");
// Returns { miles, minutes } or null (no key, cap reached, Google error or timeout). Never throws.
async function routeTrip(env, request, companyId, waypoints) {
  const provider = routingProvider(env, request);
  if (provider === "none" || !waypoints) return null;
  const keyText = JSON.stringify(waypoints).toLowerCase();
  if (provider === "fake") {
    // Local only. The daily cap still counts here so the cap path can be tested without Google.
    if (!await underDailyCap(env, "routes", routesDailyCap(env))) return null;
    if (/far away/.test(keyText)) return { miles: 640, minutes: 560 };
    const h = parseInt((await sha256Hex(keyText)).slice(0, 6), 16);
    const miles = 5 + (h % 350) / 10 + waypoints.intermediates.length * 3;
    return { miles: Math.round(miles * 10) / 10, minutes: Math.ceil(miles * 1.6) };
  }
  const cacheKey = new Request("https://route-cache.nudgedispatch.invalid/v2/" + await sha256Hex(provider + "|" + keyText));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const j = await hit.json();
        return j && j.miles > 0 ? j : null;
      }
    } catch {
    }
  }
  // Cost guards: our global daily cap (ROUTES_DAILY_CAP, default 500) and at most 500 uncached
  // lookups per fleet per day. Either one reached: no Google call, the request goes to manual.
  if (!await limitHit(env, "route:" + companyId, 500, 24 * 60 * 60 * 1e3)) {
    console.log(JSON.stringify({ level: "warn", msg: "routes", reason: "fleet-limit" }));
    return null;
  }
  if (!await underDailyCap(env, "routes", routesDailyCap(env))) {
    console.log(JSON.stringify({ level: "warn", msg: "routes", reason: "daily-cap" }));
    return null;
  }
  let result = null;
  try {
    const body = { origin: waypoints.origin, destination: waypoints.destination, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", regionCode: "us", units: "IMPERIAL" };
    if (waypoints.intermediates.length) body.intermediates = waypoints.intermediates;
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_ROUTES_KEY, "x-goog-fieldmask": "routes.distanceMeters,routes.duration" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8e3)
    });
    if (r.ok) {
      const j = await r.json();
      const route = j && j.routes && j.routes[0];
      if (route && route.distanceMeters > 0) result = { miles: metersToMiles(route.distanceMeters), minutes: durationToMinutes(route.duration) };
      else console.log(JSON.stringify({ level: "warn", msg: "routes", reason: "no-route" }));
    } else {
      console.log(JSON.stringify({ level: "warn", msg: "routes", status: r.status }));
    }
  } catch (error) {
    console.log(JSON.stringify({ level: "warn", msg: "routes", name: error instanceof Error ? error.name : "Error" }));
    return null;
  }
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(JSON.stringify(result || { miles: 0 }), { headers: { "content-type": "application/json", "cache-control": "max-age=" + (result ? 604800 : 3600) } }));
    } catch {
    }
  }
  return result;
}
__name(routeTrip, "routeTrip");
// extras: { places, airport (stored airport choice or null), stops (array of addresses), settings }
async function quoteTrip(env, request, companyId, sheet, trip, extras = {}) {
  if (!sheet || !trip.vehicle) return null;
  const stops = extras.stops || [];
  const places = extras.places || { pickup: null, dropoff: null, stops: [] };
  const airportCode = tripAirportCode(extras.airport || null, places, extras.settings);
  const req = { tripType: trip.tripType || "one-way", vehicle: trip.vehicle, pickup: trip.pickup, dropoff: trip.dropoff, hours: trip.hours, passengers: trip.passengers, stops: stops.length, airport: !!airportCode };
  const route = needsDistance(sheet, req) ? await routeTrip(env, request, companyId, tripWaypoints(trip, places, extras.airport || null, stops)) : null;
  const q = computeQuote(sheet, req, route);
  if (q) q.airportCode = airportCode;
  return q;
}
__name(quoteTrip, "quoteTrip");
function quoteView(q, companyName) {
  if (!q) return null;
  if (!q.available) return { available: false, message: q.message || "" };
  return {
    available: true,
    total: formatCents(q.totalCents),
    totalCents: q.totalCents,
    basis: q.basis,
    estimate: q.basis === "distance",
    label: q.label,
    vehicle: q.vehicle,
    lines: q.lines.map((line) => ({ label: line.label, amount: formatCents(line.cents) })),
    notes: q.notes || [],
    miles: q.miles ?? null,
    minutes: q.minutes ?? null,
    confirm: "Final price confirmed by " + String(companyName || "the operator").replace(/\.+$/, "") + " when they approve."
  };
}
__name(quoteView, "quoteView");
async function postPublicQuote(request, env, slug) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return fail(404, "Booking page not found.");
  if (publicBillingLocked(company)) return json({ ok: true, quote: null, closed: true });
  const trial = await companyTrial(env, company.id, company);
  if (trial && !trial.open) return json({ ok: true, quote: null, closed: true });
  const body = await readPublicJson(request);
  if (isResponse(body)) return body;
  const saved = await loadRateSheet(env, company.id);
  if (!saved || !saved.enabled || !saved.sheet) return json({ ok: true, quote: null });
  const ipHash = await sha256Hex("book-ip:" + clientIp(request));
  if (!await limitHit(env, "qip:" + ipHash, 120, 15 * 60 * 1e3) || !await limitHit(env, "qslug:" + slug, 600, 15 * 60 * 1e3)) {
    return fail(429, "Please wait a few minutes and try again.");
  }
  // Old rate sheets (no distance rates yet): a trip with stops is never auto-priced. With distance
  // rates, stops go to Google as intermediates and the extra-stop fee applies.
  const stopsIn = readStops(body.stops);
  if (stopsIn.error) return fail(400, stopsIn.error);
  if (stopsIn.stops.length && !saved.sheet.distance) return json({ ok: true, quote: { available: false, stops: stopsIn.stops.length, message: STOPS_PRICE_MESSAGE } });
  const settings = await loadBookingSettings(env, company.id);
  const classes = await fleetClassSet(env, company.id);
  const offered = offeredVehicles(saved.sheet, classes, settings.capacities);
  const vehicleRow = offered.find((v) => v.id === str(body.vehicle, 40)) || vehicleForPassengers(offered, Number(body.passengers ?? 1), settings.capacities);
  const placed = applyAirportChoice(body, settings, vehicleRow ? vehicleRow.name : "");
  if (placed.error) return json({ ok: true, quote: null });
  const trip = readTrip({ ...body, pickup: placed.pickup, dropoff: placed.dropoff, vehicle: vehicleRow ? vehicleRow.id : "" }, saved.sheet);
  const q = await quoteTrip(env, request, company.id, saved.sheet, trip, { places: readPlaces(body), airport: placed.airport, stops: stopsIn.stops, settings });
  return json({ ok: true, quote: quoteView(q, publicCompanyName(company)), pickup: placed.pickup, dropoff: placed.dropoff });
}
__name(postPublicQuote, "postPublicQuote");
async function getBookingSettings(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const s = await loadBookingSettings(env, user.companyId);
  const classes = await fleetClassSet(env, user.companyId);
  return json({ ok: true, settings: { airports: s.airports, capacities: s.capacities, flightRules: s.flightRules }, fleetClasses: [...classes], flightTracking: flightProvider(env).ready, base: await loadFleetBase(env, user.companyId), defaultRadiusMiles: DEFAULT_SERVICE_RADIUS_MILES, mapsOn: !!mapsBrowserKey(env), presets: ["ATL"], airportList: AIRPORT_CODES.map((code) => ({ code, name: AIRPORTS[code].fullName })) });
}
__name(getBookingSettings, "getBookingSettings");
async function putBookingSettings(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const current = await loadBookingSettings(env, user.companyId);
  let airports = current.airports;
  if (Array.isArray(body.preset)) {
    airports = presetConfig(body.preset);
  } else if (body.airports !== void 0) {
    const v = validateAirportConfig(body.airports);
    if (v.error) return fail(400, v.error);
    airports = v.config;
  }
  let capacities = current.capacities;
  if (body.capacities !== void 0) {
    const v = validateCapacities(body.capacities);
    if (v.error) return fail(400, v.error);
    capacities = v.capacities;
  }
  if (body.base !== void 0) {
    const b = readFleetBase(body.base);
    if (b.error) return fail(400, b.error);
    await env.DB.prepare("UPDATE companies SET base_address = ?, base_lat = ?, base_lng = ?, service_radius_miles = ? WHERE id = ?").bind(b.base ? b.base.address : null, b.base ? b.base.lat : null, b.base ? b.base.lng : null, b.base ? b.base.radiusMiles : null, user.companyId).run();
    if (body.airports === void 0 && body.preset === void 0 && body.capacities === void 0 && body.flightRules === void 0) return json({ ok: true, base: b.base });
  }
  let rules = current.flightRules;
  if (body.flightRules !== void 0) {
    const early = Number(body.flightRules && body.flightRules.earlyMinutes);
    if (body.flightRules && body.flightRules.earlyMinutes !== void 0 && !(early >= 15 && early <= 30)) return fail(400, "Early-arrival alerts must be from 15 to 30 minutes.");
    rules = flightRules(body.flightRules);
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO booking_settings (company_id, airports_json, capacities_json, flight_rules_json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET airports_json = excluded.airports_json, capacities_json = excluded.capacities_json, flight_rules_json = excluded.flight_rules_json, updated_at = excluded.updated_at`
  ).bind(user.companyId, JSON.stringify(airports), JSON.stringify(capacities), JSON.stringify(rules), now).run();
  return json({ ok: true, settings: { airports, capacities, flightRules: rules } });
}
__name(putBookingSettings, "putBookingSettings");
// Address suggestions for the booking page. Same-origin proxy so no Google key is in the page.
// Off unless PLACES_AUTOCOMPLETE=on and GOOGLE_MAPS_SERVER_KEY has the Places API (New) enabled.
async function postPublicPlaces(request, env, slug) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return fail(404, "Booking page not found.");
  const body = await readPublicJson(request);
  if (isResponse(body)) return body;
  const q = str(body.q, 120);
  if (!placesEnabled(env) || q.length < 3) return json({ ok: true, suggestions: [] });
  const ipHash = await sha256Hex("book-ip:" + clientIp(request));
  if (!await limitHit(env, "pip:" + ipHash, 200, 15 * 60 * 1e3) || !await limitHit(env, "pco:" + company.id, 3e3, 24 * 60 * 60 * 1e3)) return json({ ok: true, suggestions: [] });
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_MAPS_SERVER_KEY, "x-goog-fieldmask": "suggestions.placePrediction.text" },
      body: JSON.stringify({ input: q, includedRegionCodes: ["us"], sessionToken: str(body.session, 64) || void 0 })
    });
    if (!r.ok) return json({ ok: true, suggestions: [] });
    const data = await r.json();
    const suggestions = (data.suggestions || []).map((s) => s.placePrediction && s.placePrediction.text && s.placePrediction.text.text).filter(Boolean).slice(0, 5);
    return json({ ok: true, suggestions });
  } catch {
    return json({ ok: true, suggestions: [] });
  }
}
__name(postPublicPlaces, "postPublicPlaces");
// ---- Flight lookup for airport trips on the booking page (Nov 20, 2026) ----
// POST /api/public/book/<slug>/flight-status  { code, flight, date, time }
// Returns the terminal (one of our terminal ids), gate, and scheduled / estimated / actual landing.
// Provider behind flight-provider.js; key in the FLIGHT_API_KEY secret; our own FLIGHT_DAILY_CAP.
// Lookup down, over the cap, or nothing found: the airline table (airports-data.js) suggests the
// terminal, or the rider picks it. Never blocks a booking; provider errors are logged, not shown.
function flightCacheKey(code, ident, date) {
  return new Request("https://flight-cache.nudgedispatch.invalid/v1/" + encodeURIComponent(code + "|" + ident + "|" + date));
}
__name(flightCacheKey, "flightCacheKey");
async function cachedFlightLookup(code, ident, date) {
  if (!ident || typeof caches === "undefined") return null;
  try {
    const hit = await caches.default.match(flightCacheKey(code, ident, date));
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}
__name(cachedFlightLookup, "cachedFlightLookup");
function clockEastern(msValue) {
  return msValue ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(msValue)) : "";
}
__name(clockEastern, "clockEastern");
async function postPublicFlightStatus(request, env, slug) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return fail(404, "Booking page not found.");
  const body = await readPublicJson(request);
  if (isResponse(body)) return body;
  const settings = await loadBookingSettings(env, company.id);
  const code = str(body.code, 4).toUpperCase();
  const airport = (settings.airports.airports || []).find((a) => a.code === code);
  const known = airportByCode(code);
  if (!airport || !known) return json({ ok: true, found: false, reason: "airport" });
  const ident = normalizeFlight(body.flight);
  const date = validDate(str(body.date, 10)) ? str(body.date, 10) : todayIso();
  const time = validTime(str(body.time, 5)) ? str(body.time, 5) : "12:00";
  // Airline table first, so there is always an answer even when the lookup is off or fails.
  const airline = ident ? airlineOf(ident) : str(body.airline, 3).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const tableTerminals = terminalsForAirline(code, airline);
  const out = { ok: true, found: false, code, flight: ident, airline, terminal: "", terminalSource: "", airlineTerminals: tableTerminals, gate: "", landingAt: null, landingLabel: "", status: "" };
  if (tableTerminals.length === 1) { out.terminal = tableTerminals[0]; out.terminalSource = "airline_table"; }
  if (!ident) return json(out);
  const ipHash = await sha256Hex("book-ip:" + clientIp(request));
  if (!await limitHit(env, "fip:" + ipHash, 30, 15 * 60 * 1e3)) return json(out);
  let looked = await cachedFlightLookup(code, ident, date);
  if (!looked) {
    const provider = flightProvider(env);
    if (!provider.ready) {
      console.log(JSON.stringify({ level: "info", msg: "flight lookup", reason: "provider-off" }));
      return json(out);
    }
    if (!await underDailyCap(env, "flight", flightDailyCap(env))) {
      console.log(JSON.stringify({ level: "warn", msg: "flight lookup", reason: "daily-cap" }));
      return json(out);
    }
    const around = easternMs(date, time) || Date.now();
    const r = await fetchFlightSnapshot(env, ident, around);
    if (!r.ok) {
      console.log(JSON.stringify({ level: "warn", msg: "flight lookup", reason: "provider", problem: String(r.problem || "").slice(0, 80) }));
      return json(out);
    }
    const s = r.snapshot;
    looked = {
      terminal: terminalFromProvider(code, s.terminal),
      gate: String(s.gate || "").slice(0, 12),
      scheduledAt: s.scheduledArrival ?? null,
      estimatedAt: s.estimatedArrival ?? null,
      actualAt: s.actualArrival ?? null,
      landingAt: s.actualArrival ?? s.estimatedArrival ?? s.scheduledArrival ?? null,
      status: String(s.status || "").slice(0, 40),
      at: Date.now()
    };
    try {
      await caches.default.put(flightCacheKey(code, ident, date), new Response(JSON.stringify(looked), { headers: { "content-type": "application/json", "cache-control": "max-age=3600" } }));
    } catch {
    }
  }
  out.found = true;
  if (looked.terminal) { out.terminal = looked.terminal; out.terminalSource = "flight_lookup"; }
  out.gate = looked.gate || "";
  out.landingAt = looked.landingAt;
  out.landingLabel = clockEastern(looked.landingAt);
  out.scheduledLabel = clockEastern(looked.scheduledAt);
  out.landed = !!looked.actualAt;
  out.status = looked.status || "";
  return json(out);
}
__name(postPublicFlightStatus, "postPublicFlightStatus");
// Cron: watch flights for airport pickups and alert the assigned driver on any change.
async function runFlightChecks(env, nowMs, fetchImpl) {
  const provider = flightProvider(env);
  if (!provider.ready) return { checked: 0, alerts: 0, skipped: provider.problem };
  const now = nowMs || Date.now();
  const day = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + offset));
  const rows = await env.DB.prepare(
    `SELECT id, company_id, pickup_date, pickup_time, pickup, flight, status, approval, airport_json, flight_status_json, flight_checked_at
     FROM rides WHERE status = 'scheduled' AND flight != '' AND approval != 'declined' AND pickup_date IN (?, ?, ?) LIMIT 200`
  ).bind(day(-864e5), day(0), day(864e5)).all();
  let checked = 0, made = 0;
  for (const row of rows.results || []) {
    const airport = parseStoredAirport(row.airport_json);
    const arrival = airport ? airport.side === "pickup" : /\bairport\b|\b[A-Z]{3} airport/i.test(row.pickup || "");
    if (!arrival) continue;
    const pickupMs = easternMs(row.pickup_date, row.pickup_time);
    if (!shouldWatch(row, now, pickupMs)) continue;
    if (row.flight_checked_at && now - row.flight_checked_at < 4 * 60 * 1e3) continue;
    const ident = normalizeFlight(row.flight);
    if (!ident) continue;
    checked++;
    let result;
    try {
      result = await fetchFlightSnapshot(env, ident, pickupMs, fetchImpl);
    } catch {
      result = { ok: false };
    }
    await env.DB.prepare("UPDATE rides SET flight_checked_at = ? WHERE id = ? AND company_id = ?").bind(now, row.id, row.company_id).run();
    if (!result.ok) continue;
    let prev = null;
    try { prev = row.flight_status_json ? JSON.parse(row.flight_status_json) : null; } catch { prev = null; }
    const settings = await loadBookingSettings(env, row.company_id);
    const alerts = flightAlerts(prev, result.snapshot, settings.flightRules, { flight: ident, pickupTimeLabel: time12(row.pickup_time) });
    for (const a of alerts) {
      const res = await env.DB.prepare(
        "INSERT OR IGNORE INTO flight_alerts (id, company_id, ride_id, kind, alert_key, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), row.company_id, row.id, a.kind, a.key, a.message, now).run();
      if (res.meta && res.meta.changes) made++;
    }
    await env.DB.prepare("UPDATE rides SET flight_status_json = ? WHERE id = ? AND company_id = ?").bind(JSON.stringify(result.snapshot), row.id, row.company_id).run();
  }
  return { checked, alerts: made };
}
__name(runFlightChecks, "runFlightChecks");
function easternMs(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const n = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!m || !n) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +n[1], +n[2]);
  for (const offsetH of [4, 5]) {
    const at = guess + offsetH * 3600e3;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date(at));
    if (parts.replace(/^24/, "00") === time) return at;
  }
  return guess + 5 * 3600e3;
}
__name(easternMs, "easternMs");
async function previewRateSheet(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const saved = await loadRateSheet(env, user.companyId);
  if (!saved || !saved.sheet) return fail(404, "Save your rate sheet first.");
  const trip = readTrip(body, saved.sheet);
  const settings = await loadSettings(env, user.companyId);
  const stopsIn = readStops(body.stops);
  if (stopsIn.error) return fail(400, stopsIn.error);
  const q = await quoteTrip(env, request, user.companyId, saved.sheet, trip, { stops: saved.sheet.distance ? stopsIn.stops : [] });
  return json({ ok: true, quote: quoteView(q, settings && settings.business_name || user.companyName) });
}
__name(previewRateSheet, "previewRateSheet");
function parseQuoteJson(text) {
  if (!text) return null;
  try {
    const q = JSON.parse(text);
    return q && typeof q === "object" ? q : null;
  } catch {
    return null;
  }
}
__name(parseQuoteJson, "parseQuoteJson");


async function rateLimitAllow(env, bucket, windowMs, maxHits) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT hits, window_started FROM booking_limits WHERE bucket = ?").bind(bucket).first();
  if (!row || now - row.window_started > windowMs) {
    await env.DB.prepare(
      `INSERT INTO booking_limits (bucket, hits, window_started) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET hits = 1, window_started = excluded.window_started`
    ).bind(bucket, now).run();
    return true;
  }
  if (row.hits >= maxHits) return false;
  await env.DB.prepare("UPDATE booking_limits SET hits = hits + 1 WHERE bucket = ?").bind(bucket).run();
  return true;
}
__name(rateLimitAllow, "rateLimitAllow");
async function slugTakenBy(env, slug, ignoreSignupId) {
  const company = await env.DB.prepare("SELECT id FROM companies WHERE booking_slug = ?").bind(slug).first();
  if (company) return "company";
  const pending = await env.DB.prepare(
    "SELECT id FROM signups WHERE booking_slug = ? AND status = 'pending' AND expires_at > ?"
  ).bind(slug, Date.now()).first();
  if (pending && pending.id !== ignoreSignupId) return "pending";
  return "";
}
__name(slugTakenBy, "slugTakenBy");
async function suggestAvailableSlug(env, raw, ignoreSignupId) {
  const baseProblem = slugProblem(raw);
  const base = baseProblem ? slugBaseFromName(raw) : normalizeSlug(raw);
  for (let i = 0; i < 30; i++) {
    const slug = i === 0 ? base : i < 20 ? `${base}-${i + 1}` : `${base}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    if (slugProblem(slug)) continue;
    if (!await slugTakenBy(env, slug, ignoreSignupId)) return slug;
  }
  return "c-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}
__name(suggestAvailableSlug, "suggestAvailableSlug");
async function signupConfig(_request, env) {
  return json({ ok: true, ...signupPublicConfig(env) });
}
__name(signupConfig, "signupConfig");
async function signupSlugCheck(request, env) {
  const ipHash = await sha256Hex("signup-slug:" + clientIp(request));
  if (!await rateLimitAllow(env, "signup-slug:" + ipHash, SIGNUP_RATE_WINDOW_MS, SIGNUP_SLUG_MAX)) {
    return fail(429, "Too many attempts. Wait a few minutes and try again.");
  }
  const url = new URL(request.url);
  const rawSlug = url.searchParams.get("slug") || "";
  const rawName = url.searchParams.get("name") || "";
  const wanted = rawSlug.trim() ? normalizeSlug(rawSlug) : (rawName.trim() ? slugBaseFromName(str(rawName, 80)) : "");
  if (!wanted) return json({ ok: true, available: false, slug: "", suggestion: "", path: "", error: "Enter a company code." });
  const problem = slugProblem(wanted);
  if (problem) {
    const suggestion = rawName.trim() ? await suggestAvailableSlug(env, rawName) : "";
    return json({ ok: true, available: false, slug: wanted, suggestion, path: "", error: problem });
  }
  const taken = await slugTakenBy(env, wanted);
  if (!taken) {
    return json({ ok: true, available: true, slug: wanted, suggestion: wanted, path: "/book/" + wanted + "/", error: "" });
  }
  const suggestion = await suggestAvailableSlug(env, wanted);
  return json({ ok: true, available: false, slug: wanted, suggestion, path: "", error: "That company code is taken. Try another." });
}
__name(signupSlugCheck, "signupSlugCheck");
async function startSignup(request, env) {
  const ipHash = await sha256Hex("signup:" + clientIp(request));
  if (!await rateLimitAllow(env, "signup:" + ipHash, SIGNUP_RATE_WINDOW_MS, SIGNUP_POST_MAX)) {
    return fail(429, "Too many attempts. Wait a few minutes and try again.");
  }
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const fields = signupFieldProblems(body);
  if (fields) return fail(400, fields);
  if (signupWantsSms(body)) return fail(400, "Texting is available on Small fleet and up.");
  const email = normSignupEmail(body.email);
  const passwordIssue = passwordProblem(body.password, email);
  if (passwordIssue) return fail(400, passwordIssue);
  const turnstile = await verifyTurnstile(env, body.turnstileToken, clientIp(request));
  if (!turnstile.ok) return fail(400, turnstile.error);
  if (isListedPlatformAdmin(env, email)) return fail(409, "That email already has an account.");
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return fail(409, "That email already has an account. Sign in instead.");
  const slug = suggestedSlug(body.companyName, body.bookingSlug);
  if (await slugTakenBy(env, slug)) return fail(409, "That company code is taken. Try another.");
  const now = Date.now();
  await env.DB.prepare("UPDATE signups SET status = 'expired' WHERE email = ? AND status = 'pending'").bind(email).run();
  const hashed = await hashPassword(body.password);
  const signupId = crypto.randomUUID();
  const companyName = str(body.companyName, 80);
  const ownerName = str(body.ownerName, 80);
  const ownerPhone = normalizeSignupPhone(body.ownerPhone);
  const address = str(body.address, 200);
  const businessPhone = normalizeSignupPhone(body.businessPhone) || ownerPhone;
  const website = str(body.website, 120);
  const logo = typeof body.logoDataUrl === "string" ? body.logoDataUrl : "";
  await env.DB.prepare(
    `INSERT INTO signups (id, email, password_hash, password_salt, password_iterations, password_kdf, owner_name, owner_phone,
       company_name, booking_slug, plan, sms_addon, business_address, business_phone, business_website, logo_data_url, theme_color,
       terms_accepted_at, terms_version, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    signupId, email, hashed.hash, hashed.salt, hashed.iterations, hashed.kdf, ownerName, ownerPhone,
    companyName, slug, PUBLIC_BILLING_PLAN, address, businessPhone, website, logo, normalizeThemeHex(body.themeColor) || "",
    now, SIGNUP_TERMS_VERSION, now, now + SIGNUP_TTL_MS
  ).run();
  const problem = stripeKeyProblem(env);
  if (problem) {
    await env.DB.prepare("UPDATE signups SET status = 'abandoned' WHERE id = ?").bind(signupId).run();
    return fail(503, "Billing is not available right now. Email nudgedispatch@gmail.com.");
  }
  try {
    const L = LOOKUP[PUBLIC_BILLING_PLAN];
    // Check the Solo price exists before sending anyone to Stripe, so the trial can always convert.
    const prices = await pricesByLookup(env, [L.base]);
    if (!prices[L.base]) {
      await env.DB.prepare("UPDATE signups SET status = 'abandoned' WHERE id = ?").bind(signupId).run();
      return fail(409, "Stripe " + stripeModeWord(env) + " catalog is missing prices: " + L.base + ".");
    }
    const customer = await stripe(env, "POST", "/v1/customers", {
      email, name: ownerName || companyName, phone: ownerPhone || void 0,
      metadata: { app: "nudge-dispatch", purpose: "signup", signup_id: signupId, slug, company: companyName }
    }, "nudge-signup-cus-" + signupId);
    if (!customer || typeof customer.id !== "string") {
      await env.DB.prepare("UPDATE signups SET status = 'abandoned' WHERE id = ?").bind(signupId).run();
      return fail(502, "Stripe did not create the customer.");
    }
    const { params } = checkoutParams({
      origin: new URL(request.url).origin,
      customerId: customer.id,
      signupId,
      slug,
      pmc: env.STRIPE_CARD_PAYMENT_CONFIGURATION || "",
      excludedTypes: CARD_SETUP_EXCLUDED_TYPES
    });
    const session = await stripe(env, "POST", "/v1/checkout/sessions", params, "nudge-signup-" + signupId);
    if (!session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) {
      await env.DB.prepare("UPDATE signups SET status = 'abandoned' WHERE id = ?").bind(signupId).run();
      return fail(502, "Stripe did not return a card page.");
    }
    await env.DB.prepare("UPDATE signups SET stripe_checkout_session_id = ?, stripe_customer_id = ? WHERE id = ?").bind(session.id, customer.id, signupId).run();
    return json({ ok: true, url: session.url }, 201);
  } catch (error) {
    await env.DB.prepare("UPDATE signups SET status = 'abandoned' WHERE id = ?").bind(signupId).run();
    return stripeFail(env, error);
  }
}
__name(startSignup, "startSignup");
async function fulfillSignup(env, session, signup) {
  if (signup.status === "complete" && signup.company_id) return { companyId: signup.company_id, result: "signup already complete", already: true };
  const problem = signupSessionProblem(session, signup);
  if (problem) return { companyId: signup.company_id || null, result: "ignored: " + problem, error: problem };
  const now = Date.now();
  const customerId = typeof session.customer === "string" ? session.customer : session.customer && session.customer.id;
  if (!customerId) return { companyId: null, result: "ignored: missing customer", error: "Stripe did not save the card. Try again." };
  // Card saved in setup mode (not charged). Cards only.
  const si = session.setup_intent && typeof session.setup_intent === "object"
    ? session.setup_intent
    : typeof session.setup_intent === "string" ? await stripe(env, "GET", "/v1/setup_intents/" + encodeURIComponent(session.setup_intent), { expand: ["payment_method"] }) : null;
  const pmRef = si && si.payment_method;
  const pm = pmRef && typeof pmRef === "object" ? pmRef : typeof pmRef === "string" ? await stripe(env, "GET", "/v1/payment_methods/" + encodeURIComponent(pmRef)) : null;
  if (!pm || !isCardPaymentMethod(pm)) return { companyId: null, result: "ignored: not a card", error: NOT_A_CARD };
  await stripe(env, "POST", "/v1/customers/" + encodeURIComponent(customerId), { invoice_settings: { default_payment_method: pm.id } }, "nudge-signup-cusdefault-" + signup.id);
  const prices = await pricesByLookup(env, [LOOKUP[PUBLIC_BILLING_PLAN].base]);
  const priceId = prices[LOOKUP[PUBLIC_BILLING_PLAN].base];
  if (!priceId) return { companyId: null, result: "ignored: missing Solo price", error: "Billing is not available right now. Email nudgedispatch@gmail.com." };
  // Idempotent per signup: the return page and the webhook may both get here.
  const sub = await stripe(env, "POST", "/v1/subscriptions", trialSubscriptionParams({
    customerId, priceId, paymentMethodId: pm.id, signupId: signup.id, slug: signup.booking_slug, nowMs: now
  }), "nudge-signup-sub-" + signup.id);
  const subscriptionId = sub && sub.id || "";
  if (!subscriptionId) return { companyId: null, result: "ignored: missing subscription", error: "Stripe did not start the trial. Try again." };
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const kind = kindForPlan(PUBLIC_BILLING_PLAN);
  const liveFlag = stripeKeyMode(env) === "live" ? 1 : 0;
  const billingStatus = subStatusToBilling(sub && sub.status) || "active";
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO companies (id, name, created_at, kind, status, booking_slug, trial_status, trial_started_at, trial_ride_limit, trial_days, trial_billing, billing_plan,
           sms_addon_enabled, sms_addon_updated_at, setup_fee, signup_id, terms_accepted_at, terms_version,
           stripe_customer_id, stripe_subscription_id, stripe_livemode, billing_status, billing_updated_at, billing_past_due_at)
         VALUES (?, ?, ?, ?, 'active', ?, 'trial', ?, ?, ?, 'auto', ?, 0, ?, 'charge', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).bind(companyId, signup.company_name || "My car service", now, kind, signup.booking_slug, now, TRIAL_RIDE_LIMIT, TRIAL_TIME_LIMIT_DAYS, PUBLIC_BILLING_PLAN, now,
        signup.id, signup.terms_accepted_at || now, signup.terms_version || SIGNUP_TERMS_VERSION,
        customerId, subscriptionId, liveFlag, billingStatus, now),
      env.DB.prepare(
        `INSERT INTO users (id, company_id, email, password_hash, password_salt, password_iterations, password_kdf, created_at, password_changed_at, full_name, phone, terms_accepted_at, terms_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, companyId, signup.email, signup.password_hash, signup.password_salt, signup.password_iterations, signup.password_kdf || PASSWORD_KDF, now, now, signup.owner_name || "", signup.owner_phone || "", signup.terms_accepted_at || now, signup.terms_version || SIGNUP_TERMS_VERSION),
      env.DB.prepare("INSERT INTO memberships (company_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(companyId, userId, now),
      env.DB.prepare(
        `INSERT INTO invoice_settings (company_id, business_name, address, phone, email, website, logo_data_url, theme_color, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(companyId, signup.company_name || "", signup.business_address || "", signup.business_phone || signup.owner_phone || "", signup.email, signup.business_website || "", signup.logo_data_url || "", signup.theme_color || "", now)
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      const again = await env.DB.prepare("SELECT company_id, status FROM signups WHERE id = ?").bind(signup.id).first();
      if (again && again.status === "complete" && again.company_id) return { companyId: again.company_id, result: "signup already complete", already: true };
      const taken = await env.DB.prepare("SELECT id FROM companies WHERE booking_slug = ?").bind(signup.booking_slug).first();
      if (taken) return { companyId: null, result: "slug taken", error: "That company code is taken. Try another." };
      const userClash = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(signup.email).first();
      if (userClash) return { companyId: null, result: "email taken", error: "That email already has an account. Sign in instead." };
    }
    throw error;
  }
  await env.DB.prepare(
    "UPDATE signups SET status = 'complete', company_id = ?, stripe_customer_id = ?, stripe_subscription_id = ?, completed_at = ? WHERE id = ? AND status = 'pending'"
  ).bind(companyId, customerId, subscriptionId, now, signup.id).run();
  // Card summary (brand + last 4 only) for More > Payment method. Already the customer's default.
  const summary = cardSummary(pm);
  if (summary) {
    try { await saveCardSummary(env, companyId, summary); } catch { /* best-effort; trial already started */ }
  }
  return { companyId, userId, result: "signup fulfilled (15-ride trial)" };
}
__name(fulfillSignup, "fulfillSignup");
async function completeSignup(request, env) {
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return fail(400, "That payment link is not valid.");
  const problem = stripeKeyProblem(env);
  if (problem) return fail(503, "Billing is not available right now. Email nudgedispatch@gmail.com.");
  try {
    const session = await stripe(env, "GET", "/v1/checkout/sessions/" + encodeURIComponent(sessionId), { expand: ["setup_intent.payment_method"] });
    const signupId = session.metadata && session.metadata.signup_id || "";
    const signup = signupId
      ? await env.DB.prepare("SELECT * FROM signups WHERE id = ?").bind(signupId).first()
      : await env.DB.prepare("SELECT * FROM signups WHERE stripe_checkout_session_id = ?").bind(sessionId).first();
    if (!signup) return fail(404, "We couldn't find that signup. If you were charged, email nudgedispatch@gmail.com.");
    const fulfilled = await fulfillSignup(env, session, signup);
    if (fulfilled.error) return fail(409, fulfilled.error);
    const companyId = fulfilled.companyId;
    const user = await env.DB.prepare("SELECT id, email FROM users WHERE company_id = ?").bind(companyId).first();
    if (!user) return fail(500, "Your account was created, but we couldn't sign you in. Try signing in from the home page.");
    const sessionRow = await startSession(env, request, user.id);
    const company = await env.DB.prepare("SELECT name, booking_slug FROM companies WHERE id = ?").bind(companyId).first();
    const slug = company && company.booking_slug || signup.booking_slug || "";
    return json({
      ok: true,
      ...publicUser({ email: user.email, companyName: (company && company.name) || signup.company_name || "", csrf: sessionRow.csrf, role: "owner", accountKind: "individual" }),
      bookingSlug: slug,
      bookingPath: slug ? "/book/" + slug + "/" : "",
      qrPath: slug ? "/book/" + slug + "/qr/" : ""
    }, fulfilled.already ? 200 : 201, { "set-cookie": sessionRow.cookie });
  } catch (error) {
    return stripeFail(env, error);
  }
}
__name(completeSignup, "completeSignup");
async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (method === "GET" && path === "/api/health") return json({ ok: true, service: "nudge-app" });
  if (path === "/api/signup/config" && method === "GET") return signupConfig(request, env);
  if (path === "/api/signup/slug" && method === "GET") return signupSlugCheck(request, env);
  if (path === "/api/signup" && method === "POST") return startSignup(request, env);
  if (path === "/api/signup/complete" && method === "POST") return completeSignup(request, env);
  // Stripe calls this directly (no X-Nudge-Client header); it is authenticated by the Stripe-Signature HMAC instead.
  if (path === "/api/stripe/webhook" && method === "POST") {
    try { return await stripeWebhook(request, env); } catch (error) {
      console.log(JSON.stringify({ level: "error", msg: "stripe webhook", name: error instanceof Error ? error.name : "Error" }));
      return fail(500, "Webhook error.");
    }
  }
  // PayPal calls this directly; each delivery is checked with PayPal's verify-webhook-signature for the fleet's app.
  if (path === "/api/paypal/webhook" && method === "POST") {
    try { return await paypalWebhook(request, env); } catch (error) {
      console.log(JSON.stringify({ level: "error", msg: "paypal webhook", name: error instanceof Error ? error.name : "Error" }));
      return fail(500, "Webhook error.");
    }
  }
  if (method !== "GET" && method !== "HEAD" && !clientHeader(request)) return fail(403, "Blocked.");
  try {
    if (path === "/api/admin/invites" && method === "POST") return adminInvite(request, env);
    if (path === "/api/admin/resets" && method === "POST") return adminReset(request, env);
    if (path === "/api/admin/promote-platform-admin" && method === "POST") return adminPromote(request, env);
    if (path === "/api/admin/trials" && method === "GET") return adminTrials(request, env);
    const adminTrial = /^\/api\/admin\/companies\/([0-9a-f-]{36})\/trial$/.exec(path);
    if (adminTrial && method === "POST") return adminTrialChange(request, env, adminTrial[1]);
    if (path === "/api/platform/accounts" && method === "GET") return platformAccounts(request, env);
    if (path === "/api/platform/invites" && method === "POST") return platformInvite(request, env);
    if (path === "/api/platform/resets" && method === "POST") return platformReset(request, env);
    if (path === "/api/platform/audit" && method === "GET") return platformAudit(request, env);
    if (path === "/api/platform/trials" && method === "GET") return platformTrials(request, env);
    if (path === "/api/platform/cancellation-feedback" && method === "GET") return platformCancellationFeedback(request, env);
    const platformTrial = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/trial$/.exec(path);
    if (platformTrial && method === "POST") return platformTrialChange(request, env, platformTrial[1]);
    const platformCompany = /^\/api\/platform\/companies\/([0-9a-f-]{36})$/.exec(path);
    if (platformCompany && method === "PATCH") return platformUpdateCompany(request, env, platformCompany[1]);
    const platformSuspend = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/suspend$/.exec(path);
    if (platformSuspend && method === "POST") return platformStatus(request, env, platformSuspend[1], "suspended");
    const platformReactivate = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/reactivate$/.exec(path);
    if (platformReactivate && method === "POST") return platformStatus(request, env, platformReactivate[1], "active");
    const platformSms = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/sms$/.exec(path);
    if (platformSms && method === "POST") return platformSmsChange(request, env, platformSms[1]);
    const platformSub = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/subscription$/.exec(path);
    if (platformSub && method === "POST") return platformStartSubscription(request, env, platformSub[1]);
    const platformSetupFee = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/setup-fee$/.exec(path);
    if (platformSetupFee && method === "POST") return platformSetupFeeChange(request, env, platformSetupFee[1]);
    if (path === "/api/platform/billing" && method === "GET") return platformBillingStatus(request, env);
    if (path === "/api/platform/billing/sms-meter" && method === "POST") return platformSetupSmsMeter(request, env);
    if (path === "/api/invites/peek" && method === "POST") return peekInvite(request, env);
    if (path === "/api/sms/status" && method === "GET") return smsStatus(request, env);
    const rideText = /^\/api\/rides\/([0-9a-f-]{36})\/text$/.exec(path);
    if (rideText && method === "POST") return postRideText(request, env, rideText[1]);
    if (path === "/api/billing" && method === "GET") return ownerBilling(request, env);
    if (path === "/api/billing/portal" && method === "POST") return billingPortal(request, env);
    if (path === "/api/billing/payment-method" && method === "GET") return ownerPaymentMethod(request, env);
    if (path === "/api/billing/payment-method/session" && method === "POST") return ownerCardSession(request, env);
    if (path === "/api/billing/payment-method/confirm" && method === "POST") return ownerCardConfirm(request, env);
    if (path === "/api/billing/pay-invoice" && method === "POST") return ownerPayInvoice(request, env);
    if (path === "/api/invites/accept" && method === "POST") return acceptInvite(request, env);
    if (path === "/api/login" && method === "POST") return login(request, env);
    if (path === "/api/logout" && method === "POST") return logout(request, env);
    if (path === "/api/me" && method === "GET") return me(request, env);
    if (path === "/api/trial" && method === "GET") return getTrial(request, env);
    if (path === "/api/trial/cancel" && method === "POST") return cancelTrial(request, env);
    if (path === "/api/account/cancel" && method === "POST") return cancelTrial(request, env);
    if (path === "/api/trial/notice/dismiss" && method === "POST") return dismissTrialNotice(request, env);
    if (path === "/api/export/rides.csv" && method === "GET") return exportRides(request, env);
    if (path === "/api/export/clients.csv" && method === "GET") return exportClients(request, env);
    if (path === "/api/drivers" && method === "GET") return listDrivers(request, env);
    if (path === "/api/drivers" && method === "POST") return createDriver(request, env);
    const driverPass = /^\/api\/drivers\/([0-9a-f-]{36})\/passcode$/.exec(path);
    if (driverPass && method === "PUT") return setDriverPasscode(request, env, driverPass[1]);
    if (driverPass && method === "DELETE") return clearDriverPasscode(request, env, driverPass[1]);
    const driverOne = /^\/api\/drivers\/([0-9a-f-]{36})$/.exec(path);
    if (driverOne && method === "PATCH") return updateDriver(request, env, driverOne[1]);
    if (driverOne && method === "DELETE") return deleteDriver(request, env, driverOne[1]);
    if (path === "/api/driver-login" && method === "POST") return driverLogin(request, env);
    if (path === "/api/clients" && method === "GET") return listClients(request, env);
    if (path === "/api/clients" && method === "POST") return createClient(request, env);
    const clientMatch = /^\/api\/clients\/([0-9a-f-]{36})$/.exec(path);
    if (clientMatch && method === "GET") return getClient(request, env, clientMatch[1]);
    if (clientMatch && method === "PATCH") return updateClient(request, env, clientMatch[1]);
    if (clientMatch && method === "DELETE") return deleteClient(request, env, clientMatch[1]);
    const clientRestore = /^\/api\/clients\/([0-9a-f-]{36})\/restore$/.exec(path);
    if (clientRestore && method === "POST") return restoreClient(request, env, clientRestore[1]);
    if (path === "/api/push/config" && method === "GET") return pushConfig(request, env);
    if (path === "/api/push/subscribe" && method === "POST") return pushSubscribe(request, env);
    if (path === "/api/push/unsubscribe" && method === "POST") return pushUnsubscribe(request, env);
    if (path === "/api/push/test" && method === "POST") return pushTest(request, env);
    if (path === "/api/rides" && method === "GET") return listRides(request, env);
    if (path === "/api/rides" && method === "POST") return createRide(request, env);
    const rideMatch = /^\/api\/rides\/([0-9a-f-]{36})$/.exec(path);
    if (rideMatch && method === "GET") return getRide(request, env, rideMatch[1]);
    if (rideMatch && method === "PATCH") return updateRide(request, env, rideMatch[1]);
    const progressMatch = /^\/api\/rides\/([0-9a-f-]{36})\/progress$/.exec(path);
    if (progressMatch && method === "POST") return postProgress(request, env, progressMatch[1]);
    const completeMatch = /^\/api\/rides\/([0-9a-f-]{36})\/complete$/.exec(path);
    if (completeMatch && method === "POST") return postProgress(request, env, completeMatch[1], "Completed");
    const cancelMatch = /^\/api\/rides\/([0-9a-f-]{36})\/cancel$/.exec(path);
    if (cancelMatch && method === "POST") return setRideStatus(request, env, cancelMatch[1], "cancelled");
    const invoiceMatch = /^\/api\/rides\/([0-9a-f-]{36})\/invoice$/.exec(path);
    if (invoiceMatch && method === "POST") return createInvoice(request, env, invoiceMatch[1]);
    if (path === "/api/paypal/credentials" && method === "GET") return getPayPalCredentials(request, env);
    if (path === "/api/paypal/credentials" && method === "PUT") return putPayPalCredentials(request, env);
    if (path === "/api/paypal/credentials" && method === "DELETE") return deletePayPalCredentials(request, env);
    if (path === "/api/paypal/credentials/test" && method === "POST") return testPayPalCredentials(request, env);
    const invoiceGet = /^\/api\/invoices\/([0-9a-f-]{36})$/.exec(path);
    if (invoiceGet && method === "GET") return getInvoice(request, env, invoiceGet[1]);
    const invoicePayPal = /^\/api\/invoices\/([0-9a-f-]{36})\/paypal$/.exec(path);
    if (invoicePayPal && method === "POST") return sendPayPalInvoice(request, env, invoicePayPal[1]);
    const invoicePayPalSync = /^\/api\/invoices\/([0-9a-f-]{36})\/paypal\/sync$/.exec(path);
    if (invoicePayPalSync && method === "POST") return syncPayPalInvoice(request, env, invoicePayPalSync[1]);
    if (path === "/api/location" && method === "GET") return getLocation(request, env);
    if (path === "/api/location/sharing" && method === "POST") return setSharing(request, env);
    if (path === "/api/location" && method === "POST") return postLocation(request, env);
    if (path === "/api/location/links" && method === "POST") return createLocationLink(request, env);
    const revokeLink = /^\/api\/location\/links\/([0-9a-f-]{36})\/revoke$/.exec(path);
    if (revokeLink && method === "POST") return revokeLocationLink(request, env, revokeLink[1]);
    const viewLink = /^\/api\/location\/view\/([A-Za-z0-9_-]{20,})$/.exec(path);
    if (viewLink && method === "GET") return viewLocation(env, viewLink[1]);
    if (path === "/api/brand" && method === "GET") return getBrand(request, env);
    if (path === "/api/brand" && method === "PUT") return putBrand(request, env);
    if (path === "/api/brand" && method === "DELETE") return deleteBrand(request, env);
    if (path === "/api/brand/check" && method === "POST") return checkBrand(request, env);
    if (path === "/api/brand/suggest" && method === "POST") return suggestBrandApi(request, env);
    const platformBrandSuggest = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/brand\/suggest$/.exec(path);
    if (platformBrandSuggest && method === "POST") return suggestBrandApi(request, env, platformBrandSuggest[1]);
    if (path === "/api/brand/preview.css" && method === "GET") return brandPreviewCss(request, env);
    const platformBrand = /^\/api\/platform\/companies\/([0-9a-f-]{36})\/brand$/.exec(path);
    if (platformBrand && method === "GET") return getBrand(request, env, platformBrand[1]);
    if (platformBrand && method === "PUT") return putBrand(request, env, platformBrand[1]);
    if (platformBrand && method === "DELETE") return deleteBrand(request, env, platformBrand[1]);
    if (path === "/api/settings" && method === "GET") return getSettings(request, env);
    if (path === "/api/settings" && method === "PUT") return putSettings(request, env);
    if (path === "/api/rate-sheet" && method === "GET") return getRateSheet(request, env);
    if (path === "/api/rate-sheet" && method === "PUT") return putRateSheet(request, env);
    if (path === "/api/rate-sheet/preview" && method === "POST") return previewRateSheet(request, env);
    if (path === "/api/booking-settings" && method === "GET") return getBookingSettings(request, env);
    if (path === "/api/booking-settings" && method === "PUT") return putBookingSettings(request, env);
    const publicPlaces = /^\/api\/public\/book\/([^/]+)\/places$/.exec(path);
    if (publicPlaces && method === "POST") return postPublicPlaces(request, env, decodeURIComponent(publicPlaces[1]));
    const publicFlight = /^\/api\/public\/book\/([^/]+)\/flight-status$/.exec(path);
    if (publicFlight && method === "POST") return postPublicFlightStatus(request, env, decodeURIComponent(publicFlight[1]));
    const publicQuote = /^\/api\/public\/book\/([^/]+)\/quote$/.exec(path);
    if (publicQuote && method === "POST") return postPublicQuote(request, env, decodeURIComponent(publicQuote[1]));
    const publicBook = /^\/api\/public\/book\/([^/]+)$/.exec(path);
    if (publicBook && method === "GET") return getPublicBook(request, env, decodeURIComponent(publicBook[1]));
    if (publicBook && method === "POST") return postPublicBook(request, env, decodeURIComponent(publicBook[1]));
    const approveMatch = /^\/api\/rides\/([0-9a-f-]{36})\/approve$/.exec(path);
    if (approveMatch && method === "POST") return decideBooking(request, env, approveMatch[1], "approve");
    const declineMatch = /^\/api\/rides\/([0-9a-f-]{36})\/decline$/.exec(path);
    if (declineMatch && method === "POST") return decideBooking(request, env, declineMatch[1], "decline");
    if (path === "/api/schedules" && method === "GET") return listSchedules(request, env);
    if (path === "/api/schedules" && method === "POST") return createSchedule(request, env);
    if (path === "/api/schedules/upcoming" && method === "GET") return upcomingSchedules(request, env);
    const scheduleOne = /^\/api\/schedules\/([0-9a-f-]{36})$/.exec(path);
    if (scheduleOne && method === "GET") return getScheduleOne(request, env, scheduleOne[1]);
    if (scheduleOne && method === "PATCH") return updateSchedule(request, env, scheduleOne[1]);
    if (scheduleOne && method === "DELETE") return deleteSchedule(request, env, scheduleOne[1]);
    const occurrenceOne = /^\/api\/schedules\/([0-9a-f-]{36})\/occurrences\/(\d{4}-\d{2}-\d{2})(?:\/(confirm|skip))?$/.exec(path);
    if (occurrenceOne && occurrenceOne[3] === "confirm" && method === "POST") return confirmOccurrence(request, env, occurrenceOne[1], occurrenceOne[2]);
    if (occurrenceOne && occurrenceOne[3] === "skip" && method === "POST") return skipOccurrence(request, env, occurrenceOne[1], occurrenceOne[2]);
    if (occurrenceOne && !occurrenceOne[3] && method === "DELETE") return unskipOccurrence(request, env, occurrenceOne[1], occurrenceOne[2]);
    return fail(404, "Not found.");
  } catch (error) {
    console.log(JSON.stringify({ level: "error", msg: "api", path, name: error instanceof Error ? error.name : "Error" }));
    return fail(500, "Something went wrong.");
  }
}
__name(handleApi, "handleApi");
async function adminInvite(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const email = normEmail(body.email);
  const companyName = str(body.companyName, 80);
  if (!email) return fail(400, "Enter a valid email.");
  if (!companyName) return fail(400, "Enter the company name.");
  const accountKind = body.accountKind === void 0 || body.accountKind === "individual" ? "individual" : body.accountKind === "fleet" ? "fleet" : "";
  if (!accountKind) return fail(400, "Account type must be individual or fleet.");
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return fail(409, "That email already has an account.");
  const invite = await createInvite(env, email, "invite", companyName, null, { accountKind });
  return json({ ok: true, email, expiresAt: invite.expiresAt, inviteToken: invite.token }, 201);
}
__name(adminInvite, "adminInvite");
async function adminPromote(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const email = normEmail(body.email);
  if (!isListedPlatformAdmin(env, email)) return fail(400, "That email cannot be promoted.");
  const report = await promotePlatformAdmin(env, email);
  if (!report.found || !report.passwordUnchanged || report.sessionsAfter !== report.sessionsBefore) {
    return fail(404, "No account with that email.");
  }
  const actor = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (actor) {
    await writeAudit(env, actor.id, "account.promote", "user", actor.id, {
      companyName: report.companyName || "",
      clients: report.clients,
      rides: report.rides,
      invoices: report.invoices,
      companyRemoved: report.companyRemoved
    });
  }
  return json({ ok: true, ...report });
}
__name(adminPromote, "adminPromote");
async function adminReset(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const email = normEmail(body.email);
  if (!email) return fail(400, "Enter a valid email.");
  const user = await env.DB.prepare("SELECT id, company_id FROM users WHERE email = ?").bind(email).first();
  if (!user) return fail(404, "No account with that email.");
  const company = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(user.company_id).first();
  const invite = await createInvite(env, email, "reset", company?.name || "", user.id);
  return json({ ok: true, email, expiresAt: invite.expiresAt, inviteToken: invite.token }, 201);
}
__name(adminReset, "adminReset");
async function adminTrialRow(env, id) {
  return env.DB.prepare(
    `SELECT ${TRIAL_COLS}, c.name, c.status, c.booking_slug, c.billing_last_paid_at,
            (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.company_id = c.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email,
            (SELECT COUNT(*) FROM rides r WHERE r.company_id = c.id AND r.status = 'scheduled' AND r.approval IN ('none', 'approved')) AS scheduled,
            (SELECT COUNT(*) FROM rides r WHERE r.company_id = c.id AND r.approval = 'requested') AS requested
     FROM companies c WHERE c.id = ?`
  ).bind(id).first();
}
__name(adminTrialRow, "adminTrialRow");
async function adminTrialView(env, row) {
  const t = await companyTrial(env, row.id, row);
  return {
    id: row.id,
    name: row.name,
    accountStatus: row.status,
    ownerEmail: row.owner_email || "",
    bookingSlug: row.booking_slug || "",
    scheduledRides: row.scheduled || 0,
    waitingRequests: row.requested || 0,
    trial: trialJson(t)
  };
}
__name(adminTrialView, "adminTrialView");
async function adminTrials(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return trialsList(env);
}
__name(adminTrials, "adminTrials");
async function trialsList(env) {
  const ids = await env.DB.prepare("SELECT id FROM companies ORDER BY created_at").all();
  const companies = [];
  for (const { id } of ids.results || []) {
    const row = await adminTrialRow(env, id);
    if (row) companies.push(await adminTrialView(env, row));
  }
  const onTrial = companies.filter((c) => c.accountStatus === "active" && (c.trial.state === "normal" || c.trial.state === "warning")).length;
  return json({ ok: true, trials: { onTrial, rideLimit: TRIAL_RIDE_LIMIT }, companies });
}
__name(trialsList, "trialsList");
async function adminTrialChange(request, env, id) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return trialChange(request, env, id);
}
__name(adminTrialChange, "adminTrialChange");
// Same trial controls for Jesse's signed-in platform admin screen (Accounts).
async function platformTrials(request, env) {
  const user = await platformUser(request, env, false);
  if (isResponse(user)) return user;
  return trialsList(env);
}
__name(platformTrials, "platformTrials");
async function platformTrialChange(request, env, id) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  return trialChange(request, env, id, user.id);
}
__name(platformTrialChange, "platformTrialChange");
async function trialChange(request, env, id, actorId = "admin-token") {
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const row = await adminTrialRow(env, id);
  if (!row) return fail(404, "No company with that id.");
  if (body.moveBack === true) return moveCompanyBackToTrial(env, row, actorId);
  const change = applyTrialChange(row, body, Date.now());
  if (change.error) return fail(400, change.error);
  const n = change.next;
  await env.DB.prepare(
    `UPDATE companies SET trial_status = ?, trial_ride_limit = ?, trial_days = ?, trial_started_at = ?, trial_ended_at = ?, trial_end_reason = ? WHERE id = ?`
  ).bind(n.trial_status, n.trial_ride_limit, n.trial_days, n.trial_started_at, n.trial_ended_at, n.trial_end_reason, id).run();
  const fresh = await adminTrialRow(env, id);
  return json({ ok: true, company: await adminTrialView(env, fresh) });
}
__name(trialChange, "trialChange");
// Platform admin "Move back to free trial" (rules in trial.js moveBackToTrial). Never calls Stripe.
async function moveCompanyBackToTrial(env, row, actorId) {
  const completed = await completedRides(env, row.id);
  const result = moveBackToTrial(row, completed, Date.now());
  if (result.error) return fail(409, result.error);
  const n = result.next;
  await env.DB.prepare(
    `UPDATE companies SET trial_status = ?, trial_ended_at = ?, trial_end_reason = ?, trial_started_at = ?, trial_ride_limit = ?, trial_days = ?,
       trial_billing = ?, trial_converted_at = ?, trial_convert_claimed_at = ?, trial_convert_error = ?, trial_canceled_at = ?,
       trial_notice_dismissed_at = ?, stripe_subscription_id = ? WHERE id = ?`
  ).bind(n.trial_status, n.trial_ended_at, n.trial_end_reason, n.trial_started_at, n.trial_ride_limit, n.trial_days, n.trial_billing,
    n.trial_converted_at, n.trial_convert_claimed_at, n.trial_convert_error, n.trial_canceled_at, n.trial_notice_dismissed_at,
    n.stripe_subscription_id, row.id).run();
  await writeAudit(env, actorId, "trial.moved_back", "company", row.id, {
    fresh: result.fresh, ridesCompleted: completed, rideLimit: n.trial_ride_limit, autoConvert: n.trial_billing === "auto",
    detachedSubscription: result.detachedSubscription ? row.stripe_subscription_id : null
  });
  const fresh = await adminTrialRow(env, row.id);
  return json({ ok: true, movedBack: { fresh: result.fresh, autoConvert: n.trial_billing === "auto" }, company: await adminTrialView(env, fresh) });
}
__name(moveCompanyBackToTrial, "moveCompanyBackToTrial");
function csvCell(value) {
  let text = value === null || value === void 0 ? "" : String(value);
  // Keep spreadsheet apps from treating a cell as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
__name(csvCell, "csvCell");
function csvResponse(filename, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
__name(csvResponse, "csvResponse");
async function exportRides(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const rows = await env.DB.prepare(`${RIDE_SELECT} WHERE r.company_id = ? ORDER BY r.pickup_date, r.pickup_time`).bind(user.companyId).all();
  return csvResponse("rides-" + todayIso() + ".csv",
    ["Date", "Time", "Client", "Client phone", "Client email", "Pickup", "Drop-off", "Passengers", "Flight", "Status", "Fare", "Estimate", "Payment", "Trip type", "Vehicle", "Hours", "Notes", "Source", "Stops"],
    (rows.results || []).map((r) => [r.pickup_date, r.pickup_time, r.client_name, r.client_phone, r.client_email, r.pickup, r.dropoff, r.passengers, r.flight,
      displayRideStatus(r), (r.fare_cents / 100).toFixed(2), r.quote_cents === null || r.quote_cents === void 0 ? "" : (r.quote_cents / 100).toFixed(2),
      r.payment, TRIP_LABELS[r.trip_type] || "", r.vehicle_name || "", r.hours ?? "", r.notes, r.source || "", stopsCell(parseStoredStops(r.stops_json))]));
}
__name(exportRides, "exportRides");
async function exportClients(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const rows = await env.DB.prepare("SELECT name, phone, email, notes FROM clients WHERE company_id = ? ORDER BY name COLLATE NOCASE").bind(user.companyId).all();
  return csvResponse("clients-" + todayIso() + ".csv", ["Name", "Phone", "Email", "Notes"], (rows.results || []).map((r) => [r.name, r.phone, r.email, r.notes]));
}
__name(exportClients, "exportClients");
function planKind(plan) {
  if (plan === "solo" || plan === "individual") return "individual";
  if (plan === "fleet" || plan === "small") return "fleet";
  return "";
}
__name(planKind, "planKind");
function planLabel(kind) {
  return kind === "fleet" ? "fleet" : "solo";
}
__name(planLabel, "planLabel");
async function writeAudit(env, actorId, action, targetType, targetId, detail) {
  await env.DB.prepare(
    "INSERT INTO admin_audit (id, actor_user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), actorId, action, targetType, targetId, JSON.stringify(detail), Date.now()).run();
}
__name(writeAudit, "writeAudit");
async function platformUser(request, env, mutate) {
  const user = await requireUser(request, env);
  if (isResponse(user) || !user.platformAdmin) return fail(404, "Not found.");
  if (mutate) {
    const csrf = await requireCsrf(request, user);
    if (csrf) return csrf;
  }
  return user;
}
__name(platformUser, "platformUser");
async function platformAccounts(request, env) {
  const user = await platformUser(request, env, false);
  if (isResponse(user)) return user;
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.kind, c.status, c.created_at, c.billing_plan, c.sms_addon_enabled, c.stripe_customer_id, c.stripe_subscription_id, c.stripe_livemode, c.billing_status, c.billing_paid_through, c.billing_last_paid_at, c.billing_past_due_at, c.billing_event_at, c.billing_updated_at, c.setup_fee, c.pm_brand, c.pm_last4, c.pm_exp_month, c.pm_exp_year,
            (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.company_id = c.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email,
            (SELECT COUNT(*) FROM memberships m LEFT JOIN drivers d ON d.user_id = m.user_id AND d.company_id = m.company_id WHERE m.company_id = c.id AND m.role = 'driver' AND d.deleted_at IS NULL) AS driver_count,
            (SELECT MAX(u.last_sign_in_at) FROM users u WHERE u.company_id = c.id) AS last_sign_in_at,
            (SELECT COUNT(*) FROM sms_messages s WHERE s.company_id = c.id AND s.status = 'sent' AND s.created_at >= ?) AS texts_month
     FROM companies c
     ORDER BY c.created_at DESC`
  ).bind(monthStartMs()).all();
  const accounts = (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    plan: planLabel(row.kind),
    status: row.status === "suspended" ? "suspended" : "active",
    createdAt: row.created_at,
    ownerEmail: row.owner_email || "",
    driverCount: row.driver_count || 0,
    lastSignInAt: row.last_sign_in_at,
    billing: { ...billingJson(row, row.driver_count || 0), textsThisMonth: row.texts_month || 0, textingReady: !textingProblem(env), access: (({ state, locked, until, reason }) => ({ state, locked, until, reason }))(billingAccess(row, Date.now())), pastDueAt: row.billing_past_due_at || null }
  }));
  await writeAudit(env, user.userId, "accounts.list", "platform", "", { count: accounts.length });
  const connection = billingConnection(env);
  return json({ ok: true, accounts, stripeTestMode: connection.testMode, stripeMode: connection.mode });
}
__name(platformAccounts, "platformAccounts");
async function platformInvite(request, env) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const email = normEmail(body.email);
  const companyName = str(body.companyName, 80);
  const accountKind = planKind(body.plan);
  const billingPlan = normPlan(body.plan);
  // Texting is no longer chosen at signup; it can be added once the customer is paying.
  const smsAddon = false;
  if (!email) return fail(400, "Enter a valid email.");
  if (!companyName) return fail(400, "Enter the company name.");
  if (!accountKind || !billingPlan) return fail(400, "Plan must be solo, small, or fleet.");
  if (smsAddon && !smsAllowed(billingPlan)) return fail(400, "The texting add-on is for Small fleet and Fleet plans only.");
  if (isListedPlatformAdmin(env, email)) return fail(409, "That email already has an account.");
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return fail(409, "That email already has an account.");
  const invite = await createInvite(env, email, "invite", companyName, null, { accountKind, billingPlan, smsAddon });
  await writeAudit(env, user.userId, "invite.create", "invite", email, { email, companyName, plan: billingPlan, sms: smsAddon ? "on" : "off", expiresAt: invite.expiresAt });
  return json({ ok: true, email, companyName, plan: planLabel(accountKind), billingPlan, smsAddon, expiresAt: invite.expiresAt, inviteToken: invite.token }, 201);
}
__name(platformInvite, "platformInvite");
async function platformReset(request, env) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const email = normEmail(body.email);
  if (!email) return fail(400, "Enter a valid email.");
  const target = await env.DB.prepare("SELECT id, company_id FROM users WHERE email = ?").bind(email).first();
  if (!target) return fail(404, "No account with that email.");
  const company = target.company_id ? await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(target.company_id).first() : null;
  const invite = await createInvite(env, email, "reset", company?.name || "", target.id);
  await writeAudit(env, user.userId, "password.reset", "user", target.id, { email, expiresAt: invite.expiresAt });
  return json({ ok: true, email, expiresAt: invite.expiresAt, inviteToken: invite.token }, 201);
}
__name(platformReset, "platformReset");
async function platformUpdateCompany(request, env, id) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const name = str(body.name, 80);
  const accountKind = planKind(body.plan);
  const billingPlan = normPlan(body.plan);
  if (!name) return fail(400, "Enter the company name.");
  if (!accountKind || !billingPlan) return fail(400, "Plan must be solo, small, or fleet.");
  const existing = await env.DB.prepare("SELECT id, kind, billing_plan, sms_addon_enabled, stripe_subscription_id FROM companies WHERE id = ?").bind(id).first();
  if (!existing) return fail(404, "No company with that id.");
  if (smsOn(existing) && !smsAllowed(billingPlan)) return fail(409, "Turn texting off first. The texting add-on is for Small fleet and Fleet plans only.");
  if (existing.stripe_subscription_id && planOf(existing) !== billingPlan) return fail(409, "This company has a Stripe " + stripeModeWord(env) + " subscription. Plan changes on a subscription are not built yet; cancel it in the Stripe " + stripeModeWord(env) + " dashboard first.");
  await env.DB.prepare("UPDATE companies SET name = ?, kind = ?, billing_plan = ? WHERE id = ?").bind(name, accountKind, billingPlan, id).run();
  await writeAudit(env, user.userId, "company.update", "company", id, { name, plan: billingPlan });
  return json({ ok: true, id, name, plan: planLabel(accountKind), billingPlan });
}
__name(platformUpdateCompany, "platformUpdateCompany");
async function platformStatus(request, env, id, status) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const existing = await env.DB.prepare("SELECT id, name FROM companies WHERE id = ?").bind(id).first();
  if (!existing) return fail(404, "No company with that id.");
  await env.DB.prepare("UPDATE companies SET status = ? WHERE id = ?").bind(status, id).run();
  if (status === "suspended") {
    await env.DB.prepare(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)"
    ).bind(id).run();
  }
  await writeAudit(env, user.userId, status === "suspended" ? "company.suspend" : "company.reactivate", "company", id, { name: existing.name, status });
  return json({ ok: true, id, status });
}
__name(platformStatus, "platformStatus");
async function platformAudit(request, env) {
  const user = await platformUser(request, env, false);
  if (isResponse(user)) return user;
  const rows = await env.DB.prepare(
    `SELECT id, action, target_type, target_id, detail, created_at
     FROM admin_audit ORDER BY created_at DESC LIMIT 50`
  ).all();
  return json({
    ok: true,
    audit: (rows.results || []).map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      detail: row.detail,
      createdAt: row.created_at
    }))
  });
}
__name(platformAudit, "platformAudit");

// ---- Plan billing + SMS texting add-on ----
// Stripe mode comes from STRIPE_SECRET_KEY. A live key runs only when STRIPE_MODE is live.
// These endpoints store the texting choice and keep the Stripe subscription in step with it.
async function peekInvite(request, env) {
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return fail(400, "This setup link is invalid or already used.");
  const row = await env.DB.prepare(
    `SELECT purpose, account_kind, join_company_id, join_role, billing_plan, sms_addon FROM invites
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
  ).bind(await sha256Hex(token), Date.now()).first();
  if (!row) return fail(400, "This setup link is invalid or already used.");
  if (row.purpose !== "invite" || (row.join_company_id && row.join_role === "driver")) return json({ ok: true, kind: row.purpose === "reset" ? "reset" : "driver" });
  const plan = normPlan(row.billing_plan) || (row.account_kind === "fleet" ? "small" : "solo");
  return json({ ok: true, kind: "owner", plan, planLabel: PLAN_LABELS[plan], smsAllowed: smsAllowed(plan), smsAddon: false, smsLater: SMS_NOT_PAYING_NOTE, smsPriceText: SMS_PRICE_TEXT, smsNote: SMS_COMING_SOON });
}
__name(peekInvite, "peekInvite");
async function driverCountFor(env, companyId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM memberships m
     LEFT JOIN drivers d ON d.user_id = m.user_id AND d.company_id = m.company_id
     WHERE m.company_id = ? AND m.role = 'driver' AND d.deleted_at IS NULL`
  ).bind(companyId).first();
  return (row && row.n) || 0;
}
__name(driverCountFor, "driverCountFor");
async function billingRow(env, id) {
  return env.DB.prepare(
    `SELECT id, name, kind, billing_plan, sms_addon_enabled, sms_setup_billed_at, stripe_customer_id, stripe_subscription_id, stripe_livemode, billing_status, billing_paid_through, billing_last_paid_at, setup_fee, pm_brand, pm_last4, pm_exp_month, pm_exp_year FROM companies WHERE id = ?`
  ).bind(id).first();
}
__name(billingRow, "billingRow");
function stripeModeWord(env) {
  return stripeKeyMode(env) === "live" ? "live" : "test";
}
__name(stripeModeWord, "stripeModeWord");
function stripeFail(env, error) {
  if (error instanceof StripeError) return fail(error.status === 503 ? 503 : 502, "Stripe (" + stripeModeWord(env) + " mode): " + error.message);
  throw error;
}
__name(stripeFail, "stripeFail");
async function ownerBilling(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const row = await billingRow(env, user.companyId);
  if (!row) return fail(404, "Not found.");
  const b = billingJson(row, await driverCountFor(env, row.id));
  return json({ ok: true, billing: { plan: b.plan, planLabel: b.planLabel, smsAddon: b.smsAddon, smsAllowed: b.smsAllowed, smsPriceText: b.smsPriceText, smsNote: b.smsNote, monthlyEstimate: b.monthlyEstimate, canManageBilling: !!row.stripe_customer_id, livemode: b.livemode } });
}
__name(ownerBilling, "ownerBilling");
// Stripe customer portal: card update + invoice history only. Owner only; needs the company's Stripe customer.
async function billingPortal(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const row = await env.DB.prepare("SELECT id, stripe_customer_id FROM companies WHERE id = ?").bind(user.companyId).first();
  if (!row || !row.stripe_customer_id) return fail(404, "There is no billing account for this company yet.");
  const problem = stripeKeyProblem(env);
  if (problem) return fail(503, "Billing is not available right now. Email nudgedispatch@gmail.com.");
  const origin = new URL(request.url).origin;
  try {
    const session = await stripe(env, "POST", "/v1/billing_portal/sessions", {
      customer: row.stripe_customer_id,
      return_url: origin + "/#/settings",
      configuration: env.STRIPE_PORTAL_CONFIGURATION || undefined
    });
    if (!session.url || !/^https:\/\/billing\.stripe\.com\//.test(session.url)) return fail(502, "Stripe did not return a billing page.");
    await writeAudit(env, user.userId, "billing.portal", "company", row.id, { mode: stripeModeWord(env) });
    return json({ ok: true, url: session.url });
  } catch (error) {
    if (error instanceof StripeError) return fail(502, "Could not open the billing page. Try again, or email nudgedispatch@gmail.com.");
    throw error;
  }
}
__name(billingPortal, "billingPortal");
// ---- Client payment method (Jesse, Nov 16, 2026). Card details are entered on Stripe-hosted pages and
// stored only by Stripe. D1 keeps brand, last 4, and expiry for display. Owner only, company-scoped. ----
// Fallback when STRIPE_CARD_PAYMENT_CONFIGURATION is unset: hide what can be hidden. Link can't be excluded this
// way, so the confirm step also refuses any non-card payment method. Set the card-only config in every environment.
const CARD_SETUP_EXCLUDED_TYPES = ["klarna", "cashapp", "amazon_pay", "affirm", "afterpay_clearpay", "us_bank_account", "zip", "alipay", "paypal", "revolut_pay", "crypto"];
const NOT_A_CARD = "Only a credit or debit card can be saved. Tap Add card and enter a card.";
const BILLING_NOT_STARTED = "Billing not started yet. Your Nudge Dispatch contact starts it when your plan begins.";
function openInvoiceJson(inv) {
  if (!inv || typeof inv !== "object" || inv.status !== "open") return null;
  const url = typeof inv.hosted_invoice_url === "string" && /^https:\/\/invoice\.stripe\.com\//.test(inv.hosted_invoice_url) ? inv.hosted_invoice_url : "";
  return { id: inv.id, amountDue: Number(inv.amount_due) || 0, currency: inv.currency || "usd", url };
}
__name(openInvoiceJson, "openInvoiceJson");
async function saveCardSummary(env, companyId, summary) {
  await env.DB.prepare("UPDATE companies SET pm_brand = ?, pm_last4 = ?, pm_exp_month = ?, pm_exp_year = ?, pm_updated_at = ? WHERE id = ?")
    .bind(summary ? summary.brand : null, summary ? summary.last4 : null, summary ? summary.expMonth : null, summary ? summary.expYear : null, Date.now(), companyId).run();
}
__name(saveCardSummary, "saveCardSummary");
// Reads the default card and the open invoice from Stripe, refreshes the D1 summary.
async function syncCompanyCard(env, row) {
  const customer = await stripe(env, "GET", "/v1/customers/" + encodeURIComponent(row.stripe_customer_id), { expand: ["invoice_settings.default_payment_method"] });
  let pm = customer && !customer.deleted && customer.invoice_settings ? customer.invoice_settings.default_payment_method : null;
  let sub = null;
  if (row.stripe_subscription_id) {
    sub = await stripe(env, "GET", "/v1/subscriptions/" + encodeURIComponent(row.stripe_subscription_id), { expand: ["default_payment_method", "latest_invoice"] });
    if ((!pm || typeof pm !== "object") && sub && sub.default_payment_method && typeof sub.default_payment_method === "object") pm = sub.default_payment_method;
  }
  const summary = cardSummary(pm && typeof pm === "object" ? pm : null);
  await saveCardSummary(env, row.id, summary);
  const live = sub && !["canceled", "incomplete_expired"].includes(sub.status);
  return { paymentMethod: summary, openInvoice: live ? openInvoiceJson(sub.latest_invoice) : null, subscriptionStatus: (sub && sub.status) || "" };
}
__name(syncCompanyCard, "syncCompanyCard");
// Make a SetupIntent's card the default for the customer's invoices and the current subscription.
async function useCardForCompany(env, row, pm) {
  const pmId = typeof pm === "string" ? pm : pm && pm.id;
  if (!pmId || !/^pm_[A-Za-z0-9]+$/.test(pmId)) throw new StripeError(502, "Stripe did not return a card.");
  // Cards only: check the type before making it the default anywhere.
  const full = pm && typeof pm === "object" && pm.type ? pm : await stripe(env, "GET", "/v1/payment_methods/" + encodeURIComponent(pmId));
  if (!isCardPaymentMethod(full)) {
    // Checkout already attached it to the customer; detach so it can never be charged.
    await stripe(env, "POST", "/v1/payment_methods/" + encodeURIComponent(pmId) + "/detach", {}, `nudge-detach-${pmId}`);
    return { refused: true };
  }
  await stripe(env, "POST", "/v1/customers/" + encodeURIComponent(row.stripe_customer_id), { invoice_settings: { default_payment_method: pmId } }, `nudge-card-cus-${row.id}-${pmId}`);
  if (row.stripe_subscription_id) {
    const sub = await liveSubscription(env, row.stripe_subscription_id);
    if (sub) await stripe(env, "POST", "/v1/subscriptions/" + encodeURIComponent(sub.id), { default_payment_method: pmId }, `nudge-card-sub-${row.id}-${pmId}`);
  }
  const summary = cardSummary(full);
  await saveCardSummary(env, row.id, summary);
  return summary;
}
__name(useCardForCompany, "useCardForCompany");
// "" when the Checkout Session is a finished card setup for this company's Stripe customer.
function setupSessionProblem(session, row) {
  if (!session || session.object !== "checkout.session") return "Stripe did not return the card setup.";
  const customer = typeof session.customer === "string" ? session.customer : session.customer && session.customer.id;
  if (!customer || customer !== row.stripe_customer_id) return "That card setup belongs to a different billing account.";
  if (session.mode !== "setup") return "That Stripe page was not a card setup.";
  if (session.status !== "complete") return "The card was not saved. Try again.";
  const si = session.setup_intent;
  if (!si || typeof si !== "object" || si.status !== "succeeded") return "Stripe has not confirmed the card yet. Try again in a moment.";
  return "";
}
__name(setupSessionProblem, "setupSessionProblem");
async function ownerBillingCompany(request, env, mutate) {
  const user = await authed(request, env, mutate);
  if (isResponse(user)) return { response: user };
  const denied = ownerOnly(user);
  if (denied) return { response: denied };
  const row = await billingRow(env, user.companyId);
  if (!row) return { response: fail(404, "Not found.") };
  return { user, row };
}
__name(ownerBillingCompany, "ownerBillingCompany");
async function ownerPaymentMethod(request, env) {
  const { response, row } = await ownerBillingCompany(request, env, false);
  if (response) return response;
  if (!row.stripe_customer_id) return json({ ok: true, started: false, message: BILLING_NOT_STARTED, paymentMethod: null, openInvoice: null });
  const base = { ok: true, started: true, livemode: Number(row.stripe_livemode) === 1, billingStatus: row.billing_status || "" };
  if (stripeKeyProblem(env)) return json({ ...base, paymentMethod: paymentMethodJson(row), openInvoice: null, stale: true });
  try {
    const synced = await syncCompanyCard(env, row);
    return json({ ...base, ...synced });
  } catch (error) {
    if (error instanceof StripeError) return json({ ...base, paymentMethod: paymentMethodJson(row), openInvoice: null, stale: true });
    throw error;
  }
}
__name(ownerPaymentMethod, "ownerPaymentMethod");
async function ownerCardSession(request, env) {
  const { response, user, row } = await ownerBillingCompany(request, env, true);
  if (response) return response;
  if (!row.stripe_customer_id) return fail(409, BILLING_NOT_STARTED);
  if (stripeKeyProblem(env)) return fail(503, "Billing is not available right now. Email nudgedispatch@gmail.com.");
  const origin = new URL(request.url).origin;
  try {
    const session = await stripe(env, "POST", "/v1/checkout/sessions", {
      mode: "setup",
      customer: row.stripe_customer_id,
      currency: "usd",
      // The pinned API version refuses payment_method_types on Checkout. Cards only comes from a payment method
      // configuration that enables only cards (STRIPE_CARD_PAYMENT_CONFIGURATION, pmc_...).
      ...(cardOnlyPaymentConfig(env) ? { payment_method_configuration: cardOnlyPaymentConfig(env) } : { excluded_payment_method_types: CARD_SETUP_EXCLUDED_TYPES }),
      success_url: origin + "/?card_session={CHECKOUT_SESSION_ID}#/settings",
      cancel_url: origin + "/#/settings",
      metadata: { app: "nudge-dispatch", company_id: row.id, purpose: "card" },
      setup_intent_data: { metadata: { app: "nudge-dispatch", company_id: row.id } }
    });
    if (!session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) return fail(502, "Stripe did not return a card page.");
    await writeAudit(env, user.userId, "billing.card_session", "company", row.id, { mode: stripeModeWord(env) });
    return json({ ok: true, url: session.url });
  } catch (error) {
    if (error instanceof StripeError) return fail(502, "Could not open the secure card page. Try again, or email nudgedispatch@gmail.com.");
    throw error;
  }
}
__name(ownerCardSession, "ownerCardSession");
async function ownerCardConfirm(request, env) {
  const { response, user, row } = await ownerBillingCompany(request, env, true);
  if (response) return response;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return fail(400, "That card setup link is not valid.");
  if (!row.stripe_customer_id) return fail(409, BILLING_NOT_STARTED);
  if (stripeKeyProblem(env)) return fail(503, "Billing is not available right now. Email nudgedispatch@gmail.com.");
  try {
    const session = await stripe(env, "GET", "/v1/checkout/sessions/" + encodeURIComponent(sessionId), { expand: ["setup_intent.payment_method"] });
    const problem = setupSessionProblem(session, row);
    if (problem) return fail(409, problem);
    const summary = await useCardForCompany(env, row, session.setup_intent.payment_method);
    if (summary && summary.refused) {
      await writeAudit(env, user.userId, "billing.card_refused", "company", row.id, { reason: "not a card", mode: stripeModeWord(env) });
      return fail(409, NOT_A_CARD);
    }
    await writeAudit(env, user.userId, "billing.card_saved", "company", row.id, { brand: summary ? summary.brand : "", last4: summary ? summary.last4 : "", mode: stripeModeWord(env) });
    const synced = await syncCompanyCard(env, await billingRow(env, row.id));
    return json({ ok: true, started: true, ...synced, paymentMethod: synced.paymentMethod || summary });
  } catch (error) {
    if (error instanceof StripeError) return fail(502, "Stripe could not save the card. Try again, or email nudgedispatch@gmail.com.");
    throw error;
  }
}
__name(ownerCardConfirm, "ownerCardConfirm");
// Owner pays the open invoice (e.g. the first one) with the card on file. Explicit tap only.
async function ownerPayInvoice(request, env) {
  const { response, user, row } = await ownerBillingCompany(request, env, true);
  if (response) return response;
  if (!row.stripe_customer_id || !row.stripe_subscription_id) return fail(409, BILLING_NOT_STARTED);
  if (stripeKeyProblem(env)) return fail(503, "Billing is not available right now. Email nudgedispatch@gmail.com.");
  try {
    const synced = await syncCompanyCard(env, row);
    if (!synced.openInvoice) return fail(409, "There is no unpaid invoice right now.");
    if (!synced.paymentMethod) return fail(409, "Add a card first.");
    const inv = synced.openInvoice;
    const paid = await stripe(env, "POST", "/v1/invoices/" + encodeURIComponent(inv.id) + "/pay", {}, `nudge-pay-${inv.id}-${Math.floor(Date.now() / 60000)}`);
    await writeAudit(env, user.userId, "billing.pay_invoice", "company", row.id, { invoice: inv.id, amount: inv.amountDue, status: paid.status || "", mode: stripeModeWord(env) });
    if (paid.status !== "paid") return fail(402, "The payment did not go through. Try another card, or use the secure Stripe invoice page.");
    return json({ ok: true, paid: true, amountPaid: Number(paid.amount_paid) || inv.amountDue, paymentMethod: synced.paymentMethod });
  } catch (error) {
    if (error instanceof StripeError) {
      await writeAudit(env, user.userId, "billing.pay_invoice", "company", row.id, { status: "failed", http: error.status, mode: stripeModeWord(env) });
      // Card errors (402) carry Stripe's customer-safe decline message.
      return fail(error.status === 402 ? 402 : 502, error.status === 402 ? error.message : "Stripe could not take the payment. Try again, or email nudgedispatch@gmail.com.");
    }
    throw error;
  }
}
__name(ownerPayInvoice, "ownerPayInvoice");
// Authenticated self-check (signed with the webhook secret, so only Stripe's signer or we can call it). Reports classes only, never values.
async function stripeSelfCheck(env) {
  const key = typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY : "";
  const keyClass = stripeKeyClass(key);
  const connection = billingConnection(env);
  const out = { keyClass, keyLength: key.length > 90 ? "long" : key.length > 0 ? "short" : "none", mode: connection.mode, testMode: connection.testMode, problem: connection.problem, stripe: "not-tried", portalConfig: env.STRIPE_PORTAL_CONFIGURATION ? "set" : "unset", cardConfig: cardOnlyPaymentConfig(env) ? "set" : "unset", portal: "not-tried" };
  if (connection.problem) return out;
  try { await stripe(env, "GET", "/v1/billing/meters", { limit: 1 }); out.stripe = "ok"; } catch (e) { out.stripe = "error " + (e && e.status); }
  if (env.STRIPE_PORTAL_CONFIGURATION) {
    try {
      const c = await stripe(env, "GET", "/v1/billing_portal/configurations/" + encodeURIComponent(env.STRIPE_PORTAL_CONFIGURATION));
      const f = c.features || {};
      out.portal = { active: c.active, paymentMethodUpdate: !!(f.payment_method_update && f.payment_method_update.enabled), invoiceHistory: !!(f.invoice_history && f.invoice_history.enabled),
        cancel: !!(f.subscription_cancel && f.subscription_cancel.enabled), planSwitch: !!(f.subscription_update && f.subscription_update.enabled) };
    } catch (e) { out.portal = "error " + (e && e.status); }
  }
  return out;
}
__name(stripeSelfCheck, "stripeSelfCheck");
async function platformBillingStatus(request, env) {
  const user = await platformUser(request, env, false);
  if (isResponse(user)) return user;
  const connection = billingConnection(env);
  return json({ ok: true, ...connection });
}
__name(platformBillingStatus, "platformBillingStatus");
async function liveSubscription(env, subId) {
  if (!subId) return null;
  const sub = await stripe(env, "GET", "/v1/subscriptions/" + encodeURIComponent(subId));
  return sub && !["canceled", "incomplete_expired"].includes(sub.status) ? sub : null;
}
__name(liveSubscription, "liveSubscription");
async function platformSmsChange(request, env, id) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  if (typeof body.enabled !== "boolean") return fail(400, "Send enabled: true or false.");
  const row = await billingRow(env, id);
  if (!row) return fail(404, "No company with that id.");
  const plan = planOf(row);
  const setupFee = setupFeeOf(row);
  const enabled = body.enabled;
  if (enabled && !smsAllowed(plan)) return fail(400, "The texting add-on is for Small fleet and Fleet plans only.");
  if (enabled && !payingNow(row)) return fail(409, SMS_NOT_PAYING_NOTE);
  const now = Date.now();
  let stripeNote = "No Stripe subscription yet, so only the account setting changed.";
  let setupBilledAt = row.sms_setup_billed_at || null;
  if (row.stripe_subscription_id) {
    try {
      const sub = await liveSubscription(env, row.stripe_subscription_id);
      if (sub && sub.status === "incomplete") return fail(409, "The first invoice on this Stripe " + stripeModeWord(env) + " subscription is not paid yet, so Stripe won't allow line-item changes. Pay it (or let it expire) and try again.");
      if (sub) {
        const catalog = await pricesWithProducts(env, smsLookupKeys());
        const prices = catalog.ids;
        const missing = smsLookupKeys().filter((k) => !prices[k]);
        if (enabled && missing.length) return fail(409, "Stripe " + stripeModeWord(env) + " catalog is missing texting prices: " + missing.join(", ") + ". Use \"Set up texting meter\" first.");
        // Texting setup fee follows the company's setup-fee choice. Checked before any Stripe change.
        let smsSetupPromoId = "";
        if (enabled && !setupBilledAt && smsSetupPromoCode(setupFee)) {
          const code = smsSetupPromoCode(setupFee);
          const promo = await findPromotion(env, code);
          if (!promo) return fail(409, "Promotion code " + code + " was not found in Stripe " + stripeModeWord(env) + " mode, so texting was not turned on. Fix it in Stripe or change this company's setup fee.");
          if (!couponCoversProduct(promo.coupon, catalog.products[LOOKUP.sms.setup])) return fail(409, "Promotion code " + code + " in Stripe " + stripeModeWord(env) + " mode does not cover the texting setup fee, so texting was not turned on. Change this company's setup fee or the coupon in Stripe.");
          smsSetupPromoId = promo.id;
        }
        const smsPriceIds = [prices[LOOKUP.sms.monthly], prices[LOOKUP.sms.overage]].filter(Boolean);
        const items = (sub.items && sub.items.data) || [];
        const present = items.filter((it) => smsPriceIds.includes(it.price && it.price.id));
        if (enabled) {
          for (const pid of smsPriceIds) {
            if (present.some((it) => it.price.id === pid)) continue;
            const params = { subscription: sub.id, price: pid, proration_behavior: "create_prorations", metadata: { app: "nudge-dispatch", company_id: row.id } };
            if (pid === prices[LOOKUP.sms.monthly]) params.quantity = 1;
            await stripe(env, "POST", "/v1/subscription_items", params, `sms-item-${row.id}-${pid}-${now}`);
          }
          if (!setupBilledAt) {
            // $75 one-time: pending invoice item on the same subscription, so it lands on the next invoice.
            await stripe(env, "POST", "/v1/invoiceitems", smsSetupInvoiceItem(sub.customer, sub.id, prices[LOOKUP.sms.setup], row.id, smsSetupPromoId), `sms-setup-${row.id}`);
            setupBilledAt = now;
          }
          stripeNote = "Texting items added to the Stripe " + stripeModeWord(env) + " subscription.";
        } else {
          for (const it of present) {
            await stripe(env, "DELETE", "/v1/subscription_items/" + encodeURIComponent(it.id), { proration_behavior: "create_prorations" });
          }
          stripeNote = "Texting items removed from the Stripe " + stripeModeWord(env) + " subscription.";
        }
      } else {
        stripeNote = "The Stripe " + stripeModeWord(env) + " subscription is canceled, so only the account setting changed.";
      }
    } catch (error) {
      return stripeFail(env, error);
    }
  }
  await env.DB.prepare("UPDATE companies SET sms_addon_enabled = ?, sms_addon_updated_at = ?, sms_setup_billed_at = ?, billing_updated_at = ? WHERE id = ?")
    .bind(enabled ? 1 : 0, now, setupBilledAt, now, id).run();
  await writeAudit(env, user.userId, enabled ? "sms.on" : "sms.off", "company", id, { name: row.name, plan, setup_fee: setupFee, stripe: row.stripe_subscription_id ? "synced" : "none" });
  const fresh = await billingRow(env, id);
  return json({ ok: true, id, billing: billingJson(fresh, await driverCountFor(env, id)), note: stripeNote });
}
__name(platformSmsChange, "platformSmsChange");
async function platformStartSubscription(request, env, id) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const row = await billingRow(env, id);
  if (!row) return fail(404, "No company with that id.");
  const problem = stripeKeyProblem(env);
  if (problem) return fail(503, problem.replace(" Texting was saved on the account only.", ""));
  const plan = planOf(row);
  // Texting is added only after the customer is paying, so a new subscription never includes it.
  const sms = false;
  const setupFee = setupFeeFromBody(body, row);
  if (!setupFee) return fail(400, "Setup fee must be free, charge, or beta.");
  try {
    if (await liveSubscription(env, row.stripe_subscription_id)) return fail(409, "This company already has a Stripe " + stripeModeWord(env) + " subscription.");
    const L = LOOKUP[plan];
    const catalog = await pricesWithProducts(env, [L.base, L.extra, L.setup, ...(sms ? smsLookupKeys() : [])]);
    const prices = catalog.ids;
    let promoId = "";
    const code = setupPromoCode(setupFee);
    if (code) {
      const promo = await findPromotion(env, code);
      if (!promo) return fail(409, "Promotion code " + code + " was not found in Stripe " + stripeModeWord(env) + " mode.");
      if (prices[L.setup] && !couponCoversProduct(promo.coupon, catalog.products[L.setup])) return fail(409, "Promotion code " + code + " in Stripe " + stripeModeWord(env) + " mode does not cover the " + PLAN_LABELS[plan] + " setup fee.");
      promoId = promo.id;
    }
    const drivers = await driverCountFor(env, id);
    const built = subscriptionPlanItems(plan, drivers, sms, prices, setupFee, promoId);
    if (built.missing.length) return fail(409, "Stripe " + stripeModeWord(env) + " catalog is missing prices: " + built.missing.join(", ") + (sms ? ". If it is the texting overage, use \"Set up texting meter\" first." : "."));
    let customerId = row.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe(env, "POST", "/v1/customers", { name: row.name, metadata: { app: "nudge-dispatch", company_id: row.id } }, `nudge-customer-${row.id}`);
      customerId = customer.id;
    }
    const sub = await stripe(env, "POST", "/v1/subscriptions", {
      customer: customerId,
      items: built.items,
      add_invoice_items: built.addInvoiceItems,
      collection_method: "charge_automatically",
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      metadata: { app: "nudge-dispatch", company_id: row.id, plan, sms: sms ? "on" : "off", setup_fee: setupFee },
      expand: ["latest_invoice"]
    }, `nudge-sub-${row.id}-${Date.now()}`);
    const now = Date.now();
    const liveFlag = stripeKeyMode(env) === "live" ? 1 : 0;
    await env.DB.prepare("UPDATE companies SET stripe_customer_id = ?, stripe_subscription_id = ?, stripe_livemode = ?, billing_updated_at = ?, sms_setup_billed_at = COALESCE(sms_setup_billed_at, ?), billing_status = ?, billing_past_due_at = NULL, sms_addon_enabled = 0, setup_fee = ? WHERE id = ?")
      .bind(customerId, sub.id, liveFlag, now, sms ? now : null, subStatusToBilling(sub.status) || "incomplete", setupFee, id).run();
    await writeAudit(env, user.userId, "billing.subscribe", "company", id, { name: row.name, plan, sms: sms ? "on" : "off", setup_fee: setupFee, mode: stripeModeWord(env) });
    const inv = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
    return json({ ok: true, id, setupFee, subscriptionId: sub.id, status: sub.status, invoiceUrl: (inv && inv.hosted_invoice_url) || "", amountDue: inv ? inv.amount_due : null, testMode: liveFlag === 0 }, 201);
  } catch (error) {
    return stripeFail(env, error);
  }
}
__name(platformStartSubscription, "platformStartSubscription");
// Change a company's setup-fee choice. Only affects setup fees billed after the change
// (the plan setup at subscription start, and the texting setup fee when texting is first turned on).
async function platformSetupFeeChange(request, env, id) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const setupFee = normSetupFee(body.setupFee);
  if (!setupFee) return fail(400, "Setup fee must be free, charge, or beta.");
  const row = await billingRow(env, id);
  if (!row) return fail(404, "No company with that id.");
  const before = setupFeeOf(row);
  await env.DB.prepare("UPDATE companies SET setup_fee = ?, billing_updated_at = ? WHERE id = ?").bind(setupFee, Date.now(), id).run();
  await writeAudit(env, user.userId, "billing.setup_fee", "company", id, { name: row.name, setup_fee: setupFee, before });
  const fresh = await billingRow(env, id);
  return json({ ok: true, id, billing: billingJson(fresh, await driverCountFor(env, id)) });
}
__name(platformSetupFeeChange, "platformSetupFeeChange");
// One-time catalog step: Stripe meters can't be made from the connector, so the app makes the
// texting meter + the $0.03/text-after-500 metered price itself. Idempotent. Lookup keys match live.
async function platformSetupSmsMeter(request, env) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const problem = stripeKeyProblem(env);
  if (problem) return fail(503, problem.replace(" Texting was saved on the account only.", ""));
  try {
    const existing = await pricesByLookup(env, [LOOKUP.sms.overage]);
    if (existing[LOOKUP.sms.overage]) return json({ ok: true, created: false, priceId: existing[LOOKUP.sms.overage], testMode: stripeModeWord(env) !== "live" });
    const meters = await stripe(env, "GET", "/v1/billing/meters", { status: "active", limit: 100 });
    let meter = (meters.data || []).find((m) => m.event_name === SMS_METER_EVENT);
    if (!meter) {
      meter = await stripe(env, "POST", "/v1/billing/meters", {
        display_name: "Nudge Dispatch texts sent",
        event_name: SMS_METER_EVENT,
        default_aggregation: { formula: "sum" },
        customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
        value_settings: { event_payload_key: "value" }
      }, "nudge-sms-meter");
    }
    const products = await stripe(env, "GET", "/v1/products/search", { query: "metadata['tier']:'sms_overage' AND active:'true'" });
    const product = products.data && products.data[0];
    if (!product) return fail(409, "Stripe " + stripeModeWord(env) + " product for extra texts (metadata tier=sms_overage) was not found.");
    const price = await stripe(env, "POST", "/v1/prices", {
      product: product.id,
      currency: "usd",
      nickname: "SMS extra texts ($0.03 each after 500/month)",
      lookup_key: LOOKUP.sms.overage,
      recurring: { interval: "month", usage_type: "metered", meter: meter.id },
      billing_scheme: "tiered",
      tiers_mode: "graduated",
      tiers: [{ up_to: 500, unit_amount: 0 }, { up_to: "inf", unit_amount_decimal: "3" }],
      metadata: { app: "nudge-dispatch", tier: "sms_overage", included_texts: "500" }
    }, "nudge-sms-overage-price");
    await writeAudit(env, user.userId, "billing.sms_meter", "platform", "", { meter: meter.id, price: price.id, mode: stripeModeWord(env) });
    return json({ ok: true, created: true, meterId: meter.id, priceId: price.id, testMode: stripeModeWord(env) !== "live" }, 201);
  } catch (error) {
    return stripeFail(env, error);
  }
}
__name(platformSetupSmsMeter, "platformSetupSmsMeter");

// ---- Texting through Bland (DRAFT). Only companies with the texting add-on can send. ----
function monthStartMs(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
__name(monthStartMs, "monthStartMs");
async function smsStatus(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const row = await billingRow(env, user.companyId);
  if (!row) return fail(404, "Not found.");
  const addon = smsOn(row) && smsAllowed(planOf(row)) && payingNow(row);
  const problem = addon ? textingProblem(env) : (smsOn(row) && !payingNow(row) ? SMS_NOT_PAYING_NOTE : "The texting add-on is not on for this account.");
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM sms_messages WHERE company_id = ? AND status = 'sent' AND created_at >= ?").bind(row.id, monthStartMs()).first();
  return json({ ok: true, addon, ready: addon && !problem, problem, mode: smsMode(env), sentThisMonth: (sent && sent.n) || 0, included: 500 });
}
__name(smsStatus, "smsStatus");
async function postRideText(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const ride = await ownedRide(env, user, id);
  if (!ride) return fail(404, "Ride not found.");
  const body = await readJson(request);
  if (isResponse(body)) return body;
  if (body.kind !== "on_my_way") return fail(400, "Choose which text to send.");
  if (ride.status !== "scheduled" || ride.approval === "requested" || ride.approval === "declined") return fail(409, "Texts can only be sent for a scheduled ride.");
  const company = await billingRow(env, user.companyId);
  if (!company || !smsOn(company) || !smsAllowed(planOf(company))) return fail(403, "The texting add-on is not on for this account.");
  if (!payingNow(company)) return fail(403, SMS_NOT_PAYING_NOTE);
  const problem = textingProblem(env);
  if (problem) return fail(503, problem);
  const already = await env.DB.prepare("SELECT id FROM sms_messages WHERE ride_id = ? AND kind = 'on_my_way' AND status = 'sent'").bind(ride.id).first();
  if (already) return fail(409, "The On my way text was already sent for this ride.");
  const to = usCanadaE164(ride.client_phone || "");
  const now = Date.now();
  const msgId = crypto.randomUUID();
  const last4 = to ? to.slice(-4) : null;
  const blocked = recipientProblem(env, to);
  if (blocked) {
    await env.DB.prepare("INSERT INTO sms_messages (id, company_id, ride_id, user_id, kind, to_last4, status, reason, created_at) VALUES (?, ?, ?, ?, 'on_my_way', ?, 'blocked', ?, ?)")
      .bind(msgId, company.id, ride.id, user.userId, last4, blocked, now).run();
    return fail(422, blocked);
  }
  const settings = await env.DB.prepare("SELECT business_name FROM invoice_settings WHERE company_id = ?").bind(company.id).first();
  const message = onMyWayMessage((settings && settings.business_name) || company.name, ride.client_name, ride.pickup_time);
  if (body.preview === true) return json({ ok: true, preview: message, toLast4: last4 });
  const sent = await sendBlandSms(env, to, message, "nudge-" + ride.id + "-on_my_way");
  if (!sent.ok) {
    await env.DB.prepare("INSERT INTO sms_messages (id, company_id, ride_id, user_id, kind, to_last4, status, reason, created_at) VALUES (?, ?, ?, ?, 'on_my_way', ?, 'failed', ?, ?)")
      .bind(msgId, company.id, ride.id, user.userId, last4, sent.reason, now).run();
    return fail(502, sent.reason);
  }
  try {
    await env.DB.prepare("INSERT INTO sms_messages (id, company_id, ride_id, user_id, kind, to_last4, status, provider_message_id, created_at) VALUES (?, ?, ?, ?, 'on_my_way', ?, 'sent', ?, ?)")
      .bind(msgId, company.id, ride.id, user.userId, last4, sent.messageId || null, now).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return fail(409, "The On my way text was already sent for this ride.");
    throw error;
  }
  // Count it on the Stripe meter (500 included, then $0.03). Skipped (kept for later) if not subscribed.
  let metered = false;
  if (company.stripe_customer_id && !stripeKeyProblem(env)) {
    try {
      await reportSmsUsage(env, company.stripe_customer_id, msgId, 1);
      await env.DB.prepare("UPDATE sms_messages SET meter_reported_at = ? WHERE id = ?").bind(Date.now(), msgId).run();
      metered = true;
    } catch (error) {
      console.log(JSON.stringify({ level: "warn", msg: "sms meter", name: error instanceof Error ? error.name : "Error" }));
    }
  }
  return json({ ok: true, sent: true, toLast4: last4, metered });
}
__name(postRideText, "postRideText");

// ---- Stripe webhook. Verifies Stripe-Signature, idempotent by event id. ----
// A test key ignores livemode events. A live key (STRIPE_MODE=live) ignores test-mode events.
async function stripeWebhook(request, env) {
  const raw = await request.text();
  if (raw.length > 1e6) return fail(413, "Too large.");
  const problem = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET || "");
  if (problem) return fail(400, "Invalid signature.");
  let event;
  try { event = JSON.parse(raw); } catch { return fail(400, "Bad payload."); }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") return fail(400, "Bad payload.");
  if (event.type === "nudge.self_check") return json({ received: true, selfCheck: await stripeSelfCheck(env) });
  const gate = stripeWebhookMode(env);
  if (!gate.mode) return json({ received: true, ignored: gate.problem || "stripe key is not enabled for this mode" });
  const decision = webhookLivemodeDecision(event, gate.mode);
  if (!decision.process) return json({ received: true, ignored: decision.ignored });
  const now = Date.now();
  if (!HANDLED_EVENTS.includes(event.type)) return json({ received: true, ignored: "event type not handled" });
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type, livemode, received_at) VALUES (?, ?, ?, ?)").bind(event.id, event.type, decision.livemode, now).run();
  if (!claimed.meta.changes) return json({ received: true, duplicate: true });
  let result;
  try {
    result = await applyStripeEvent(env, event);
  } catch (error) {
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ? AND processed_at IS NULL").bind(event.id).run(); // let Stripe retry
    throw error;
  }
  await env.DB.prepare("UPDATE stripe_events SET company_id = ?, result = ?, processed_at = ? WHERE id = ?").bind(result.companyId || null, result.result, Date.now(), event.id).run();
  return json({ received: true, result: result.result });
}
__name(stripeWebhook, "stripeWebhook");
async function applyStripeEvent(env, event) {
  const obj = event.data && event.data.object;
  if (event.type === "checkout.session.completed" && obj && isSignupCheckout(obj)) {
    const session = await stripe(env, "GET", "/v1/checkout/sessions/" + encodeURIComponent(obj.id), { expand: ["setup_intent.payment_method"] });
    const signupId = (session.metadata && session.metadata.signup_id) || (obj.metadata && obj.metadata.signup_id) || "";
    const signup = signupId ? await env.DB.prepare("SELECT * FROM signups WHERE id = ?").bind(signupId).first() : null;
    if (!signup) return { result: "ignored: unknown signup" };
    const fulfilled = await fulfillSignup(env, session, signup);
    return { companyId: fulfilled.companyId || null, result: fulfilled.result || "signup" };
  }
  const refs = refsOf(event.type, obj);
  if (!refs.customer && !refs.subscription) return { result: "ignored: no customer" };
  const company = await env.DB.prepare(
    `SELECT id, name, stripe_customer_id, stripe_subscription_id, billing_event_at, trial_billing, trial_status, trial_converted_at, trial_canceled_at FROM companies
     WHERE (stripe_subscription_id IS NOT NULL AND stripe_subscription_id = ?) OR (stripe_customer_id IS NOT NULL AND stripe_customer_id = ?)
     ORDER BY CASE WHEN stripe_subscription_id = ? THEN 0 ELSE 1 END LIMIT 1`
  ).bind(refs.subscription || "", refs.customer || "", refs.subscription || "").first();
  if (!company) return { result: "ignored: unknown customer" };
  // A different (older) subscription for the same customer must not change the current one's status.
  if (refs.subscription && company.stripe_subscription_id && refs.subscription !== company.stripe_subscription_id) return { companyId: company.id, result: "ignored: not the current subscription" };
  const livemode = event.livemode === true ? 1 : 0;
  await env.DB.prepare("UPDATE companies SET stripe_livemode = ? WHERE id = ?").bind(livemode, company.id).run();
  if (event.type === "checkout.session.completed") {
    // Card added on Stripe Checkout (setup mode). The return page usually saves it first; this covers a closed tab.
    if (!obj || obj.mode !== "setup") return { companyId: company.id, result: "ignored: not a card setup" };
    const row = await billingRow(env, company.id);
    const session = await stripe(env, "GET", "/v1/checkout/sessions/" + encodeURIComponent(obj.id), { expand: ["setup_intent.payment_method"] });
    const problem = setupSessionProblem(session, row);
    if (problem) return { companyId: company.id, result: "ignored: " + problem };
    const summary = await useCardForCompany(env, row, session.setup_intent.payment_method);
    if (summary && summary.refused) return { companyId: company.id, result: "ignored: not a card" };
    return { companyId: company.id, result: summary ? "card saved" : "card saved (no card details)" };
  }
  const createdMs = Number(event.created || 0) * 1000;
  const stale = company.billing_event_at && createdMs && createdMs < company.billing_event_at;
  const now = Date.now();
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const autoTrialOpen = isAutoTrial(company) && !company.trial_converted_at;
    const amount = Number(obj && (obj.amount_paid ?? obj.total) || 0);
    if (autoTrialOpen && amount <= 0) {
      // The $0 invoice Stripe issues when a trialing subscription starts. Still on the free trial.
      // Its period runs to the far-off Stripe trial_end, so it must not set a paid-through date.
      if (stale) return { companyId: company.id, result: "ignored: older event" };
      await env.DB.prepare("UPDATE companies SET billing_status = 'active', billing_past_due_at = NULL, billing_event_at = ? WHERE id = ?").bind(createdMs || now, company.id).run();
      return { companyId: company.id, result: "trial started ($0 invoice)" };
    }
    const through = paidThroughMs(obj);
    // Paid dates always move forward; status only if this event is not older than the last applied one.
    await env.DB.prepare(
      `UPDATE companies SET billing_last_paid_at = MAX(COALESCE(billing_last_paid_at, 0), ?),
         billing_paid_through = CASE WHEN ? IS NULL THEN billing_paid_through ELSE MAX(COALESCE(billing_paid_through, 0), ?) END,
         billing_updated_at = ? WHERE id = ?`
    ).bind(createdMs || now, through, through, now, company.id).run();
    if (stale) return { companyId: company.id, result: "paid recorded (older event, status kept)" };
    // A real payment. For a self-serve trial this also records the conversion if Stripe ended the trial itself.
    await env.DB.prepare(
      `UPDATE companies SET billing_status = 'active', billing_past_due_at = NULL, billing_event_at = ?, trial_status = 'active',
         trial_converted_at = CASE WHEN trial_billing = 'auto' THEN COALESCE(trial_converted_at, ?) ELSE trial_converted_at END WHERE id = ?`
    ).bind(createdMs || now, now, company.id).run();
    return { companyId: company.id, result: "paying" };
  }
  if (stale) return { companyId: company.id, result: "ignored: older event" };
  if (event.type === "invoice.payment_failed") {
    // The 7-day grace period runs from the FIRST failure; later failed retries don't extend it.
    await env.DB.prepare("UPDATE companies SET billing_status = 'past_due', billing_past_due_at = COALESCE(billing_past_due_at, ?), billing_event_at = ?, billing_updated_at = ? WHERE id = ?").bind(createdMs || now, createdMs || now, now, company.id).run();
    return { companyId: company.id, result: "past_due" };
  }
  if (event.type === "customer.subscription.deleted") {
    await env.DB.prepare("UPDATE companies SET billing_status = 'canceled', billing_event_at = ?, billing_updated_at = ? WHERE id = ?").bind(createdMs || now, now, company.id).run();
    if (isAutoTrial(company) && !company.trial_converted_at && !company.trial_canceled_at) {
      // Canceled outside the app (Stripe dashboard or portal) during the free trial: same as Cancel trial, never charged.
      const cols = trialCancelColumns(now);
      await env.DB.prepare("UPDATE companies SET trial_canceled_at = ?, trial_status = ?, trial_ended_at = ?, trial_end_reason = ? WHERE id = ? AND trial_converted_at IS NULL AND trial_canceled_at IS NULL")
        .bind(cols.trial_canceled_at, cols.trial_status, cols.trial_ended_at, cols.trial_end_reason, company.id).run();
      return { companyId: company.id, result: "trial canceled" };
    }
    return { companyId: company.id, result: "canceled" };
  }
  if (event.type === "customer.subscription.trial_will_end") {
    // No time expiry: if the 730-day Stripe trial horizon is near and the 15 rides aren't used, push it out again.
    if (!isAutoTrial(company) || company.trial_converted_at || company.trial_canceled_at || company.trial_status !== "trial") return { companyId: company.id, result: "ignored: not an open ride trial" };
    await stripe(env, "POST", "/v1/subscriptions/" + encodeURIComponent(company.stripe_subscription_id), { trial_end: stripeTrialEnd(now), proration_behavior: "none" }, "nudge-trial-extend-" + company.id + "-" + event.id);
    return { companyId: company.id, result: "trial extended" };
  }
  if (event.type === "customer.subscription.updated") {
    const status = subStatusToBilling(obj && obj.status);
    if (!status) return { companyId: company.id, result: "ignored: status " + String(obj && obj.status) };
    await env.DB.prepare(
      `UPDATE companies SET billing_status = ?,
         billing_past_due_at = CASE WHEN ? = 'past_due' THEN COALESCE(billing_past_due_at, ?) WHEN ? = 'active' THEN NULL ELSE billing_past_due_at END,
         billing_event_at = ?, billing_updated_at = ? WHERE id = ?`
    ).bind(status, status, createdMs || now, status, createdMs || now, now, company.id).run();
    return { companyId: company.id, result: status };
  }
  return { companyId: company.id, result: "ignored" };
}
__name(applyStripeEvent, "applyStripeEvent");
async function acceptInvite(request, env) {
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const token = typeof body.token === "string" ? body.token : "";
  const emailHint = normEmail(body.email);
  const invite = token ? await claimInvite(env, token) : null;
  if (!invite) return fail(400, "This setup link is invalid or already used.");
  const problem = passwordProblem(body.password, invite.email);
  if (problem) {
    await releaseInvite(env, invite.id);
    return fail(400, problem);
  }
  if (emailHint && emailHint !== invite.email) {
    await releaseInvite(env, invite.id);
    return fail(400, "This setup link is invalid or already used.");
  }
  // Account creation from a setup link (owner or driver) needs the Terms + Privacy checkbox. Password resets don't.
  if (invite.purpose === "invite" && body.termsAccepted !== true) {
    await releaseInvite(env, invite.id);
    return fail(400, TERMS_CONSENT_ERROR);
  }
  const password = body.password;
  try {
    if (invite.purpose === "invite" && invite.join_company_id && invite.join_role === "driver") {
      const company = await env.DB.prepare("SELECT id, name, kind FROM companies WHERE id = ?").bind(invite.join_company_id).first();
      if (!company || company.kind !== "fleet") {
        await releaseInvite(env, invite.id);
        return fail(400, "This driver link is no longer valid.");
      }
      const userId = crypto.randomUUID();
      const now = Date.now();
      const hashed = await hashPassword(password);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users (id, company_id, email, password_hash, password_salt, password_iterations, password_kdf, created_at, password_changed_at, terms_accepted_at, terms_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(userId, company.id, invite.email, hashed.hash, hashed.salt, hashed.iterations, PASSWORD_KDF, now, now, now, SIGNUP_TERMS_VERSION),
        env.DB.prepare("INSERT INTO memberships (company_id, user_id, role, created_at) VALUES (?, ?, 'driver', ?)").bind(company.id, userId, now)
      ]);
      const session = await startSession(env, request, userId);
      return json({ ok: true, ...publicUser({ email: invite.email, companyName: company.name, csrf: session.csrf, role: "driver", accountKind: "fleet" }) }, 201, { "set-cookie": session.cookie });
    }
    if (invite.purpose === "invite") {
      const userId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const now = Date.now();
      const hashed = await hashPassword(password);
      const kind = invite.account_kind === "fleet" ? "fleet" : "individual";
      const billingPlan = normPlan(invite.billing_plan) || (kind === "fleet" ? "small" : "solo");
      // Texting is never turned on at signup (only after the company is paying).
      const smsChoice = 0;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO companies (id, name, created_at, kind, trial_started_at, billing_plan, sms_addon_enabled, sms_addon_updated_at, terms_accepted_at, terms_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(companyId, invite.company_name || "My car service", now, kind, now, billingPlan, smsChoice, now, now, SIGNUP_TERMS_VERSION),
        env.DB.prepare(
          "INSERT INTO users (id, company_id, email, password_hash, password_salt, password_iterations, password_kdf, created_at, password_changed_at, terms_accepted_at, terms_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(userId, companyId, invite.email, hashed.hash, hashed.salt, hashed.iterations, PASSWORD_KDF, now, now, now, SIGNUP_TERMS_VERSION),
        env.DB.prepare("INSERT INTO memberships (company_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(companyId, userId, now),
        env.DB.prepare(
          `INSERT INTO invoice_settings (company_id, business_name, email, updated_at) VALUES (?, ?, ?, ?)`
        ).bind(companyId, invite.company_name || "", invite.email, now)
      ]);
      await ensureBookingSlug(env, companyId);
      const session = await startSession(env, request, userId);
      return json({ ok: true, ...publicUser({ email: invite.email, companyName: invite.company_name || "", csrf: session.csrf, role: "owner", accountKind: kind }) }, 201, { "set-cookie": session.cookie });
    }
    if (invite.purpose === "reset" && invite.user_id) {
      const hashed = await hashPassword(password);
      const now = Date.now();
      await env.DB.prepare(
        "UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_kdf = ?, password_changed_at = ? WHERE id = ?"
      ).bind(hashed.hash, hashed.salt, hashed.iterations, PASSWORD_KDF, now, invite.user_id).run();
      await revokeAll(env, invite.user_id);
      await clearFailures(env, invite.email);
      const profile = await accountProfile(env, invite.user_id);
      if (!profile || profile.suspended) return fail(403, "This company is suspended.");
      const session = await startSession(env, request, invite.user_id);
      return json({ ok: true, ...publicUser({ ...profile, csrf: session.csrf, access: await companyAccess(env, profile) }) }, 200, { "set-cookie": session.cookie });
    }
    await releaseInvite(env, invite.id);
    return fail(400, "This setup link is invalid or already used.");
  } catch (error) {
    await releaseInvite(env, invite.id);
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return fail(409, "That email already has an account.");
    throw error;
  }
}
__name(acceptInvite, "acceptInvite");
async function findDriverCompany(env, code) {
  const slug = code.toLowerCase();
  const bySlug = await env.DB.prepare(
    "SELECT id, name, kind, status, booking_slug FROM companies WHERE booking_slug = ?"
  ).bind(slug).first();
  if (bySlug) return bySlug;
  const rows = await env.DB.prepare(
    "SELECT id, name, kind, status, booking_slug FROM companies WHERE name = ? COLLATE NOCASE"
  ).bind(code).all();
  const list = rows.results || [];
  return list.length === 1 ? list[0] : null;
}
__name(findDriverCompany, "findDriverCompany");
async function driverLogin(request, env) {
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const code = str(body.company, 80);
  const named = driverFields({ name: body.name, vehicle: "", plate: "" });
  const passcode = typeof body.passcode === "string" ? body.passcode.trim() : "";
  if (!code || named.error || !passcode) return fail(401, "Name or passcode is wrong.");
  const attemptKey = `driver:${code.toLowerCase()}:${named.name.toLowerCase()}`;
  if (await loginLocked(env, attemptKey)) return fail(429, "Too many attempts. Wait a few minutes and try again.");
  const company = await findDriverCompany(env, code);
  const driver = company && company.kind === "fleet" ? await env.DB.prepare(
    `SELECT user_id, login, passcode_hash, passcode_salt, passcode_iterations, passcode_kdf
     FROM drivers WHERE company_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL`
  ).bind(company.id, named.name).first() : null;
  const usable = driver && driver.login === "passcode" && driver.passcode_kdf === PASSWORD_KDF && driver.passcode_hash && driver.passcode_salt;
  const ok = usable ? await verifyPassword(passcode, driver.passcode_salt, driver.passcode_hash, driver.passcode_iterations || PASSWORD_ITERATIONS) : false;
  if (!usable) await dummyVerify(passcode);
  if (!ok || !driver) {
    await noteFailure(env, attemptKey);
    return fail(401, "Name or passcode is wrong.");
  }
  const profile = await accountProfile(env, driver.user_id);
  if (!profile) {
    await noteFailure(env, attemptKey);
    return fail(401, "Name or passcode is wrong.");
  }
  if (profile.suspended || company.status !== "active") return fail(403, "This company is suspended.");
  await clearFailures(env, attemptKey);
  await env.DB.prepare("UPDATE users SET last_sign_in_at = ? WHERE id = ?").bind(Date.now(), driver.user_id).run();
  const session = await startSession(env, request, driver.user_id);
  return json({ ok: true, ...publicUser({ ...profile, csrf: session.csrf, access: await companyAccess(env, profile) }) }, 200, { "set-cookie": session.cookie });
}
__name(driverLogin, "driverLogin");
async function login(request, env) {
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const email = normEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return fail(401, "Email or password is wrong.");
  if (await loginLocked(env, email)) return fail(429, "Too many attempts. Wait a few minutes and try again.");
  const user = await checkPassword(env, email, password);
  if (!user) {
    await noteFailure(env, email);
    return fail(401, "Email or password is wrong.");
  }
  const profile = await accountProfile(env, user.id);
  if (!profile) return fail(401, "Email or password is wrong.");
  if (profile.suspended) return fail(403, "This company is suspended.");
  await clearFailures(env, email);
  await env.DB.prepare("UPDATE users SET last_sign_in_at = ? WHERE id = ?").bind(Date.now(), user.id).run();
  const session = await startSession(env, request, user.id);
  return json({ ok: true, ...publicUser({ ...profile, csrf: session.csrf, access: await companyAccess(env, profile) }) }, 200, { "set-cookie": session.cookie });
}
__name(login, "login");
async function logout(request, env) {
  const user = await currentUser(request, env);
  if (user) {
    const csrf = await requireCsrf(request, user);
    if (csrf) return csrf;
    await revokeSession(env, user.sessionId);
    await stopSharing(env, user.userId, user.companyId);
  }
  return json({ ok: true }, 200, { "set-cookie": clearCookie(request) });
}
__name(logout, "logout");
async function me(request, env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  // Address suggestions in the owner/driver app: the browser key and the fleet's base bias.
  const maps = !user.platformAdmin && user.companyId && mapsBrowserKey(env) ? { key: mapsBrowserKey(env), bias: biasFor(await loadFleetBase(env, user.companyId)) } : null;
  return json({ ok: true, ...publicUser(user), maps });
}
__name(me, "me");
async function authed(request, env, mutate) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  if (user.platformAdmin) return fail(404, "Not found.");
  if (user.access && user.access.locked) {
    const path = new URL(request.url).pathname;
    const allowed = (request.method === "GET" && LOCKED_ALLOWED.has(path)) || (request.method === "POST" && LOCKED_POST_ALLOWED.has(path));
    if (!allowed) return billingLockedResponse(user);
  }
  if (mutate) {
    const csrf = await requireCsrf(request, user);
    if (csrf) return csrf;
  }
  return user;
}
__name(authed, "authed");
async function listClients(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  // ?archived=1 lists archived clients only; the default list (and the new-ride picker) hides them.
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  let rows;
  let archiveOn = true;
  try {
    rows = await env.DB.prepare(
      "SELECT id, name, phone, email, notes, created_at, updated_at, archived_at FROM clients WHERE company_id = ? AND archived_at IS " + (archived ? "NOT NULL" : "NULL") + " ORDER BY name COLLATE NOCASE"
    ).bind(user.companyId).all();
  } catch (err) {
    if (!isMissingArchiveCol(err)) throw err;
    archiveOn = false;
    rows = archived ? { results: [] } : await env.DB.prepare(
      "SELECT id, name, phone, email, notes, created_at, updated_at FROM clients WHERE company_id = ? ORDER BY name COLLATE NOCASE"
    ).bind(user.companyId).all();
  }
  let archivedCount = 0;
  if (archiveOn) archivedCount = Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE company_id = ? AND archived_at IS NOT NULL").bind(user.companyId).first())?.n || 0);
  return json({ ok: true, clients: (rows.results || []).map(clientJson), archivedCount, archiveOn });
}
__name(listClients, "listClients");
function clientFields(body) {
  const name = str(body.name, 80);
  const phone = str(body.phone, 40);
  const email = body.email ? normEmail(body.email) : "";
  const notes = str(body.notes, 2e3);
  if (!name) return { name, phone, email, notes, error: "Enter the client name." };
  if (body.email && !email) return { name, phone, email, notes, error: "Enter a valid client email, or leave it blank." };
  return { name, phone, email, notes, error: "" };
}
__name(clientFields, "clientFields");
async function createClient(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const fields = clientFields(body);
  if (fields.error) return fail(400, fields.error);
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO clients (id, company_id, name, phone, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, user.companyId, fields.name, fields.phone, fields.email, fields.notes, now, now).run();
  return json({ ok: true, client: clientJson({ id, ...fields, created_at: now, updated_at: now }) }, 201);
}
__name(createClient, "createClient");
async function ownedClient(env, companyId, id) {
  // SELECT * so archived_at comes back after migration 0018 and nothing breaks before it.
  return env.DB.prepare(
    "SELECT * FROM clients WHERE company_id = ? AND id = ?"
  ).bind(companyId, id).first();
}
__name(ownedClient, "ownedClient");
async function getClient(request, env, id) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const row = await ownedClient(env, user.companyId, id);
  if (!row) return fail(404, "Client not found.");
  return json({ ok: true, client: clientJson(row), history: await clientHistory(env, user.companyId, id) });
}
__name(getClient, "getClient");
// What "Delete client" would keep. Invoices hang off rides (invoices.ride_id), so any invoice implies a ride.
async function clientHistory(env, companyId, id) {
  const today = todayIso();
  const n = /* @__PURE__ */ __name(async (sql, ...b) => Number((await env.DB.prepare(sql).bind(...b).first())?.n || 0), "n");
  const [rides, upcomingRides, invoices, schedules, activeSchedules] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM rides WHERE company_id = ? AND client_id = ?", companyId, id),
    n("SELECT COUNT(*) AS n FROM rides WHERE company_id = ? AND client_id = ? AND status = 'scheduled' AND pickup_date >= ?", companyId, id, today),
    n("SELECT COUNT(*) AS n FROM invoices i JOIN rides r ON r.id = i.ride_id AND r.company_id = i.company_id WHERE i.company_id = ? AND r.client_id = ?", companyId, id),
    n("SELECT COUNT(*) AS n FROM ride_schedules WHERE company_id = ? AND client_id = ?", companyId, id),
    n("SELECT COUNT(*) AS n FROM ride_schedules WHERE company_id = ? AND client_id = ? AND active = 1", companyId, id)
  ]);
  return { rides, upcomingRides, invoices, schedules, activeSchedules, hardDelete: !rides && !invoices && !schedules };
}
__name(clientHistory, "clientHistory");
async function updateClient(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const existing = await ownedClient(env, user.companyId, id);
  if (!existing) return fail(404, "Client not found.");
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const fields = clientFields({ ...existing, name: body.name ?? existing.name, phone: body.phone ?? existing.phone, email: body.email ?? existing.email, notes: body.notes ?? existing.notes });
  if (fields.error) return fail(400, fields.error);
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE clients SET name = ?, phone = ?, email = ?, notes = ?, updated_at = ? WHERE company_id = ? AND id = ?"
  ).bind(fields.name, fields.phone, fields.email, fields.notes, now, user.companyId, id).run();
  return json({ ok: true, client: clientJson({ ...existing, ...fields, updated_at: now }) });
}
__name(updateClient, "updateClient");
// Owner "Delete client" (Nov 20, 2026). Company owner only; every query is scoped to the owner's company_id.
// No rides, invoices or schedules -> the client row is deleted. Otherwise the client is ARCHIVED (migration 0018):
// rides, invoices and billed totals stay; active regular schedules are paused (active = 0, end date kept) so no
// new dates come due. Restore clears the archive flag and leaves schedules paused for the owner to turn back on.
async function deleteClient(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const existing = await ownedClient(env, user.companyId, id);
  if (!existing) return fail(404, "Client not found.");
  const h = await clientHistory(env, user.companyId, id);
  const now = Date.now();
  if (h.hardDelete) {
    const gone = "NOT EXISTS (SELECT 1 FROM clients WHERE company_id = ? AND id = ?)";
    const res = await env.DB.batch([
      // Guarded: a ride or schedule added since the check above keeps the client.
      env.DB.prepare("DELETE FROM clients WHERE company_id = ? AND id = ? AND NOT EXISTS (SELECT 1 FROM rides WHERE company_id = ? AND client_id = ?) AND NOT EXISTS (SELECT 1 FROM ride_schedules WHERE company_id = ? AND client_id = ?)").bind(user.companyId, id, user.companyId, id, user.companyId, id),
      env.DB.prepare("INSERT INTO admin_audit (id, actor_user_id, action, target_type, target_id, detail, created_at) SELECT ?, ?, 'client.delete', 'client', ?, ?, ? WHERE " + gone).bind(crypto.randomUUID(), user.userId, id, JSON.stringify({ companyId: user.companyId, hard: true }), now, user.companyId, id)
    ]);
    if (!res[0].meta.changes) return fail(409, "This client just got a ride or schedule. Refresh and try again.");
    return json({ ok: true, deleted: true });
  }
  if (existing.archived_at) return json({ ok: true, archived: true, already: true, history: h, pausedSchedules: 0 });
  try {
    const res = await env.DB.batch([
      env.DB.prepare("UPDATE clients SET archived_at = ?, updated_at = ? WHERE company_id = ? AND id = ? AND archived_at IS NULL").bind(now, now, user.companyId, id),
      env.DB.prepare("UPDATE ride_schedules SET active = 0, updated_at = ? WHERE company_id = ? AND client_id = ? AND active = 1").bind(now, user.companyId, id),
      env.DB.prepare("INSERT INTO admin_audit (id, actor_user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, 'client.archive', 'client', ?, ?, ?)").bind(crypto.randomUUID(), user.userId, id, JSON.stringify({ companyId: user.companyId, rides: h.rides, invoices: h.invoices, schedules: h.schedules, pausedSchedules: h.activeSchedules }), now)
    ]);
    return json({ ok: true, archived: true, history: h, pausedSchedules: res[1].meta.changes || 0 });
  } catch (err) {
    if (isMissingArchiveCol(err)) return json({ ok: false, needsMigration: true, error: "This client has rides or schedules, so they would be archived, not deleted. Archiving needs a database update first. Nothing was changed." }, 409);
    throw err;
  }
}
__name(deleteClient, "deleteClient");
async function restoreClient(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const existing = await ownedClient(env, user.companyId, id);
  if (!existing) return fail(404, "Client not found.");
  if (!("archived_at" in existing)) return fail(409, "Archive needs a database update first.");
  if (!existing.archived_at) return json({ ok: true, restored: false, client: clientJson(existing) });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE clients SET archived_at = NULL, updated_at = ? WHERE company_id = ? AND id = ?").bind(now, user.companyId, id),
    env.DB.prepare("INSERT INTO admin_audit (id, actor_user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, 'client.restore', 'client', ?, ?, ?)").bind(crypto.randomUUID(), user.userId, id, JSON.stringify({ companyId: user.companyId }), now)
  ]);
  return json({ ok: true, restored: true, client: clientJson({ ...existing, archived_at: null, updated_at: now }) });
}
__name(restoreClient, "restoreClient");
var RIDE_SELECT = `SELECT r.id, r.client_id, c.name AS client_name, c.phone AS client_phone, c.email AS client_email, r.pickup_date, r.pickup_time, r.pickup, r.dropoff,
  r.passengers, r.flight, r.fare_cents, r.notes, r.status, r.payment, r.progress, r.en_route_at, r.arrived_at, r.picked_up_at, r.completed_at,
  r.driver_user_id, drv.name AS assigned_driver_name, drv.vehicle AS assigned_driver_vehicle, drv.plate AS assigned_driver_plate, r.created_at, r.updated_at, r.approval, r.source, r.trip_type, r.vehicle_name, r.hours, r.quote_cents, r.quote_json,
  r.airport_json, r.luggage, r.stops_json, r.quoted_miles, r.quoted_minutes, r.quote_status, r.quoted_at, r.flight_status_json,
  (SELECT fa.message FROM flight_alerts fa WHERE fa.company_id = r.company_id AND fa.ride_id = r.id ORDER BY fa.created_at DESC LIMIT 1) AS flight_alert,
  (SELECT fa.kind FROM flight_alerts fa WHERE fa.company_id = r.company_id AND fa.ride_id = r.id ORDER BY fa.created_at DESC LIMIT 1) AS flight_alert_kind,
  (SELECT fa.created_at FROM flight_alerts fa WHERE fa.company_id = r.company_id AND fa.ride_id = r.id ORDER BY fa.created_at DESC LIMIT 1) AS flight_alert_at
  FROM rides r JOIN clients c ON c.id = r.client_id AND c.company_id = r.company_id
  LEFT JOIN drivers drv ON drv.user_id = r.driver_user_id AND drv.company_id = r.company_id`;
async function listRides(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const rows = user.role === "driver" ? await env.DB.prepare(`${RIDE_SELECT} WHERE r.company_id = ? AND r.driver_user_id = ? ORDER BY r.pickup_date DESC, r.pickup_time DESC LIMIT 200`).bind(user.companyId, user.userId).all() : await env.DB.prepare(`${RIDE_SELECT} WHERE r.company_id = ? ORDER BY r.pickup_date DESC, r.pickup_time DESC LIMIT 200`).bind(user.companyId).all();
  return json({ ok: true, rides: (rows.results || []).map((row) => rideJson(row, user.role)) });
}
__name(listRides, "listRides");
async function ownedRide(env, user, id) {
  if (user.role === "driver") {
    return env.DB.prepare(`${RIDE_SELECT} WHERE r.company_id = ? AND r.id = ? AND r.driver_user_id = ?`).bind(user.companyId, id, user.userId).first();
  }
  return env.DB.prepare(`${RIDE_SELECT} WHERE r.company_id = ? AND r.id = ?`).bind(user.companyId, id).first();
}
__name(ownedRide, "ownedRide");
function rideFields(body) {
  const clientId = str(body.clientId, 36);
  const date = str(body.date, 10);
  const time = str(body.time, 5);
  const pickup = str(body.pickup, 200);
  const dropoff = str(body.dropoff, 200);
  const flight = str(body.flight, 12).toUpperCase();
  const notes = str(body.notes, 2e3);
  const passengers = Number(body.passengers ?? 1);
  const fare = parseFare(body.fare);
  if (!/^[0-9a-f-]{36}$/.test(clientId)) return { error: "Choose a client." };
  if (!validDate(date)) return { error: "Enter the pickup date." };
  if (!validTime(time)) return { error: "Enter the pickup time." };
  if (!pickup) return { error: "Enter the pickup address." };
  if (!dropoff) return { error: "Enter the drop-off address." };
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 14) return { error: "Enter passengers from 1 to 14." };
  if (fare === null) return { error: "Enter the fare in dollars, such as 125 or 125.50." };
  const stopsIn = readStops(body.stops);
  if (stopsIn.error) return { error: stopsIn.error };
  return { error: "", fields: { client_id: clientId, pickup_date: date, pickup_time: time, pickup, dropoff, passengers, flight, fare_cents: fare, notes, stops_json: stopsToStored(stopsIn.stops) } };
}
__name(rideFields, "rideFields");
async function createRide(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const trial = await companyTrial(env, user.companyId);
  if (trial && !trial.open) return trialBlocked();
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const parsed = rideFields(body);
  if (!parsed.fields) return fail(400, parsed.error);
  const client = await ownedClient(env, user.companyId, parsed.fields.client_id);
  if (!client) return fail(404, "Client not found.");
  const now = Date.now();
  const id = crypto.randomUUID();
  const f = parsed.fields;
  await env.DB.prepare(
    `INSERT INTO rides (id, company_id, client_id, driver_user_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight, fare_cents, notes, status, payment, created_at, updated_at, stops_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 'unpaid', ?, ?, ?)`
  ).bind(id, user.companyId, f.client_id, user.accountKind === "individual" ? user.userId : null, f.pickup_date, f.pickup_time, f.pickup, f.dropoff, f.passengers, f.flight, f.fare_cents, f.notes, now, now, f.stops_json).run();
  await autoRestoreClient(env, user.companyId, f.client_id, id, user.userId, "owner");
  const row = await ownedRide(env, user, id);
  return json({ ok: true, ride: row ? rideJson(row, user.role) : null }, 201);
}
__name(createRide, "createRide");
// Regular client schedules (see app/schedules.js and migrations/0007_ride_schedules.sql).
// Nothing here creates a ride or sends a message on its own: rides come only from the owner's Confirm.
var SCHEDULE_SELECT = `SELECT s.*, c.name AS client_name, drv.name AS driver_name
  FROM ride_schedules s JOIN clients c ON c.id = s.client_id AND c.company_id = s.company_id
  LEFT JOIN drivers drv ON drv.user_id = s.driver_user_id AND drv.company_id = s.company_id AND drv.deleted_at IS NULL`;
function scheduleShape(row) {
  return {
    monthDays: parseDayList(row.month_days, "month"),
    weekDays: parseDayList(row.week_days, "week"),
    startDate: row.start_date,
    endDate: row.end_date || null,
    lookaheadDays: row.lookahead_days,
    active: row.active === 1
  };
}
__name(scheduleShape, "scheduleShape");
function occurrenceJson(row, hit) {
  return {
    scheduleId: row.id,
    date: hit.date,
    dateLabel: shortDate(hit.date),
    time: row.pickup_time,
    clientId: row.client_id,
    clientName: row.client_name,
    label: row.label || "",
    pickup: row.pickup,
    dropoff: row.dropoff,
    stops: parseStoredStops(row.stops_json),
    passengers: row.passengers,
    flight: row.flight,
    fareCents: row.fare_cents ?? null,
    fare: row.fare_cents === null || row.fare_cents === void 0 ? "" : money(row.fare_cents),
    driverName: row.driver_name || "",
    lastDayFallback: hit.lastDayFallback,
    note: hit.note
  };
}
__name(occurrenceJson, "occurrenceJson");
function scheduleJson(row, handled, today) {
  const shape = scheduleShape(row);
  const json2 = {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    label: row.label || "",
    ...shape,
    time: row.pickup_time,
    pickup: row.pickup,
    dropoff: row.dropoff,
    stops: parseStoredStops(row.stops_json),
    passengers: row.passengers,
    flight: row.flight,
    notes: row.notes,
    fareCents: row.fare_cents ?? null,
    fare: row.fare_cents === null || row.fare_cents === void 0 ? "" : money(row.fare_cents),
    driverUserId: row.driver_user_id || null,
    driverName: row.driver_name || "",
    summary: describeSchedule(shape),
    monthEndNote: monthEndNote(shape),
    updatedAt: row.updated_at
  };
  if (handled && today) json2.upcoming = pendingOccurrences(shape, today, handled).map((hit) => occurrenceJson(row, hit));
  return json2;
}
__name(scheduleJson, "scheduleJson");
async function ownedSchedule(env, companyId, id) {
  return env.DB.prepare(`${SCHEDULE_SELECT} WHERE s.company_id = ? AND s.id = ?`).bind(companyId, id).first();
}
__name(ownedSchedule, "ownedSchedule");
async function handledDates(env, companyId, fromIso, toIso) {
  const rows = await env.DB.prepare(
    "SELECT schedule_id, occurs_on FROM ride_schedule_occurrences WHERE company_id = ? AND occurs_on >= ? AND occurs_on <= ?"
  ).bind(companyId, fromIso, toIso).all();
  const map = new Map();
  for (const r of rows.results || []) {
    if (!map.has(r.schedule_id)) map.set(r.schedule_id, new Set());
    map.get(r.schedule_id).add(r.occurs_on);
  }
  return map;
}
__name(handledDates, "handledDates");
async function scheduleOwner(request, env, mutate) {
  const user = await authed(request, env, mutate);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  return user;
}
__name(scheduleOwner, "scheduleOwner");
async function activeDriver(env, companyId, driverId) {
  return env.DB.prepare(
    `SELECT m.role FROM memberships m
     LEFT JOIN drivers d ON d.user_id = m.user_id AND d.company_id = m.company_id
     WHERE m.company_id = ? AND m.user_id = ? AND d.deleted_at IS NULL`
  ).bind(companyId, driverId).first();
}
__name(activeDriver, "activeDriver");
async function listSchedules(request, env) {
  const user = await scheduleOwner(request, env, false);
  if (isResponse(user)) return user;
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  if (clientId && !/^[0-9a-f-]{36}$/.test(clientId)) return fail(400, "Choose a client.");
  const rows = clientId
    ? await env.DB.prepare(`${SCHEDULE_SELECT} WHERE s.company_id = ? AND s.client_id = ? ORDER BY s.created_at`).bind(user.companyId, clientId).all()
    : await env.DB.prepare(`${SCHEDULE_SELECT} WHERE s.company_id = ? ORDER BY c.name COLLATE NOCASE, s.created_at`).bind(user.companyId).all();
  const today = todayInZone();
  const handled = await handledDates(env, user.companyId, today, addDays(today, MAX_LOOKAHEAD_DAYS));
  return json({ ok: true, today, schedules: (rows.results || []).map((row) => scheduleJson(row, handled.get(row.id) || /* @__PURE__ */ new Set(), today)) });
}
__name(listSchedules, "listSchedules");
async function upcomingSchedules(request, env) {
  const user = await scheduleOwner(request, env, false);
  if (isResponse(user)) return user;
  const rows = await env.DB.prepare(`${SCHEDULE_SELECT} WHERE s.company_id = ? AND s.active = 1`).bind(user.companyId).all();
  const today = todayInZone();
  const handled = await handledDates(env, user.companyId, today, addDays(today, MAX_LOOKAHEAD_DAYS));
  const items = [];
  for (const row of rows.results || []) {
    for (const hit of pendingOccurrences(scheduleShape(row), today, handled.get(row.id) || /* @__PURE__ */ new Set())) items.push(occurrenceJson(row, hit));
  }
  items.sort((a, b) => (a.date + a.time + a.clientName).localeCompare(b.date + b.time + b.clientName));
  return json({ ok: true, today, count: items.length, occurrences: items });
}
__name(upcomingSchedules, "upcomingSchedules");
async function scheduleDriverFor(env, user, driverId) {
  if (user.accountKind !== "fleet") return { driverId: null };
  if (!driverId) return { driverId: null };
  const member = await activeDriver(env, user.companyId, driverId);
  if (!member) return { error: fail(404, "That driver is not in this company.") };
  return { driverId };
}
__name(scheduleDriverFor, "scheduleDriverFor");
async function getScheduleOne(request, env, id) {
  const user = await scheduleOwner(request, env, false);
  if (isResponse(user)) return user;
  const row = await ownedSchedule(env, user.companyId, id);
  if (!row) return fail(404, "Schedule not found.");
  const today = todayInZone();
  const handled = await handledDates(env, user.companyId, today, addDays(today, MAX_LOOKAHEAD_DAYS));
  return json({ ok: true, today, schedule: scheduleJson(row, handled.get(row.id) || /* @__PURE__ */ new Set(), today) });
}
__name(getScheduleOne, "getScheduleOne");
async function createSchedule(request, env) {
  const user = await scheduleOwner(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const parsed = readSchedule(body);
  if (!parsed.fields) return fail(400, parsed.error);
  const f = parsed.fields;
  if (!await ownedClient(env, user.companyId, f.client_id)) return fail(404, "Client not found.");
  const driver = await scheduleDriverFor(env, user, f.driver_user_id);
  if (driver.error) return driver.error;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM ride_schedules WHERE company_id = ?").bind(user.companyId).first();
  if (count && count.n >= 200) return fail(409, "This account already has 200 regular schedules.");
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO ride_schedules (id, company_id, client_id, label, month_days, week_days, pickup_time, pickup, dropoff, stops_json, passengers, flight, notes,
      fare_cents, driver_user_id, start_date, end_date, lookahead_days, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.companyId, f.client_id, f.label, f.month_days, f.week_days, f.pickup_time, f.pickup, f.dropoff, f.stops_json, f.passengers, f.flight, f.notes,
    f.fare_cents, driver.driverId, f.start_date, f.end_date, f.lookahead_days, f.active, now, now).run();
  const row = await ownedSchedule(env, user.companyId, id);
  const today = todayInZone();
  return json({ ok: true, schedule: row ? scheduleJson(row, /* @__PURE__ */ new Set(), today) : null }, 201);
}
__name(createSchedule, "createSchedule");
async function updateSchedule(request, env, id) {
  const user = await scheduleOwner(request, env, true);
  if (isResponse(user)) return user;
  const existing = await ownedSchedule(env, user.companyId, id);
  if (!existing) return fail(404, "Schedule not found.");
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const parsed = readSchedule(body, scheduleJson(existing));
  if (!parsed.fields) return fail(400, parsed.error);
  const f = parsed.fields;
  if (!await ownedClient(env, user.companyId, f.client_id)) return fail(404, "Client not found.");
  let driverId = f.driver_user_id;
  if (body.driverUserId !== void 0 || f.driver_user_id !== existing.driver_user_id) {
    const driver = await scheduleDriverFor(env, user, f.driver_user_id);
    if (driver.error) return driver.error;
    driverId = driver.driverId;
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE ride_schedules SET client_id = ?, label = ?, month_days = ?, week_days = ?, pickup_time = ?, pickup = ?, dropoff = ?, stops_json = ?, passengers = ?,
      flight = ?, notes = ?, fare_cents = ?, driver_user_id = ?, start_date = ?, end_date = ?, lookahead_days = ?, active = ?, updated_at = ?
     WHERE company_id = ? AND id = ?`
  ).bind(f.client_id, f.label, f.month_days, f.week_days, f.pickup_time, f.pickup, f.dropoff, f.stops_json, f.passengers, f.flight, f.notes, f.fare_cents,
    driverId, f.start_date, f.end_date, f.lookahead_days, f.active, now, user.companyId, id).run();
  const row = await ownedSchedule(env, user.companyId, id);
  const today = todayInZone();
  const handled = await handledDates(env, user.companyId, today, addDays(today, MAX_LOOKAHEAD_DAYS));
  return json({ ok: true, schedule: row ? scheduleJson(row, handled.get(id) || /* @__PURE__ */ new Set(), today) : null });
}
__name(updateSchedule, "updateSchedule");
async function deleteSchedule(request, env, id) {
  const user = await scheduleOwner(request, env, true);
  if (isResponse(user)) return user;
  const existing = await ownedSchedule(env, user.companyId, id);
  if (!existing) return fail(404, "Schedule not found.");
  // Rides already confirmed from this schedule stay on the books; only the schedule and its date log go.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ride_schedule_occurrences WHERE company_id = ? AND schedule_id = ?").bind(user.companyId, id),
    env.DB.prepare("DELETE FROM ride_schedules WHERE company_id = ? AND id = ?").bind(user.companyId, id)
  ]);
  return json({ ok: true });
}
__name(deleteSchedule, "deleteSchedule");
// Shared checks for confirm / skip: the date must be a real occurrence of an active schedule, not long past.
async function occurrenceTarget(env, user, id, occursOn) {
  const row = await ownedSchedule(env, user.companyId, id);
  if (!row) return { error: fail(404, "Schedule not found.") };
  if (row.active !== 1) return { error: fail(409, "This schedule is paused. Resume it first.") };
  const hit = matchDate(scheduleShape(row), occursOn);
  if (!hit) return { error: fail(400, "That date is not on this schedule.") };
  const today = todayInZone();
  if (occursOn < addDays(today, -7)) return { error: fail(409, "That date has passed. Add the ride from + New if it happened.") };
  if (occursOn > addDays(today, MAX_LOOKAHEAD_DAYS)) return { error: fail(409, `You can confirm dates up to ${MAX_LOOKAHEAD_DAYS} days ahead.`) };
  const done = await env.DB.prepare("SELECT status, ride_id FROM ride_schedule_occurrences WHERE schedule_id = ? AND occurs_on = ?").bind(id, occursOn).first();
  if (done) return { error: json({ ok: false, error: done.status === "skipped" ? "That date was skipped. Undo the skip first." : "That date is already confirmed.", status: done.status, rideId: done.ride_id || null }, 409) };
  return { row, hit };
}
__name(occurrenceTarget, "occurrenceTarget");
function isConstraintError(error) {
  const text = error instanceof Error ? error.message + " " + String(error.cause || "") : String(error);
  return /UNIQUE|PRIMARY KEY|constraint/i.test(text);
}
__name(isConstraintError, "isConstraintError");
async function confirmOccurrence(request, env, id, occursOn) {
  const user = await scheduleOwner(request, env, true);
  if (isResponse(user)) return user;
  const trial = await companyTrial(env, user.companyId);
  if (trial && !trial.open) return trialBlocked();
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const target = await occurrenceTarget(env, user, id, occursOn);
  if (target.error) return target.error;
  const s = target.row;
  const defaultFare = s.fare_cents === null || s.fare_cents === void 0 ? void 0 : (s.fare_cents / 100).toFixed(2);
  if (body.fare === void 0 && defaultFare === void 0) return fail(400, "This schedule has no default fare. Use Edit to enter the fare.");
  const parsed = rideFields({
    clientId: s.client_id,
    date: body.date ?? occursOn,
    time: body.time ?? s.pickup_time,
    pickup: body.pickup ?? s.pickup,
    dropoff: body.dropoff ?? s.dropoff,
    passengers: body.passengers ?? s.passengers,
    flight: body.flight ?? s.flight,
    fare: body.fare ?? defaultFare,
    notes: body.notes ?? s.notes,
    stops: body.stops === void 0 ? parseStoredStops(s.stops_json) : body.stops
  });
  if (!parsed.fields) return fail(400, parsed.error);
  const f = parsed.fields;
  if (!await ownedClient(env, user.companyId, f.client_id)) return fail(404, "Client not found.");
  let driverId = null;
  if (user.accountKind === "individual") driverId = user.userId;
  else if (body.driverUserId !== void 0) {
    const driver = await scheduleDriverFor(env, user, body.driverUserId === null || body.driverUserId === "" ? null : str(body.driverUserId, 36));
    if (driver.error) return driver.error;
    driverId = driver.driverId;
  } else if (s.driver_user_id && await activeDriver(env, user.companyId, s.driver_user_id)) {
    driverId = s.driver_user_id;
  }
  const now = Date.now();
  const rideId = crypto.randomUUID();
  try {
    // One transaction: the occurrence row (primary key schedule_id + occurs_on) goes first, so a second
    // Confirm for the same date fails the whole batch and no second ride is written.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO ride_schedule_occurrences (schedule_id, company_id, occurs_on, status, ride_id, created_at, updated_at) VALUES (?, ?, ?, 'confirmed', ?, ?, ?)"
      ).bind(id, user.companyId, occursOn, rideId, now, now),
      env.DB.prepare(
        `INSERT INTO rides (id, company_id, client_id, driver_user_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight, fare_cents, notes, status, payment, created_at, updated_at, source, stops_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 'unpaid', ?, ?, 'schedule', ?)`
      ).bind(rideId, user.companyId, f.client_id, driverId, f.pickup_date, f.pickup_time, f.pickup, f.dropoff, f.passengers, f.flight, f.fare_cents, f.notes, now, now, f.stops_json)
    ]);
  } catch (error) {
    if (isConstraintError(error)) return fail(409, "That date is already confirmed or skipped.");
    throw error;
  }
  await autoRestoreClient(env, user.companyId, f.client_id, rideId, user.userId, "schedule");
  queueRideAlert(request, env, user, rideId, driverId, "assigned");
  const ride = await ownedRide(env, user, rideId);
  return json({ ok: true, occursOn, ride: ride ? rideJson(ride, user.role) : null }, 201);
}
__name(confirmOccurrence, "confirmOccurrence");
async function skipOccurrence(request, env, id, occursOn) {
  const user = await scheduleOwner(request, env, true);
  if (isResponse(user)) return user;
  const target = await occurrenceTarget(env, user, id, occursOn);
  if (target.error) return target.error;
  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO ride_schedule_occurrences (schedule_id, company_id, occurs_on, status, ride_id, created_at, updated_at) VALUES (?, ?, ?, 'skipped', NULL, ?, ?)"
    ).bind(id, user.companyId, occursOn, now, now).run();
  } catch (error) {
    if (isConstraintError(error)) return fail(409, "That date is already confirmed or skipped.");
    throw error;
  }
  return json({ ok: true, occursOn, status: "skipped" });
}
__name(skipOccurrence, "skipOccurrence");
async function unskipOccurrence(request, env, id, occursOn) {
  const user = await scheduleOwner(request, env, true);
  if (isResponse(user)) return user;
  const row = await ownedSchedule(env, user.companyId, id);
  if (!row) return fail(404, "Schedule not found.");
  const done = await env.DB.prepare("SELECT status FROM ride_schedule_occurrences WHERE company_id = ? AND schedule_id = ? AND occurs_on = ?").bind(user.companyId, id, occursOn).first();
  if (!done) return fail(404, "That date was not skipped.");
  if (done.status !== "skipped") return fail(409, "A confirmed date stays. Cancel the ride instead.");
  await env.DB.prepare("DELETE FROM ride_schedule_occurrences WHERE company_id = ? AND schedule_id = ? AND occurs_on = ? AND status = 'skipped'").bind(user.companyId, id, occursOn).run();
  return json({ ok: true, occursOn });
}
__name(unskipOccurrence, "unskipOccurrence");
async function getRide(request, env, id) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const row = await ownedRide(env, user, id);
  if (!row) return fail(404, "Ride not found.");
  const invoice = await env.DB.prepare("SELECT id, number FROM invoices WHERE company_id = ? AND ride_id = ?").bind(user.companyId, id).first();
  return json({ ok: true, ride: rideJson(row, user.role), invoice: invoice || null });
}
__name(getRide, "getRide");
async function updateRide(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const existing = await ownedRide(env, user, id);
  if (!existing) return fail(404, "Ride not found.");
  if (existing.approval === "requested" || existing.approval === "declined") return fail(409, "Approve this request before editing it.");
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const payment = body.payment === void 0 ? existing.payment : str(body.payment, 20);
  if (payment !== "unpaid" && payment !== "invoiced" && payment !== "paid") return fail(400, "Payment must be unpaid, invoiced, or paid.");
  const parsed = rideFields({
    clientId: body.clientId ?? existing.client_id,
    date: body.date ?? existing.pickup_date,
    time: body.time ?? existing.pickup_time,
    pickup: body.pickup ?? existing.pickup,
    dropoff: body.dropoff ?? existing.dropoff,
    passengers: body.passengers ?? existing.passengers,
    flight: body.flight ?? existing.flight,
    fare: body.fare === void 0 ? (existing.fare_cents / 100).toFixed(2) : body.fare,
    notes: body.notes ?? existing.notes,
    stops: body.stops === void 0 ? parseStoredStops(existing.stops_json) : body.stops
  });
  if (!parsed.fields) return fail(400, parsed.error);
  const client = await ownedClient(env, user.companyId, parsed.fields.client_id);
  if (!client) return fail(404, "Client not found.");
  const now = Date.now();
  const f = parsed.fields;
  await env.DB.prepare(
    `UPDATE rides SET client_id = ?, pickup_date = ?, pickup_time = ?, pickup = ?, dropoff = ?, passengers = ?, flight = ?,
      fare_cents = ?, notes = ?, payment = ?, stops_json = ?, updated_at = ? WHERE company_id = ? AND id = ?`
  ).bind(f.client_id, f.pickup_date, f.pickup_time, f.pickup, f.dropoff, f.passengers, f.flight, f.fare_cents, f.notes, payment, f.stops_json, now, user.companyId, id).run();
  if (body.driverUserId !== void 0 && body.driverUserId !== existing.driver_user_id) {
    if (user.accountKind !== "fleet") return fail(403, "An individual account cannot assign drivers.");
    const driverId = body.driverUserId === null || body.driverUserId === "" ? null : str(body.driverUserId, 36);
    if (driverId) {
      const member = await env.DB.prepare(
        `SELECT m.role FROM memberships m
         LEFT JOIN drivers d ON d.user_id = m.user_id AND d.company_id = m.company_id
         WHERE m.company_id = ? AND m.user_id = ? AND d.deleted_at IS NULL`
      ).bind(user.companyId, driverId).first();
      if (!member) return fail(404, "That driver is not in this company.");
    }
    await env.DB.prepare("UPDATE rides SET driver_user_id = ?, updated_at = ? WHERE company_id = ? AND id = ?").bind(driverId, now, user.companyId, id).run();
    // Alerts go out after the response (ctx.waitUntil); a failed push never fails the assignment.
    if (driverId) queueRideAlert(request, env, user, id, driverId, "assigned");
    if (existing.driver_user_id) queueRideAlert(request, env, user, id, existing.driver_user_id, "unassigned");
  }
  const row = await ownedRide(env, user, id);
  return json({ ok: true, ride: row ? rideJson(row, user.role) : null });
}
__name(updateRide, "updateRide");
async function setRideStatus(request, env, id, status) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const existing = await ownedRide(env, user, id);
  if (!existing) return fail(404, "Ride not found.");
  if (existing.approval === "requested") return fail(409, "Decline this request instead of cancelling.");
  if (existing.approval === "declined") return fail(409, "A declined request stays on the books.");
  if (existing.status === "completed") return fail(409, "A completed ride stays on the books. Change the payment status if you need to.");
  const now = Date.now();
  await env.DB.prepare("UPDATE rides SET status = ?, updated_at = ? WHERE company_id = ? AND id = ?").bind(status, now, user.companyId, id).run();
  if (status === "cancelled" && existing.status !== "cancelled" && existing.driver_user_id) queueRideAlert(request, env, user, id, existing.driver_user_id, "cancelled");
  const row = await ownedRide(env, user, id);
  return json({ ok: true, ride: row ? rideJson(row, user.role) : null });
}
__name(setRideStatus, "setRideStatus");
async function postProgress(request, env, id, forced) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const existing = await ownedRide(env, user, id);
  if (!existing) return fail(404, "Ride not found.");
  const body = forced ? { step: forced, from: existing.progress || "" } : await readJson(request);
  if (isResponse(body)) return body;
  const step = typeof body.step === "string" ? body.step : "";
  const from = typeof body.from === "string" ? body.from : "";
  const undo = body.undo === true;
  if (!isProgressStep(step) || !isProgressStep(from) || !step) return fail(400, "Choose the next ride step.");
  return applyProgress(env, user, existing, step, from, undo);
}
__name(postProgress, "postProgress");
async function applyProgress(env, user, existing, step, from, undo) {
  const companyId = user.companyId;
  if (existing.approval === "requested" || existing.approval === "declined") return fail(409, "Approve this request before moving the ride forward.");
  if (existing.status === "cancelled") return fail(409, "A cancelled ride cannot move forward.");
  const current = isProgressStep(existing.progress) ? existing.progress : "";
  if (!undo && current === step) {
    const same = await ownedRide(env, user, existing.id);
    return json({ ok: true, ride: same ? rideJson(same, user.role) : null });
  }
  const currentIndex = PROGRESS_STEPS.indexOf(current);
  const stepIndex2 = PROGRESS_STEPS.indexOf(step);
  if (!undo) {
    if (from !== current || stepIndex2 !== currentIndex + 1) return fail(409, "That step is out of order. Refresh the ride and try the next one.");
  } else if (from !== current || stepIndex2 !== currentIndex - 1) {
    return fail(409, "Undo goes back one step.");
  }
  if (undo && current === "Completed") {
    const invoice = await env.DB.prepare("SELECT id FROM invoices WHERE company_id = ? AND ride_id = ?").bind(companyId, existing.id).first();
    if (invoice) return fail(409, "This ride already has an invoice, so the drop-off time stays.");
  }
  const now = Date.now();
  const stamp = /* @__PURE__ */ __name((name) => step === name ? now : null, "stamp");
  let result;
  if (!undo) {
    result = await env.DB.prepare(
      `UPDATE rides SET progress = ?, status = ?, en_route_at = COALESCE(en_route_at, ?), arrived_at = COALESCE(arrived_at, ?), picked_up_at = COALESCE(picked_up_at, ?),
        completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE company_id = ? AND id = ? AND progress = ? AND status != 'cancelled'`
    ).bind(
      step,
      step === "Completed" ? "completed" : "scheduled",
      stamp("En route"),
      stamp("Arrived"),
      stamp("Picked up"),
      stamp("Completed"),
      now,
      companyId,
      existing.id,
      current
    ).run();
  } else {
    result = await env.DB.prepare(
      `UPDATE rides SET progress = ?, status = 'scheduled',
        en_route_at = CASE WHEN ? = 'En route' THEN NULL ELSE en_route_at END,
        arrived_at = CASE WHEN ? = 'Arrived' THEN NULL ELSE arrived_at END,
        picked_up_at = CASE WHEN ? = 'Picked up' THEN NULL ELSE picked_up_at END,
        completed_at = CASE WHEN ? = 'Completed' THEN NULL ELSE completed_at END,
        updated_at = ?
       WHERE company_id = ? AND id = ? AND progress = ?`
    ).bind(step, current, current, current, current, now, companyId, existing.id, current).run();
  }
  if (!result.meta.changes) {
    const raced = await ownedRide(env, user, existing.id);
    if (raced && !undo && raced.progress === step) return json({ ok: true, ride: rideJson(raced, user.role) });
    return fail(409, "That step is out of order. Refresh the ride and try the next one.");
  }
  const row = await ownedRide(env, user, existing.id);
  if (!undo && step === "Arrived" && row) {
    try {
      await maybeSendArrivedText(env, user, row);
    } catch (error) {
      console.log(JSON.stringify({ level: "warn", msg: "arrived text", name: error instanceof Error ? error.name : "Error" }));
    }
  }
  if (!undo && step === "Completed") {
    // Counts the ride toward the free trial; the 15th completed ride converts a self-serve trial to Solo.
    try {
      await companyTrial(env, companyId);
    } catch (error) {
      console.log(JSON.stringify({ level: "warn", msg: "trial check", name: error instanceof Error ? error.name : "Error" }));
    }
  }
  const fresh = !undo && step === "Arrived" ? await ownedRide(env, user, existing.id) : row;
  return json({ ok: true, ride: fresh ? rideJson(fresh, user.role) : null });
}
__name(applyProgress, "applyProgress");
async function maybeSendArrivedText(env, user, ride) {
  const company = await billingRow(env, user.companyId);
  if (!company || !smsOn(company) || !smsAllowed(planOf(company)) || !payingNow(company)) return;
  if (textingProblem(env)) return;
  const already = await env.DB.prepare("SELECT id FROM sms_messages WHERE ride_id = ? AND kind = 'arrived' AND status = 'sent'").bind(ride.id).first();
  if (already) return;
  const to = usCanadaE164(ride.client_phone || "");
  const now = Date.now();
  const msgId = crypto.randomUUID();
  const last4 = to ? to.slice(-4) : null;
  const blocked = recipientProblem(env, to);
  if (blocked) {
    await env.DB.prepare("INSERT INTO sms_messages (id, company_id, ride_id, user_id, kind, to_last4, status, reason, created_at) VALUES (?, ?, ?, ?, 'arrived', ?, 'blocked', ?, ?)")
      .bind(msgId, company.id, ride.id, user.userId, last4, blocked, now).run();
    return;
  }
  const settings = await env.DB.prepare("SELECT business_name FROM invoice_settings WHERE company_id = ?").bind(company.id).first();
  const message = arrivedMessage({
    companyName: (settings && settings.business_name) || company.name,
    driverName: ride.assigned_driver_name || "",
    vehicle: ride.assigned_driver_vehicle || ride.vehicle_name || "",
    plate: ride.assigned_driver_plate || "",
    meetingPoint: meetingPointForArrived(parseStoredAirport(ride.airport_json))
  });
  const sent = await sendBlandSms(env, to, message, "nudge-" + ride.id + "-arrived");
  if (!sent.ok) {
    await env.DB.prepare("INSERT INTO sms_messages (id, company_id, ride_id, user_id, kind, to_last4, status, reason, created_at) VALUES (?, ?, ?, ?, 'arrived', ?, 'failed', ?, ?)")
      .bind(msgId, company.id, ride.id, user.userId, last4, sent.reason, now).run();
    return;
  }
  try {
    await env.DB.prepare("INSERT INTO sms_messages (id, company_id, ride_id, user_id, kind, to_last4, status, provider_message_id, created_at) VALUES (?, ?, ?, ?, 'arrived', ?, 'sent', ?, ?)")
      .bind(msgId, company.id, ride.id, user.userId, last4, sent.messageId || null, now).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return;
    throw error;
  }
  if (company.stripe_customer_id && !stripeKeyProblem(env)) {
    try {
      await reportSmsUsage(env, company.stripe_customer_id, msgId, 1);
      await env.DB.prepare("UPDATE sms_messages SET meter_reported_at = ? WHERE id = ?").bind(Date.now(), msgId).run();
    } catch (error) {
      console.log(JSON.stringify({ level: "warn", msg: "sms meter", name: error instanceof Error ? error.name : "Error" }));
    }
  }
}
__name(maybeSendArrivedText, "maybeSendArrivedText");
function invoiceText(settings, ride, number, issuedOn) {
  const contact = [settings.address, settings.phone, settings.email, settings.website].filter(Boolean).join(" | ");
  const trip = [
    `Date / time: ${longDate(ride.pickup_date)}, ${time12(ride.pickup_time)}`,
    `Pickup: ${ride.pickup}`,
    ...stopLines(parseStoredStops(ride.stops_json)),
    `Drop-off: ${ride.dropoff}`
  ];
  if (ride.flight) trip.push(`Flight: ${ride.flight}`);
  trip.push(`Passengers: ${ride.passengers}`);
  const clock = rideSchedule({
    pickupDate: ride.pickup_date,
    pickupTime: ride.pickup_time,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    progress: ride.progress || "",
    status: ride.status,
    enRouteAt: ride.en_route_at,
    arrivedAt: ride.arrived_at,
    pickedUpAt: ride.picked_up_at,
    completedAt: ride.completed_at
  });
  if (clock.enRouteLabel) trip.push(`On my way: ${clock.enRouteLabel} ET`);
  if (clock.arrivedLabel) trip.push(`Driver arrived: ${clock.arrivedLabel} ET`);
  if (clock.pickedUpLabel) trip.push(`Picked up: ${clock.pickedUpLabel} ET`);
  if (clock.droppedOffLabel) trip.push(`Dropped off: ${clock.droppedOffLabel} ET`);
  if (clock.toPickupMinutes !== null) trip.push(`On my way to pickup: ${clock.toPickupMinutes} min`);
  if (clock.waitingMinutes !== null) trip.push(`Waiting: ${clock.waitingMinutes} min`);
  if (clock.tripMinutes !== null) trip.push(`Trip: ${clock.tripMinutes} min`);
  const payWith = payLines(payOptions(parseStoredPaymentMethods(settings.payment_methods_json), ride.fare_cents, number));
  const howToPay = payWith.length
    ? ["Pay with", ...payWith, ...(settings.payment_instructions ? ["", "Payment note", settings.payment_instructions] : [])]
    : ["How to pay", settings.payment_instructions || "Pay the operator directly. This invoice is not sent for you."];
  return [
    "INVOICE",
    settings.business_name,
    contact,
    "",
    `Invoice #: ${number}`,
    `Issued: ${longDate(issuedOn)}`,
    "Due: on receipt",
    `Amount due: ${money(ride.fare_cents)}`,
    "",
    "Bill to",
    ride.client_name,
    "",
    "Trip",
    ...trip,
    "",
    `1. Car service    ${money(ride.fare_cents)}`,
    "",
    ...howToPay,
    "",
    "Terms",
    settings.terms || "Due on receipt.",
    settings.gratuity_note || "Price does not include gratuity.",
    "",
    `Thank you for riding with ${settings.business_name.replace(/\.+$/, "")}.`,
    "Nothing was sent automatically. Copy, print, or download this invoice and send it yourself."
  ].join("\n");
}
__name(invoiceText, "invoiceText");

// ---- Booking page brand ("Match your website") ----
// Gating (Jesse, Nov 19, 2026): free trial uses standard stock. Owners on a paid plan edit their own brand;
// a platform admin (assisted setup) can set one for any company, and an admin-set brand renders on any plan.
async function companyPaid(env, companyId) {
  const row = await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(companyId).first();
  if (!row) return false;
  return trialState(row, 0).plan === "active";
}
__name(companyPaid, "companyPaid");
// The brand a public page should render for this company row (needs id + brand_json), or null.
async function renderedBrand(env, company) {
  if (!company) return null;
  const brand = parseBrand(company.brand_json);
  if (!brand) return null;
  if (brand.source !== "owner") return brand;
  return brandRenders(brand, await companyPaid(env, company.id)) ? brand : null;
}
__name(renderedBrand, "renderedBrand");
async function brandActor(request, env, companyId, mutate) {
  if (companyId) {
    const user = await platformUser(request, env, mutate);
    if (isResponse(user)) return user;
    const row = await env.DB.prepare("SELECT id, name, booking_slug FROM companies WHERE id = ?").bind(companyId).first();
    if (!row) return fail(404, "No company with that id.");
    return { user, companyId, admin: true, company: row };
  }
  const user = await authed(request, env, mutate);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const row = await env.DB.prepare("SELECT id, name, booking_slug FROM companies WHERE id = ?").bind(user.companyId).first();
  return { user, companyId: user.companyId, admin: false, company: row || { id: user.companyId } };
}
__name(brandActor, "brandActor");
// Body: { mode: "simple", simple: { base, primary, accent, background, text }, pair } or
//       { mode: "advanced", base, colors: {9 keys}, pair }
function brandFromBody(body) {
  const pair = typeof body.pair === "string" ? body.pair : "standard";
  if (body.mode === "advanced") {
    const fp = FONT_PAIRS.find((p) => p.id === pair) || FONT_PAIRS[0];
    const fonts = {};
    if (fp.heading) fonts.heading = fp.heading;
    if (fp.body) fonts.body = fp.body;
    return parseBrand({ v: 1, base: body.base === "dark" ? "dark" : "light", colors: body.colors || {}, fonts });
  }
  return parseBrand(deriveBrand(body.simple || {}, pair));
}
__name(brandFromBody, "brandFromBody");
function brandLockText(paid, brand) {
  if (paid) return "";
  if (brand && brand.source !== "owner") return "Your booking page brand was set up for you by Nudge Dispatch. Custom branding you edit yourself comes with a paid plan.";
  return "Your free trial uses the standard Nudge look. Matching your booking page to your website comes with a paid plan. Ask Jesse at nudgedispatch@gmail.com to upgrade or for assisted setup.";
}
__name(brandLockText, "brandLockText");
async function getBrand(request, env, companyId) {
  const a = await brandActor(request, env, companyId, false);
  if (isResponse(a)) return a;
  const settings = await loadSettings(env, a.companyId);
  const brand = parseBrand(settings && settings.brand_json);
  const paid = await companyPaid(env, a.companyId);
  const locked = !a.admin && !paid;
  return json({
    ok: true,
    admin: a.admin,
    companyName: (settings && settings.business_name) || (a.company && a.company.name) || "",
    bookingSlug: (a.company && a.company.booking_slug) || "",
    paid,
    locked,
    lockedText: locked ? brandLockText(paid, brand) : "",
    brand,
    simple: simpleOf(brand),
    pair: pairOf(brand),
    renders: !!brand && brandRenders(brand, paid),
    logoDataUrl: (settings && settings.logo_data_url) || "",
    fontPairs: FONT_PAIRS.map((p) => ({ id: p.id, name: p.name }))
  });
}
__name(getBrand, "getBrand");
async function checkBrand(request, env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const csrf = await requireCsrf(request, user);
  if (csrf) return csrf;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const brand = brandFromBody(body);
  if (!brand) return json({ ok: true, brand: null, problems: brandContrastProblems(null) });
  return json({ ok: true, brand, simple: simpleOf(brand), problems: brandContrastProblems(brand) });
}
__name(checkBrand, "checkBrand");
async function brandPreviewCss(request, env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return new Response("", { status: 401, headers: securityHeaders("text/css; charset=utf-8", "no-store") });
  const raw = new URL(request.url).searchParams.get("b") || "";
  const brand = parseBrand(raw);
  const css = brand ? brandCss(brand, "#brand-live .bookpage-mock", { scoped: true }) : "";
  return new Response(css, { status: 200, headers: securityHeaders("text/css; charset=utf-8", "no-store") });
}
__name(brandPreviewCss, "brandPreviewCss");
async function ensureSettingsRow(env, companyId, name) {
  await env.DB.prepare("INSERT INTO invoice_settings (company_id, business_name, updated_at) VALUES (?, ?, ?) ON CONFLICT(company_id) DO NOTHING").bind(companyId, name || "", Date.now()).run();
}
__name(ensureSettingsRow, "ensureSettingsRow");
async function putBrand(request, env, companyId) {
  const a = await brandActor(request, env, companyId, true);
  if (isResponse(a)) return a;
  const paid = await companyPaid(env, a.companyId);
  if (!a.admin && !paid) return fail(403, brandLockText(paid, null));
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const brand = brandFromBody(body);
  if (!brand) return fail(400, "Pick a color for every field.");
  const problems = brandContrastProblems(brand);
  if (problems.length) return json({ ok: false, error: "Some colors are hard to read. Adjust them before saving.", problems }, 400);
  let logo;
  if (body.logoDataUrl !== void 0) {
    if (body.logoDataUrl === "") logo = "";
    else if (typeof body.logoDataUrl !== "string" || body.logoDataUrl.length > 18e4 || !LOGO_RE.test(body.logoDataUrl)) {
      return fail(400, "The logo must be a PNG, JPG, or WebP image under about 120 KB.");
    } else logo = body.logoDataUrl;
  }
  const stored = brandJson(brand, a.admin ? "admin" : "owner");
  await ensureSettingsRow(env, a.companyId, a.company && a.company.name);
  const now = Date.now();
  if (logo !== void 0) {
    await env.DB.prepare("UPDATE invoice_settings SET brand_json = ?, logo_data_url = ?, updated_at = ? WHERE company_id = ?").bind(stored, logo, now, a.companyId).run();
  } else {
    await env.DB.prepare("UPDATE invoice_settings SET brand_json = ?, updated_at = ? WHERE company_id = ?").bind(stored, now, a.companyId).run();
  }
  if (a.admin) await writeAudit(env, a.user.userId, "brand.set", "company", a.companyId, { name: a.company && a.company.name, base: brand.base || "light", logo: logo !== void 0 });
  return getBrand(new Request(request.url, { headers: request.headers }), env, companyId);
}
__name(putBrand, "putBrand");
// "Paste your website URL" suggestions. Never saves anything; the owner reviews and presses Save.
var BRAND_SUGGEST_MAX = 10;
var BRAND_SUGGEST_WINDOW_MS = 60 * 60 * 1e3;
async function brandSuggestAllowed(env, companyId) {
  const bucket = "brand-suggest:" + companyId;
  const now = Date.now();
  const row = await env.DB.prepare("SELECT hits, window_started FROM booking_limits WHERE bucket = ?").bind(bucket).first();
  if (!row || now - row.window_started > BRAND_SUGGEST_WINDOW_MS) {
    await env.DB.prepare(
      `INSERT INTO booking_limits (bucket, hits, window_started) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET hits = 1, window_started = excluded.window_started`
    ).bind(bucket, now).run();
    return true;
  }
  if (row.hits >= BRAND_SUGGEST_MAX) return false;
  await env.DB.prepare("UPDATE booking_limits SET hits = hits + 1 WHERE bucket = ?").bind(bucket).run();
  return true;
}
__name(brandSuggestAllowed, "brandSuggestAllowed");
async function suggestBrandApi(request, env, companyId) {
  const a = await brandActor(request, env, companyId, true);
  if (isResponse(a)) return a;
  const paid = await companyPaid(env, a.companyId);
  if (!a.admin && !paid) return fail(403, brandLockText(paid, null));
  const body = await readJson(request);
  if (isResponse(body)) return body;
  if (!await brandSuggestAllowed(env, a.companyId)) return fail(429, "That's a lot of lookups. Try again in an hour.");
  try {
    const out = await suggestBrand(typeof body.url === "string" ? body.url : "");
    const brand = parseBrand(deriveBrand(out.simple, out.simple.pair));
    return json({ ok: true, suggestion: out, problems: brandContrastProblems(brand) });
  } catch (e) {
    const known = e instanceof SuggestError;
    return json({ ok: false, error: known ? e.message : "We couldn't read that website.", code: known ? e.code : "fetch" }, known && e.code === "url" ? 400 : 422);
  }
}
__name(suggestBrandApi, "suggestBrandApi");
async function deleteBrand(request, env, companyId) {
  const a = await brandActor(request, env, companyId, true);
  if (isResponse(a)) return a;
  const paid = await companyPaid(env, a.companyId);
  if (!a.admin && !paid) return fail(403, brandLockText(paid, null));
  await env.DB.prepare("UPDATE invoice_settings SET brand_json = '', updated_at = ? WHERE company_id = ?").bind(Date.now(), a.companyId).run();
  if (a.admin) await writeAudit(env, a.user.userId, "brand.reset", "company", a.companyId, { name: a.company && a.company.name });
  return getBrand(new Request(request.url, { headers: request.headers }), env, companyId);
}
__name(deleteBrand, "deleteBrand");
async function loadSettings(env, companyId) {
  return env.DB.prepare("SELECT * FROM invoice_settings WHERE company_id = ?").bind(companyId).first();
}
__name(loadSettings, "loadSettings");
async function nextInvoiceNumber(env, companyId, prefix) {
  await env.DB.prepare("UPDATE invoice_settings SET next_number = next_number + 1 WHERE company_id = ?").bind(companyId).run();
  const row = await env.DB.prepare("SELECT next_number FROM invoice_settings WHERE company_id = ?").bind(companyId).first();
  const issued = (row?.next_number || 1) - 1;
  return `${prefix}${issued}`;
}
__name(nextInvoiceNumber, "nextInvoiceNumber");
async function createInvoice(request, env, rideId) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const ride = await ownedRide(env, user, rideId);
  if (!ride) return fail(404, "Ride not found.");
  const existing = await env.DB.prepare("SELECT id FROM invoices WHERE company_id = ? AND ride_id = ?").bind(user.companyId, rideId).first();
  if (existing) return getInvoice(request, env, existing.id);
  if (ride.status !== "completed") return fail(409, "Mark the ride complete before creating an invoice.");
  const settings = await loadSettings(env, user.companyId);
  if (!settings || !settings.business_name) return fail(400, "Add your business name in More before creating an invoice.");
  const client = await ownedClient(env, user.companyId, ride.client_id);
  const issuedOn = todayIso();
  const number = await nextInvoiceNumber(env, user.companyId, settings.prefix);
  const snapshot = invoiceText(settings, ride, number, issuedOn);
  const trip = {
    date: ride.pickup_date,
    time: ride.pickup_time,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    ...ride.stops_json ? { stops: parseStoredStops(ride.stops_json) } : {},
    passengers: ride.passengers,
    flight: ride.flight,
    fareCents: ride.fare_cents
  };
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO invoices (id, company_id, ride_id, number, amount_cents, issued_on, snapshot_text, bill_name, bill_phone, bill_email, trip_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.companyId, rideId, number, ride.fare_cents, issuedOn, snapshot, ride.client_name, client?.phone || "", client?.email || "", JSON.stringify(trip), now).run();
  if (ride.payment === "unpaid") {
    await env.DB.prepare("UPDATE rides SET payment = 'invoiced', updated_at = ? WHERE company_id = ? AND id = ?").bind(now, user.companyId, rideId).run();
  }
  return getInvoice(request, env, id);
}
__name(createInvoice, "createInvoice");
async function getInvoice(request, env, id) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const row = await env.DB.prepare(
    `SELECT i.id, i.ride_id, i.number, i.amount_cents, i.issued_on, i.snapshot_text, i.bill_name, i.bill_phone, i.bill_email, i.trip_json,
            s.business_name, s.address, s.phone, s.email, s.website, s.payment_instructions, s.gratuity_note, s.terms, s.logo_data_url,
            s.payment_methods_json, r.payment AS ride_payment,
            i.paypal_invoice_id, i.paypal_mode, i.paypal_status, i.paypal_payer_url, i.paypal_sent_at, i.paypal_refunded, pc.mode AS paypal_app_mode
     FROM invoices i JOIN invoice_settings s ON s.company_id = i.company_id
     LEFT JOIN rides r ON r.company_id = i.company_id AND r.id = i.ride_id
     LEFT JOIN paypal_credentials pc ON pc.company_id = i.company_id
     WHERE i.company_id = ? AND i.id = ?`
  ).bind(user.companyId, id).first();
  if (!row) return fail(404, "Invoice not found.");
  const paypal = invoicePayPalJson(env, row);
  let payWith = payOptions(parseStoredPaymentMethods(row.payment_methods_json), Number(row.amount_cents), row.number);
  let snapshotText = row.snapshot_text;
  if (paypal.sent) {
    // A real PayPal invoice replaces the plain PayPal link on this invoice.
    payWith = payWith.filter((o) => o.kind !== "paypal");
    if (paypal.payerUrl) payWith.unshift({ kind: "paypal_invoice", label: "PayPal", handle: "", display: "PayPal invoice " + paypal.invoiceId, url: paypal.payerUrl, copy: "" });
    snapshotText = String(snapshotText).split("\n").filter((line) => !/^PayPal: /.test(line)).join("\n");
  }
  return json({
    ok: true,
    invoice: {
      id: row.id,
      rideId: row.ride_id,
      number: row.number,
      amountCents: row.amount_cents,
      fare: money(Number(row.amount_cents)),
      issuedOn: row.issued_on,
      snapshotText,
      billTo: { name: row.bill_name, phone: row.bill_phone, email: row.bill_email },
      payment: row.ride_payment || "",
      payWith,
      payLines: payLines(payWith),
      paypal,
      trip: JSON.parse(String(row.trip_json)),
      business: {
        name: row.business_name,
        address: row.address,
        phone: row.phone,
        email: row.email,
        website: row.website,
        paymentInstructions: row.payment_instructions,
        gratuityNote: row.gratuity_note,
        terms: row.terms,
        logoDataUrl: row.logo_data_url
      }
    }
  });
}
__name(getInvoice, "getInvoice");
// PayPal invoicing settings (owner only). The secret is write-only: responses carry only its last 4.
function paypalSettingsJson(env, summary, request) {
  return {
    enabled: paypalServerMode(env) !== "off",
    problem: paypalServerProblem(env),
    serverMode: paypalServerMode(env),
    allowedModes: allowedAppModes(env),
    webhookUrl: new URL("/api/paypal/webhook", request.url).toString(),
    webhookEvents: PAYPAL_WEBHOOK_EVENTS,
    ...summary
  };
}
__name(paypalSettingsJson, "paypalSettingsJson");
function paypalFail(error) {
  if (error instanceof PayPalError) return fail(error.status >= 400 && error.status < 600 ? error.status : 502, error.message);
  throw error;
}
__name(paypalFail, "paypalFail");
async function getPayPalCredentials(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  return json({ ok: true, paypal: paypalSettingsJson(env, await credentialsSummary(env, user.companyId), request) });
}
__name(getPayPalCredentials, "getPayPalCredentials");
async function putPayPalCredentials(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const problem = paypalServerProblem(env);
  if (problem) return fail(503, problem);
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const before = await credentialsSummary(env, user.companyId);
  const input = validateCredentialsInput(env, body, before.configured);
  if (input.error) return fail(400, input.error);
  try {
    await saveCredentials(env, user.companyId, input, Date.now());
  } catch (error) {
    return paypalFail(error);
  }
  const after = await credentialsSummary(env, user.companyId);
  await writeAudit(env, user.userId, "paypal.credentials_saved", "company", user.companyId, { mode: after.mode, secretChanged: !!input.secret, webhookId: !!after.webhookId });
  return json({ ok: true, paypal: paypalSettingsJson(env, after, request) });
}
__name(putPayPalCredentials, "putPayPalCredentials");
async function deletePayPalCredentials(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  await removeCredentials(env, user.companyId);
  await writeAudit(env, user.userId, "paypal.credentials_removed", "company", user.companyId, {});
  return json({ ok: true, paypal: paypalSettingsJson(env, await credentialsSummary(env, user.companyId), request) });
}
__name(deletePayPalCredentials, "deletePayPalCredentials");
async function testPayPalCredentials(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const problem = paypalServerProblem(env);
  if (problem) return fail(503, problem);
  try {
    const creds = await loadPayPalCredentials(env, user.companyId);
    if (!creds) return fail(400, "Save your PayPal Client ID and Secret first.");
    await testConnection(env, creds);
  } catch (error) {
    return paypalFail(error);
  }
  return json({ ok: true, connected: true, mock: paypalServerMode(env) === "mock" });
}
__name(testPayPalCredentials, "testPayPalCredentials");
var PAYPAL_SENT_STATUSES = new Set(["SENT", "SCHEDULED", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID", "MARKED_AS_PAID", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED"]);
function invoicePayPalJson(env, row) {
  const status = row.paypal_status || "";
  return {
    available: paypalServerMode(env) !== "off" && !paypalServerProblem(env) && !!row.paypal_app_mode,
    mock: paypalServerMode(env) === "mock",
    invoiceId: row.paypal_invoice_id || "",
    mode: row.paypal_mode || "",
    status,
    statusLabel: PAYPAL_STATUS_LABELS[status] || status,
    sent: !!row.paypal_invoice_id && PAYPAL_SENT_STATUSES.has(status),
    payerUrl: safePayerUrl(row.paypal_payer_url),
    sentAt: row.paypal_sent_at || null,
    refunded: Number(row.paypal_refunded || 0) === 1
  };
}
__name(invoicePayPalJson, "invoicePayPalJson");
// Explicit owner tap: create a PayPal draft from this Nudge invoice and send it to the rider's email.
async function sendPayPalInvoice(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const problem = paypalServerProblem(env);
  if (problem) return fail(503, problem);
  const row = await env.DB.prepare(
    `SELECT i.id, i.ride_id, i.number, i.amount_cents, i.issued_on, i.bill_name, i.bill_email, i.trip_json, i.paypal_invoice_id, i.paypal_status,
            s.business_name, s.terms, r.payment AS ride_payment, r.client_id
     FROM invoices i JOIN invoice_settings s ON s.company_id = i.company_id
     LEFT JOIN rides r ON r.company_id = i.company_id AND r.id = i.ride_id
     WHERE i.company_id = ? AND i.id = ?`
  ).bind(user.companyId, id).first();
  if (!row) return fail(404, "Invoice not found.");
  if (row.paypal_invoice_id && PAYPAL_SENT_STATUSES.has(row.paypal_status || "")) return getInvoice(request, env, id);
  if (row.ride_payment === "paid") return fail(409, "This ride is already marked paid.");
  let email = validRiderEmail(row.bill_email);
  if (!email && row.client_id) {
    const client = await ownedClient(env, user.companyId, row.client_id);
    email = validRiderEmail(client && client.email);
    if (email) await env.DB.prepare("UPDATE invoices SET bill_email = ? WHERE company_id = ? AND id = ?").bind(email, user.companyId, id).run();
  }
  if (!email) return fail(400, "Add the rider's email to this client to send a PayPal invoice.");
  try {
    const creds = await loadPayPalCredentials(env, user.companyId);
    if (!creds) return fail(400, "Connect your PayPal app in More first.");
    const draft = buildPayPalInvoice({
      number: row.number,
      amountCents: row.amount_cents,
      issuedOn: row.issued_on,
      billName: row.bill_name,
      billEmail: email,
      trip: JSON.parse(String(row.trip_json || "{}")),
      businessName: row.business_name,
      terms: row.terms
    });
    const onDraft = /* @__PURE__ */ __name(async (ppId, status) => {
      await env.DB.prepare("UPDATE invoices SET paypal_invoice_id = ?, paypal_mode = ?, paypal_status = ? WHERE company_id = ? AND id = ?").bind(ppId, creds.mode, status, user.companyId, id).run();
    }, "onDraft");
    const sent = await createAndSendInvoice(env, creds, id, draft, { existingId: row.paypal_invoice_id || "", onDraft });
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE invoices SET paypal_invoice_id = ?, paypal_mode = ?, paypal_status = ?, paypal_payer_url = ?, paypal_sent_at = ?, paypal_checked_at = ? WHERE company_id = ? AND id = ?"
    ).bind(sent.id, creds.mode, sent.status, sent.payerUrl, now, now, user.companyId, id).run();
    await writeAudit(env, user.userId, "paypal.invoice_sent", "invoice", id, { paypalInvoiceId: sent.id, mode: creds.mode, mock: paypalServerMode(env) === "mock" });
  } catch (error) {
    return paypalFail(error);
  }
  return getInvoice(request, env, id);
}
__name(sendPayPalInvoice, "sendPayPalInvoice");
// Records PayPal's status on the Nudge invoice. Fully paid marks the ride paid; nothing here ever un-pays a ride.
async function applyPayPalStatus(env, companyId, invoiceId, rideId, paypalInvoice, now) {
  const outcome = payPalOutcome(paypalInvoice);
  if (!outcome.status) return "ignored: no status";
  await env.DB.prepare(
    "UPDATE invoices SET paypal_status = ?, paypal_checked_at = ?, paypal_refunded = CASE WHEN ? = 1 THEN 1 ELSE paypal_refunded END WHERE company_id = ? AND id = ?"
  ).bind(outcome.status, now, outcome.refunded ? 1 : 0, companyId, invoiceId).run();
  if (outcome.paid) {
    await env.DB.prepare("UPDATE rides SET payment = 'paid', updated_at = ? WHERE company_id = ? AND id = ? AND payment <> 'paid'").bind(now, companyId, rideId).run();
    return "paid";
  }
  if (outcome.refunded) return "refunded flag set";
  return "status " + outcome.status;
}
__name(applyPayPalStatus, "applyPayPalStatus");
async function paypalWebhook(request, env) {
  const raw = await request.text();
  if (raw.length > 5e5) return fail(413, "Too large.");
  if (paypalServerProblem(env)) return json({ received: true, ignored: "paypal invoicing off" });
  let event;
  try { event = JSON.parse(raw); } catch { return fail(400, "Bad payload."); }
  if (!event || typeof event.id !== "string" || !event.id || typeof event.event_type !== "string") return fail(400, "Bad payload.");
  if (!PAYPAL_WEBHOOK_EVENTS.includes(event.event_type)) return json({ received: true, ignored: "event type not handled" });
  const pp = eventInvoice(event);
  if (!pp) return json({ received: true, ignored: "no invoice" });
  const inv = await env.DB.prepare("SELECT id, company_id, ride_id FROM invoices WHERE paypal_invoice_id = ?").bind(pp.id).first();
  if (!inv) return json({ received: true, ignored: "unknown invoice" });
  const creds = await loadPayPalCredentials(env, inv.company_id);
  if (!creds || !creds.webhookId) return fail(400, "Webhook not set up for this account.");
  const verified = await verifyWebhook(env, creds, request.headers, event);
  if (!verified) return fail(400, "Invalid signature.");
  const now = Date.now();
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO paypal_events (id, event_type, resource_id, company_id, result, received_at) VALUES (?, ?, ?, ?, '', ?)").bind(event.id, event.event_type, pp.id, inv.company_id, now).run();
  if (!claimed.meta.changes) return json({ received: true, duplicate: true });
  let result;
  try {
    result = await applyPayPalStatus(env, inv.company_id, inv.id, inv.ride_id, pp, now);
  } catch (error) {
    await env.DB.prepare("DELETE FROM paypal_events WHERE id = ? AND result = ''").bind(event.id).run(); // let PayPal retry
    throw error;
  }
  await env.DB.prepare("UPDATE paypal_events SET result = ? WHERE id = ?").bind(result, event.id).run();
  return json({ received: true, result });
}
__name(paypalWebhook, "paypalWebhook");
// Owner taps "Check PayPal status": one GET from PayPal, same mapping as the webhook.
async function syncPayPalInvoice(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const problem = paypalServerProblem(env);
  if (problem) return fail(503, problem);
  const inv = await env.DB.prepare("SELECT id, ride_id, paypal_invoice_id FROM invoices WHERE company_id = ? AND id = ?").bind(user.companyId, id).first();
  if (!inv) return fail(404, "Invoice not found.");
  if (!inv.paypal_invoice_id) return fail(409, "This invoice hasn't been sent with PayPal.");
  try {
    const creds = await loadPayPalCredentials(env, user.companyId);
    if (!creds) return fail(400, "Connect your PayPal app in More first.");
    const pp = await fetchPayPalInvoice(env, creds, inv.paypal_invoice_id);
    await applyPayPalStatus(env, user.companyId, inv.id, inv.ride_id, pp, Date.now());
  } catch (error) {
    return paypalFail(error);
  }
  return getInvoice(request, env, id);
}
__name(syncPayPalInvoice, "syncPayPalInvoice");
// Backup for missed webhooks, on the existing 5-minute cron: re-check a few open PayPal invoices, each at most every 30 minutes.
async function runPayPalChecks(env, nowMs) {
  if (paypalServerProblem(env)) return { checked: 0, skipped: "off" };
  const now = nowMs || Date.now();
  const marks = PAYPAL_OPEN_STATUSES.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT id, company_id, ride_id, paypal_invoice_id FROM invoices
     WHERE paypal_invoice_id IS NOT NULL AND paypal_status IN (${marks}) AND (paypal_checked_at IS NULL OR paypal_checked_at < ?)
     ORDER BY paypal_checked_at LIMIT 10`
  ).bind(...PAYPAL_OPEN_STATUSES, now - 30 * 60 * 1e3).all();
  const credsByCompany = new Map();
  let checked = 0, paid = 0, errors = 0;
  for (const row of rows.results || []) {
    try {
      if (!credsByCompany.has(row.company_id)) credsByCompany.set(row.company_id, await loadPayPalCredentials(env, row.company_id));
      const creds = credsByCompany.get(row.company_id);
      if (!creds) {
        await env.DB.prepare("UPDATE invoices SET paypal_checked_at = ? WHERE id = ?").bind(now, row.id).run();
        continue;
      }
      const pp = await fetchPayPalInvoice(env, creds, row.paypal_invoice_id);
      const result = await applyPayPalStatus(env, row.company_id, row.id, row.ride_id, pp, now);
      checked++;
      if (result === "paid") paid++;
    } catch {
      errors++;
      await env.DB.prepare("UPDATE invoices SET paypal_checked_at = ? WHERE id = ?").bind(now, row.id).run();
    }
  }
  return { checked, paid, errors };
}
__name(runPayPalChecks, "runPayPalChecks");
const DRIVER_ROWS = `SELECT u.id, u.email, m.role,
  d.name AS driver_name, d.vehicle, d.plate, d.login AS driver_login,
  CASE WHEN d.login = 'passcode' AND d.passcode_hash <> '' THEN 1 ELSE 0 END AS passcode_set
  FROM memberships m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN drivers d ON d.user_id = u.id AND d.company_id = m.company_id
  WHERE m.company_id = ? AND d.deleted_at IS NULL`;
function driverJson(row) {
  const login = row.driver_login || "";
  const email = isRosterEmail(row.email) || login === "passcode" ? "" : row.email || "";
  return {
    id: row.id,
    name: row.driver_name || "",
    vehicle: row.vehicle || "",
    plate: row.plate || "",
    role: row.role,
    email,
    login: login || (email ? "email" : ""),
    passcodeSet: Number(row.passcode_set) === 1
  };
}
__name(driverJson, "driverJson");
function fleetDrivers(user, action) {
  const denied = ownerOnly(user);
  if (denied) return denied;
  if (user.accountKind !== "fleet") {
    return fail(403, action === "add" ? "An individual account cannot add drivers." : "An individual account cannot change drivers.");
  }
  return null;
}
__name(fleetDrivers, "fleetDrivers");
async function nameTaken(env, companyId, name, exceptId) {
  const row = await env.DB.prepare(
    "SELECT user_id FROM drivers WHERE company_id = ? AND name = ? COLLATE NOCASE AND user_id <> ? AND deleted_at IS NULL"
  ).bind(companyId, name, exceptId || "").first();
  return !!row;
}
__name(nameTaken, "nameTaken");
function duplicateDriver(error) {
  return error instanceof Error && /UNIQUE/i.test(error.message);
}
__name(duplicateDriver, "duplicateDriver");
async function loadDriver(env, companyId, userId) {
  return env.DB.prepare(`${DRIVER_ROWS} AND u.id = ?`).bind(companyId, userId).first();
}
__name(loadDriver, "loadDriver");
async function listDrivers(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const rows = await env.DB.prepare(
    `${DRIVER_ROWS} ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, COALESCE(NULLIF(d.name, ''), u.email) COLLATE NOCASE`
  ).bind(user.companyId).all();
  return json({ ok: true, drivers: (rows.results || []).map(driverJson) });
}
__name(listDrivers, "listDrivers");
async function createDriver(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = fleetDrivers(user, "add");
  if (denied) return denied;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const fields = driverFields(body);
  if (fields.error) return fail(400, fields.error);
  if (await nameTaken(env, user.companyId, fields.name, "")) return fail(409, "A driver with that name is already on this fleet.");
  const userId = crypto.randomUUID();
  const now = Date.now();
  const secret = await hashPassword(randomToken() + randomToken());
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, company_id, email, password_hash, password_salt, password_iterations, password_kdf, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, user.companyId, rosterEmailFor(userId), secret.hash, secret.salt, secret.iterations, PASSWORD_KDF, now, now),
      env.DB.prepare("INSERT INTO memberships (company_id, user_id, role, created_at) VALUES (?, ?, 'driver', ?)").bind(user.companyId, userId, now),
      env.DB.prepare(
        `INSERT INTO drivers (user_id, company_id, name, vehicle, plate, login, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'passcode', ?, ?)`
      ).bind(userId, user.companyId, fields.name, fields.vehicle, fields.plate, now, now)
    ]);
  } catch (error) {
    if (duplicateDriver(error)) return fail(409, "A driver with that name is already on this fleet.");
    throw error;
  }
  const row = await loadDriver(env, user.companyId, userId);
  return json({ ok: true, driver: row ? driverJson(row) : null }, 201);
}
__name(createDriver, "createDriver");
async function updateDriver(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = fleetDrivers(user, "change");
  if (denied) return denied;
  const existing = await loadDriver(env, user.companyId, id);
  if (!existing || existing.role !== "driver") return fail(404, "Driver not found.");
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const fields = driverFields({
    name: body.name,
    vehicle: body.vehicle === void 0 ? existing.vehicle || "" : body.vehicle,
    plate: body.plate === void 0 ? existing.plate || "" : body.plate
  });
  if (fields.error) return fail(400, fields.error);
  if (await nameTaken(env, user.companyId, fields.name, id)) return fail(409, "A driver with that name is already on this fleet.");
  const now = Date.now();
  try {
    if (existing.driver_login) {
      await env.DB.prepare(
        "UPDATE drivers SET name = ?, vehicle = ?, plate = ?, updated_at = ? WHERE user_id = ? AND company_id = ?"
      ).bind(fields.name, fields.vehicle, fields.plate, now, id, user.companyId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO drivers (user_id, company_id, name, vehicle, plate, login, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'email', ?, ?)`
      ).bind(id, user.companyId, fields.name, fields.vehicle, fields.plate, now, now).run();
    }
  } catch (error) {
    if (duplicateDriver(error)) return fail(409, "A driver with that name is already on this fleet.");
    throw error;
  }
  const row = await loadDriver(env, user.companyId, id);
  return json({ ok: true, driver: row ? driverJson(row) : null });
}
__name(updateDriver, "updateDriver");
async function passcodeDriver(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = fleetDrivers(user, "change");
  if (denied) return denied;
  const existing = await loadDriver(env, user.companyId, id);
  if (!existing || existing.role !== "driver") return fail(404, "Driver not found.");
  if (existing.driver_login !== "passcode") return fail(409, "This driver signs in with email and a password.");
  return { user, existing };
}
__name(passcodeDriver, "passcodeDriver");
async function setDriverPasscode(request, env, id) {
  const gate = await passcodeDriver(request, env, id);
  if (isResponse(gate)) return gate;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const passcode = typeof body.passcode === "string" ? body.passcode.trim() : "";
  const problem = passcodeProblem(passcode, gate.existing.driver_name);
  if (problem) return fail(400, problem);
  const hashed = await hashPassword(passcode);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE drivers SET passcode_hash = ?, passcode_salt = ?, passcode_iterations = ?, passcode_kdf = ?, updated_at = ?
     WHERE user_id = ? AND company_id = ? AND login = 'passcode'`
  ).bind(hashed.hash, hashed.salt, hashed.iterations, hashed.kdf, now, id, gate.user.companyId).run();
  await revokeAll(env, id);
  const row = await loadDriver(env, gate.user.companyId, id);
  return json({ ok: true, driver: row ? driverJson(row) : null });
}
__name(setDriverPasscode, "setDriverPasscode");
async function clearDriverPasscode(request, env, id) {
  const gate = await passcodeDriver(request, env, id);
  if (isResponse(gate)) return gate;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE drivers SET passcode_hash = '', passcode_salt = '', passcode_iterations = 0, passcode_kdf = '', updated_at = ?
     WHERE user_id = ? AND company_id = ? AND login = 'passcode'`
  ).bind(now, id, gate.user.companyId).run();
  await revokeAll(env, id);
  const row = await loadDriver(env, gate.user.companyId, id);
  return json({ ok: true, driver: row ? driverJson(row) : null });
}
__name(clearDriverPasscode, "clearDriverPasscode");
async function deleteDriver(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = fleetDrivers(user, "change");
  if (denied) return denied;
  const existing = await loadDriver(env, user.companyId, id);
  if (!existing || existing.role !== "driver") return fail(404, "Driver not found.");
  const now = Date.now();
  const name = existing.driver_name || str(existing.email, 80) || "Driver";
  const statements = [];
  if (existing.driver_login) {
    statements.push(env.DB.prepare(
      `UPDATE drivers SET deleted_at = ?, passcode_hash = '', passcode_salt = '', passcode_iterations = 0, passcode_kdf = '', updated_at = ?
       WHERE user_id = ? AND company_id = ? AND deleted_at IS NULL`
    ).bind(now, now, id, user.companyId));
  } else {
    statements.push(env.DB.prepare(
      `INSERT INTO drivers (user_id, company_id, name, vehicle, plate, login, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, '', '', 'email', ?, ?, ?)`
    ).bind(id, user.companyId, name, now, now, now));
  }
  // Upcoming work must not stay with someone who can no longer sign in.
  // Completed and cancelled rides keep driver_user_id so the name stays on the record.
  statements.push(env.DB.prepare(
    `UPDATE rides SET driver_user_id = NULL, updated_at = ?
     WHERE company_id = ? AND driver_user_id = ? AND status NOT IN ('completed', 'cancelled')`
  ).bind(now, user.companyId, id));
  statements.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  statements.push(env.DB.prepare(
    `UPDATE driver_locations SET sharing = 0, lat = NULL, lng = NULL, acc = NULL, fix_at = NULL, saved_at = NULL, updated_at = ?
     WHERE user_id = ? AND company_id = ?`
  ).bind(now, id, user.companyId));
  statements.push(env.DB.prepare(
    "UPDATE location_links SET revoked_at = ? WHERE company_id = ? AND user_id = ? AND revoked_at IS NULL"
  ).bind(now, user.companyId, id));
  statements.push(env.DB.prepare("DELETE FROM push_subscriptions WHERE company_id = ? AND user_id = ?").bind(user.companyId, id));
  const results = await env.DB.batch(statements);
  const unassigned = results[1] && results[1].meta ? results[1].meta.changes || 0 : 0;
  return json({ ok: true, unassignedRides: unassigned });
}
__name(deleteDriver, "deleteDriver");
async function getSettings(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const row = await loadSettings(env, user.companyId);
  if (!row) return fail(404, "Settings not found.");
  const bookingSlug = await ensureBookingSlug(env, user.companyId);
  return json({ ok: true, settings: { ...settingsJson(row), bookingSlug, bookingPath: bookingSlug ? "/book/" + bookingSlug + "/" : "" } });
}
__name(getSettings, "getSettings");
async function putSettings(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const existing = await loadSettings(env, user.companyId);
  if (!existing) return fail(404, "Settings not found.");
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const businessName = str(body.businessName ?? existing.business_name, 80);
  const address = str(body.address ?? existing.address, 200);
  const phone = str(body.phone ?? existing.phone, 40);
  const emailRaw = body.email === void 0 ? existing.email : body.email;
  const email = emailRaw ? normEmail(emailRaw) : "";
  const website = str(body.website ?? existing.website, 120);
  const paymentInstructions = str(body.paymentInstructions ?? existing.payment_instructions, 500);
  const gratuityNote = str(body.gratuityNote ?? existing.gratuity_note, 160) || "Price does not include gratuity.";
  const terms = str(body.terms ?? existing.terms, 300) || "Due on receipt.";
  const prefix = str(body.prefix ?? existing.prefix, 8);
  let nextNumber = existing.next_number;
  if (body.nextNumber !== void 0) {
    const n = Number(body.nextNumber);
    if (!Number.isInteger(n) || n < 1 || n > 99999999) return fail(400, "The next invoice number must be a whole number.");
    nextNumber = n;
  }
  if (emailRaw && !email) return fail(400, "Enter a valid business email, or leave it blank.");
  let themeColor = existing.theme_color || "";
  if (body.themeColor !== undefined) {
    const normalized = normalizeThemeHex(body.themeColor);
    if (normalized === null) return fail(400, "Enter a color as a 6-digit hex code, like #0b0b0b.");
    themeColor = normalized;
  }
  let logo = existing.logo_data_url;
  if (body.logoDataUrl !== void 0) {
    if (body.logoDataUrl === "") logo = "";
    else if (typeof body.logoDataUrl !== "string" || body.logoDataUrl.length > 18e4 || !LOGO_RE.test(body.logoDataUrl)) {
      return fail(400, "The logo must be a PNG, JPG, or WebP image under about 120 KB.");
    } else logo = body.logoDataUrl;
  }
  let paymentMethods = parseStoredPaymentMethods(existing.payment_methods_json);
  if (body.paymentMethods !== void 0) {
    const checked = validatePaymentMethods(body.paymentMethods);
    if (checked.error) return fail(400, checked.error);
    paymentMethods = checked.methods;
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE invoice_settings SET business_name = ?, address = ?, phone = ?, email = ?, website = ?, payment_instructions = ?,
      gratuity_note = ?, terms = ?, prefix = ?, next_number = ?, logo_data_url = ?, theme_color = ?, payment_methods_json = ?, updated_at = ? WHERE company_id = ?`
  ).bind(businessName, address, phone, email, website, paymentInstructions, gratuityNote, terms, prefix, nextNumber, logo, themeColor, JSON.stringify(paymentMethods), now, user.companyId).run();
  const row = await loadSettings(env, user.companyId);
  const bookingSlug = await ensureBookingSlug(env, user.companyId);
  return json({ ok: true, settings: row ? { ...settingsJson(row), bookingSlug, bookingPath: bookingSlug ? "/book/" + bookingSlug + "/" : "" } : null });
}
__name(putSettings, "putSettings");
function locationView(row, now) {
  if (!row || !row.sharing) return { sharing: false, fresh: false, stale: false, fixAt: null, lat: null, lng: null, acc: null };
  const age = row.fix_at === null ? Number.POSITIVE_INFINITY : now - row.fix_at;
  if (age > LOC_TTL_MS) return { sharing: true, fresh: false, stale: true, fixAt: null, lat: null, lng: null, acc: null };
  return {
    sharing: true,
    fresh: true,
    stale: age > LOC_STALE_MS,
    fixAt: row.fix_at,
    lat: row.lat,
    lng: row.lng,
    acc: row.acc
  };
}
__name(locationView, "locationView");
async function ownLocation(env, companyId, rideId, userId) {
  return env.DB.prepare(
    `SELECT user_id, company_id, ride_id, sharing, lat, lng, acc, fix_at, saved_at, updated_at
     FROM driver_locations WHERE company_id = ? AND ride_id = ? AND user_id = ?`
  ).bind(companyId, rideId, userId).first();
}
__name(ownLocation, "ownLocation");
async function stopSharing(env, userId, companyId) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE driver_locations SET sharing = 0, lat = NULL, lng = NULL, acc = NULL, fix_at = NULL, saved_at = NULL, updated_at = ?
     WHERE user_id = ? AND company_id = ?`
  ).bind(now, userId, companyId).run();
}
__name(stopSharing, "stopSharing");
function requestedRideId(request, body) {
  const fromBody = body && typeof body.rideId === "string" ? body.rideId : "";
  const fromQuery = new URL(request.url).searchParams.get("rideId") || "";
  return fromBody || fromQuery;
}
__name(requestedRideId, "requestedRideId");
async function getLocation(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const ride = await ownedRide(env, user, requestedRideId(request));
  if (!ride) return fail(404, "Ride not found.");
  const now = Date.now();
  const row = await ownLocation(env, user.companyId, ride.id, user.userId);
  const links = await env.DB.prepare(
    "SELECT id, ride_id, expires_at, revoked_at, created_at FROM location_links WHERE company_id = ? AND ride_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(user.companyId, ride.id, user.userId).all();
  return json({
    ok: true,
    location: locationView(row, now),
    links: (links.results || []).map((link) => ({ id: link.id, rideId: link.ride_id, expiresAt: link.expires_at, revokedAt: link.revoked_at, createdAt: link.created_at }))
  });
}
__name(getLocation, "getLocation");
async function setSharing(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  if (body.on !== true && body.on !== false) return fail(400, "Say whether location sharing is on.");
  const ride = await ownedRide(env, user, requestedRideId(request, body));
  if (!ride) return fail(404, "Ride not found.");
  const now = Date.now();
  if (!body.on) {
    await env.DB.prepare(
      `UPDATE driver_locations SET sharing = 0, lat = NULL, lng = NULL, acc = NULL, fix_at = NULL, saved_at = NULL, updated_at = ?
       WHERE company_id = ? AND ride_id = ? AND user_id = ?`
    ).bind(now, user.companyId, ride.id, user.userId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO driver_locations (company_id, ride_id, user_id, sharing, lat, lng, acc, fix_at, saved_at, updated_at)
       VALUES (?, ?, ?, 1, NULL, NULL, NULL, NULL, NULL, ?)
       ON CONFLICT(company_id, ride_id) DO UPDATE SET user_id = excluded.user_id, sharing = 1, updated_at = excluded.updated_at
       WHERE driver_locations.company_id = excluded.company_id AND driver_locations.ride_id = excluded.ride_id`
    ).bind(user.companyId, ride.id, user.userId, now).run();
  }
  const row = await ownLocation(env, user.companyId, ride.id, user.userId);
  return json({ ok: true, location: locationView(row, now) });
}
__name(setSharing, "setSharing");
async function postLocation(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const ride = await ownedRide(env, user, requestedRideId(request, body));
  if (!ride) return fail(404, "Ride not found.");
  const now = Date.now();
  const current = await ownLocation(env, user.companyId, ride.id, user.userId);
  if (!current || !current.sharing) return fail(409, "Turn location sharing on before sending a position.");
  const fix = cleanFix(body, now);
  if (!fix) return fail(400, "That location fix cannot be used.");
  const prev = current.fix_at !== null && current.saved_at !== null && current.lat !== null && current.lng !== null ? { lat: current.lat, lng: current.lng, fixAt: current.fix_at, savedAt: current.saved_at } : null;
  if (!shouldWriteLocation(prev, fix, now)) {
    return json({ ok: true, saved: false, location: locationView(current, now) });
  }
  await env.DB.prepare(
    `UPDATE driver_locations SET lat = ?, lng = ?, acc = ?, fix_at = ?, saved_at = ?, updated_at = ?
     WHERE company_id = ? AND ride_id = ? AND user_id = ? AND sharing = 1`
  ).bind(fix.lat, fix.lng, fix.acc, fix.fixAt, now, now, user.companyId, ride.id, user.userId).run();
  const row = await ownLocation(env, user.companyId, ride.id, user.userId);
  return json({ ok: true, saved: true, location: locationView(row, now) });
}
__name(postLocation, "postLocation");
async function createLocationLink(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const ride = await ownedRide(env, user, requestedRideId(request, body));
  if (!ride) return fail(404, "Ride not found.");
  const token = randomToken();
  const now = Date.now();
  const id = crypto.randomUUID();
  const expiresAt = now + LOCATION_LINK_MS;
  await env.DB.prepare(
    "INSERT INTO location_links (id, company_id, ride_id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)"
  ).bind(id, user.companyId, ride.id, user.userId, await sha256Hex(token), expiresAt, now).run();
  return json({ ok: true, link: { id, rideId: ride.id, token, expiresAt, path: "/#/where/" + token } }, 201);
}
__name(createLocationLink, "createLocationLink");
async function revokeLocationLink(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const now = Date.now();
  const result = await env.DB.prepare(
    "UPDATE location_links SET revoked_at = ? WHERE id = ? AND company_id = ? AND user_id = ? AND revoked_at IS NULL"
  ).bind(now, id, user.companyId, user.userId).run();
  if (!result.meta.changes) return fail(404, "Link not found.");
  return json({ ok: true });
}
__name(revokeLocationLink, "revokeLocationLink");
async function viewLocation(env, token) {
  const now = Date.now();
  const link = await env.DB.prepare(
    `SELECT l.company_id, l.user_id, l.ride_id, l.expires_at, l.revoked_at
     FROM location_links l
     JOIN rides r ON r.id = l.ride_id AND r.company_id = l.company_id
     WHERE l.token_hash = ?`
  ).bind(await sha256Hex(token)).first();
  if (!link || link.revoked_at !== null || link.expires_at <= now) return fail(404, "This location link is not active.");
  const row = await ownLocation(env, link.company_id, link.ride_id, link.user_id);
  return json({ ok: true, location: locationView(row, now) });
}
__name(viewLocation, "viewLocation");

// ---- Driver ride alerts: Web Push (draft Nov 19, 2026; see app/push.js, migrations/0017) ----
// A push never blocks or fails the request that caused it: it runs in ctx.waitUntil after the response.
var REQUEST_CTX = new WeakMap();
function inBackground(request, task) {
  const p = Promise.resolve().then(task).catch((error) => {
    console.log(JSON.stringify({ level: "error", msg: "push", name: error instanceof Error ? error.name : "Error" }));
  });
  const ctx = request ? REQUEST_CTX.get(request) : null;
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  return p;
}
__name(inBackground, "inBackground");
var PUSH_MAX_DEVICES = 10;
var PUSH_MAX_FAILS = 20;
// FCM can answer 410 for a few seconds right after a browser subscribes, before the new token propagates.
// A brand-new subscription is only counted as a failure then; after this window 404/410 deletes it.
var PUSH_NEW_GRACE_MS = 10 * 60 * 1e3;
async function pushToUser(env, companyId, userId, payload, opts) {
  const out = { devices: 0, sent: 0, failed: 0, removed: 0 };
  if (!vapidConfigured(env) || !userId) return out;
  const rows = (await env.DB.prepare(
    "SELECT id, endpoint, p256dh, auth, fail_count, created_at FROM push_subscriptions WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(companyId, userId, PUSH_MAX_DEVICES).all()).results || [];
  out.devices = rows.length;
  await Promise.all(rows.map(async (sub) => {
    if (endpointProblem(env, sub.endpoint)) {
      await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
      out.removed++;
      return;
    }
    const result = await sendPush(env, sub, payload, opts);
    if (result.ok) {
      out.sent++;
      await env.DB.prepare("UPDATE push_subscriptions SET last_ok = ?, fail_count = 0 WHERE id = ?").bind(Date.now(), sub.id).run();
    } else if ((result.gone && Date.now() - (sub.created_at || 0) > PUSH_NEW_GRACE_MS) || (sub.fail_count || 0) + 1 >= PUSH_MAX_FAILS) {
      out.removed++;
      await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
    } else {
      out.failed++;
      await env.DB.prepare("UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?").bind(sub.id).run();
    }
  }));
  console.log(JSON.stringify({ level: "info", msg: "push", kind: payload.kind, ...out }));
  return out;
}
__name(pushToUser, "pushToUser");
async function notifyRideDriver(env, companyId, rideId, driverId, kind) {
  const ride = await env.DB.prepare("SELECT id, pickup_date, pickup_time, pickup, status, driver_user_id FROM rides WHERE company_id = ? AND id = ?").bind(companyId, rideId).first();
  if (!ride) return null;
  // Only alert for an assignment that is still true when the background task runs.
  if (kind === "assigned" && (ride.driver_user_id !== driverId || ride.status === "completed" || ride.status === "cancelled")) return null;
  const company = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(companyId).first();
  const payload = rideAlertPayload(kind, ride, company ? company.name : "");
  return pushToUser(env, companyId, driverId, payload, {
    ttl: kind === "assigned" ? 6 * 60 * 60 : 60 * 60,
    urgency: kind === "assigned" ? "high" : "normal",
    topic: String(rideId).replace(/-/g, "").slice(0, 32),
  });
}
__name(notifyRideDriver, "notifyRideDriver");
function queueRideAlert(request, env, user, rideId, driverId, kind) {
  if (!driverId || !user || !vapidConfigured(env)) return null;
  if (driverId === user.userId) return null;
  return inBackground(request, () => notifyRideDriver(env, user.companyId, rideId, driverId, kind));
}
__name(queueRideAlert, "queueRideAlert");
function driverOnly(user) {
  return user.role === "driver" ? null : fail(403, "Ride alerts are for drivers.");
}
__name(driverOnly, "driverOnly");
async function pushConfig(request, env) {
  const user = await authed(request, env, false);
  if (isResponse(user)) return user;
  const enabled = vapidConfigured(env) && user.role === "driver";
  let devices = 0;
  if (enabled) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE company_id = ? AND user_id = ?").bind(user.companyId, user.userId).first();
    devices = row ? row.n : 0;
  }
  return json({ ok: true, enabled, publicKey: enabled ? env.VAPID_PUBLIC_KEY : "", devices });
}
__name(pushConfig, "pushConfig");
async function pushSubscribe(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = driverOnly(user);
  if (denied) return denied;
  if (!vapidConfigured(env)) return fail(503, "Ride alerts are not set up yet.");
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const keys = body.keys && typeof body.keys === "object" ? body.keys : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (endpointProblem(env, endpoint)) return fail(400, "This browser's alert service is not supported. Try Chrome, Safari, Edge, or Firefox.");
  if (subscriptionKeysProblem(p256dh, auth)) return fail(400, "That alert subscription is not valid. Turn alerts off and on again.");
  const platform = str(body.platform, 20).toLowerCase().replace(/[^a-z]/g, "");
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, company_id, user_id, endpoint, p256dh, auth, platform, created_at, last_ok, fail_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
     ON CONFLICT(endpoint) DO UPDATE SET company_id = excluded.company_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, platform = excluded.platform, created_at = excluded.created_at, fail_count = 0`
  ).bind(crypto.randomUUID(), user.companyId, user.userId, endpoint, p256dh, auth, platform, now).run();
  // Keep the newest few devices per driver.
  await env.DB.prepare(
    `DELETE FROM push_subscriptions WHERE company_id = ? AND user_id = ? AND id NOT IN
       (SELECT id FROM push_subscriptions WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?)`
  ).bind(user.companyId, user.userId, user.companyId, user.userId, PUSH_MAX_DEVICES).run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE company_id = ? AND user_id = ?").bind(user.companyId, user.userId).first();
  return json({ ok: true, devices: row ? row.n : 1 }, 201);
}
__name(pushSubscribe, "pushSubscribe");
async function pushUnsubscribe(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) return fail(400, "Missing endpoint.");
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE company_id = ? AND user_id = ? AND endpoint = ?").bind(user.companyId, user.userId, endpoint).run();
  return json({ ok: true });
}
__name(pushUnsubscribe, "pushUnsubscribe");
async function pushTest(request, env) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = driverOnly(user);
  if (denied) return denied;
  if (!vapidConfigured(env)) return fail(503, "Ride alerts are not set up yet.");
  if (!await limitHit(env, "pushtest:" + user.userId, 6, 10 * 60 * 1e3)) return fail(429, "Too many test alerts. Try again in a few minutes.");
  const result = await pushToUser(env, user.companyId, user.userId, rideAlertPayload("test", {}), { ttl: 120, urgency: "high", topic: "" });
  if (!result.devices) return fail(409, "Turn on ride alerts on this phone first.");
  return json({ ok: true, ...result });
}
__name(pushTest, "pushTest");

function base64Bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// src/shell.ts
import indexHtml from "./index.html";
import appCss from "./app.css";
import appJs from "./client-app.txt";
import signupHtml from "./signup.html";
import signupJs from "./client-signup.txt";
import swJs from "./client-sw.txt";
import robotsTxt from "./robots.txt";
import manifest from "./manifest.webmanifest";
import wordmark from "./brand/wordmark.svg";
import wordmarkOnDark from "./brand/wordmark-on-dark.svg";
import mark from "./brand/mark.svg";
import appleTouch from "./icons/apple-touch-icon.png";
import icon192 from "./icons/icon-192.png";
import icon512 from "./icons/icon-512.png";
import icon192Maskable from "./icons/icon-192-maskable.png";
import icon512Maskable from "./icons/icon-512-maskable.png";
import bookHtml from "./book.html";
import bookJs from "./client-book.txt";
import bookSwJs from "./client-book-sw.txt";
import { composeLogoIcon } from "./icon-compose.js";
import bookQrJs from "./client-book-qr.txt";
import bookQrSwJs from "./client-book-qr-sw.txt";
import bookQrCss from "./book-qr.css";
import { bookingUrlFor, qrSvg, qrPng, qrManifest, qrPageHtml, qrUnavailableHtml } from "./booking-qr.js";
import { validateRateSheet, sheetForEditor, publicSheetInfo, computeQuote, needsDistance, formatCents, TRIP_TYPES, TRIP_LABELS, CONFIRM_SHORTLY } from "./quote-engine.js";
import { trialState, trialBanner, trialBlockedMessage, applyTrialChange, trialJson, TRIAL_RIDE_LIMIT, TRIAL_TIME_LIMIT_DAYS, TRIAL_CANCEL_MODE, TRIAL_STRIPE_HORIZON_DAYS, CANCEL_REASONS, canCancelTrial, canCancelPaid, trialCancelColumns, cancelFeedback, stripeTrialEnd, isAutoTrial, moveBackToTrial } from "./trial.js";
import { billingAccess, billingBanner, lockedView, lockedMessage } from "./access.js";
import { normPlan, planOf, kindForPlan, smsAllowed, smsOn, billingJson, payingNow, smsEnableProblem, SMS_NOT_PAYING_NOTE, stripe, stripeKeyProblem, stripeKeyClass, stripeKeyMode, stripeWebhookMode, billingConnection, StripeError, pricesByLookup, pricesWithProducts, smsSetupPromoCode, isCardPaymentMethod, cardOnlyPaymentConfig, findPromotion, couponCoversProduct, smsSetupInvoiceItem, normSetupFee, setupFeeOf, setupFeeFromBody, setupPromoCode, cardSummary, paymentMethodJson, subscriptionPlanItems, smsLookupKeys, reportSmsUsage, LOOKUP, BETA_PROMO_CODE, SMS_METER_EVENT, SMS_PRICE_TEXT, SMS_COMING_SOON, PLAN_LABELS } from "./billing.js";
import { verifyStripeSignature, HANDLED_EVENTS, subStatusToBilling, refsOf, paidThroughMs, webhookLivemodeDecision } from "./stripe_webhook.js";
import { usCanadaE164, onMyWayMessage, arrivedMessage, sendBlandSms, textingProblem, recipientProblem, smsMode } from "./sms.js";
import { meetingPointForArrived } from "./progress-nav.js";
import { readSchedule, parseDayList, matchDate, pendingOccurrences, describeSchedule, monthEndNote, todayInZone, addDays, shortDate, MAX_LOOKAHEAD_DAYS } from "./schedules.js";
import { bookingShortName, applyBookingPageHtml } from "./booking-shell.js";
import { isListedPlatformAdmin } from "./platform-admin.js";
import { BOOKING_SLUG_RE, BOOKING_RESERVED, slugBase as slugBaseFromName, slugProblem, normalizeSlug } from "./slug.js";
import { normalizeThemeHex, themeVars, themeCss } from "./theme.js";
import { parseBrand, brandCss, brandQrCss, brandChrome, brandRenders, brandJson, brandContrastProblems, deriveBrand, simpleOf, pairOf, FONT_PAIRS, BRAND_FONT_PATH } from "./brand.js";
import { BRAND_FONT_FILES } from "./fonts/brand-fonts.js";
import { suggestBrand, SuggestError } from "./brand-suggest.js";
import { sendPush, vapidConfigured, endpointProblem, subscriptionKeysProblem, rideAlertPayload } from "./push.js";
import { RIDE_ALERT_MP3_B64, RIDE_ALERT_OGG_B64 } from "./sounds/ride-alert-audio.js";
import { PayPalError, paypalServerMode, paypalServerProblem, allowedAppModes, validateCredentialsInput, credentialsSummary, saveCredentials, removeCredentials, loadPayPalCredentials, testConnection, PAYPAL_WEBHOOK_EVENTS, buildPayPalInvoice, createAndSendInvoice, validRiderEmail, safePayerUrl, PAYPAL_STATUS_LABELS, PAYPAL_OPEN_STATUSES, payPalOutcome, eventInvoice, verifyWebhook, fetchPayPalInvoice } from "./paypal.js";
import { PUBLIC_BILLING_PLAN, SIGNUP_TERMS_VERSION, TERMS_CONSENT_ERROR, SIGNUP_TTL_MS, SIGNUP_RATE_WINDOW_MS, SIGNUP_POST_MAX, SIGNUP_SLUG_MAX, signupPublicConfig, signupFieldProblems, signupWantsSms, suggestedSlug, checkoutParams, trialSubscriptionParams, isSignupCheckout, signupSessionProblem, verifyTurnstile, normSignupEmail, normalizeSignupPhone } from "./signup.js";
import { driverFields, passcodeProblem, isRosterEmail, rosterEmailFor } from "./drivers.js";
import { validateAirportConfig, validateCapacities, publicAirportInfo, readAirportChoice, airportSummary, riderMeetingNote, parseStoredAirport, fleetClasses, bookableVehicles, vehiclesForPassengers, vehicleForPassengers, seatsFor, vehicleClassOf, presetConfig, DEFAULT_CAPACITIES } from "./airport-booking.js";
import { validatePaymentMethods, parseStoredPaymentMethods, payOptions, payLines } from "./payment-methods.js";
import { readStops, stopsToStored, parseStoredStops, stopLines, stopsCell, STOPS_PRICE_MESSAGE } from "./stops.js";
import { flightProvider, fetchFlightSnapshot, flightAlerts, flightRules, normalizeFlight, shouldWatch } from "./flight-alerts.js";
import { metersToMiles, durationToMinutes } from "./fare.js";
import { AIRPORTS, AIRPORT_CODES, airportByCode, terminalWaypoint, detectAirport, airlineOf, terminalsForAirline, terminalFromProvider, freeWaitEnds } from "./airports-data.js";
var CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
// Booking page and app shell, only when GOOGLE_MAPS_BROWSER_KEY is set: Google's documented allowlist
// for the Maps JavaScript API (Places Autocomplete). Every other response keeps CSP above.
var CSP_BOOK_MAPS = "default-src 'self'; img-src 'self' data: https://*.googleapis.com https://*.gstatic.com *.google.com *.googleusercontent.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://*.googleapis.com https://*.gstatic.com *.google.com https://*.ggpht.com *.googleusercontent.com 'unsafe-eval' blob:; connect-src 'self' https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:; frame-src *.google.com; worker-src blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
var CSP_SIGNUP = "default-src 'self'; img-src 'self' data: https://challenges.cloudflare.com; style-src 'self' https://challenges.cloudflare.com; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://checkout.stripe.com";
var FILES = {
  "/": { body: indexHtml, type: "text/html; charset=utf-8", cache: "no-cache" },
  "/index.html": { body: indexHtml, type: "text/html; charset=utf-8", cache: "no-cache" },
  "/app.css": { body: appCss, type: "text/css; charset=utf-8", cache: "public, max-age=300" },
  "/app.js": { body: appJs, type: "text/javascript; charset=utf-8", cache: "no-cache" },
  "/sw.js": { body: swJs, type: "text/javascript; charset=utf-8", cache: "no-cache" },
  "/sounds/ride-alert.mp3": { body: base64Bytes(RIDE_ALERT_MP3_B64), type: "audio/mpeg", cache: "public, max-age=86400" },
  "/sounds/ride-alert.ogg": { body: base64Bytes(RIDE_ALERT_OGG_B64), type: "audio/ogg", cache: "public, max-age=86400" },
  "/robots.txt": { body: robotsTxt, type: "text/plain; charset=utf-8", cache: "public, max-age=300" },
  "/manifest.webmanifest": { body: manifest, type: "application/manifest+json", cache: "public, max-age=300" },
  "/brand/wordmark.svg": { body: wordmark, type: "image/svg+xml", cache: "public, max-age=300" },
  "/brand/wordmark-on-dark.svg": { body: wordmarkOnDark, type: "image/svg+xml", cache: "public, max-age=300" },
  "/brand/mark.svg": { body: mark, type: "image/svg+xml", cache: "public, max-age=300" },
  "/icons/apple-touch-icon.png": { body: appleTouch, type: "image/png", cache: "public, max-age=300" },
  "/icons/icon-192.png": { body: icon192, type: "image/png", cache: "public, max-age=300" },
  "/icons/icon-512.png": { body: icon512, type: "image/png", cache: "public, max-age=300" },
  "/icons/icon-192-maskable.png": { body: icon192Maskable, type: "image/png", cache: "public, max-age=300" },
  "/icons/icon-512-maskable.png": { body: icon512Maskable, type: "image/png", cache: "public, max-age=300" },
  "/book.js": { body: bookJs, type: "text/javascript; charset=utf-8", cache: "no-store" },
  "/book-qr.js": { body: bookQrJs, type: "text/javascript; charset=utf-8", cache: "no-cache" },
  "/book-qr.css": { body: bookQrCss, type: "text/css; charset=utf-8", cache: "no-cache" },
  "/signup.js": { body: signupJs, type: "text/javascript; charset=utf-8", cache: "no-cache" }
};
function assetTag(s) {
  let h = 0;
  const text = String(s);
  for (let i = 0; i < text.length; i++) h = Math.imul(31, h) + text.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
__name(assetTag, "assetTag");
var BOOK_JS_SRC = "/book.js?v=" + assetTag(bookJs);
function bookPageHtml(companyName, themeColor, mapsOn) {
  const html = applyBookingPageHtml(bookHtml, { jsSrc: BOOK_JS_SRC, companyName, themeColor });
  // With maps on, the header CSP (CSP_BOOK_MAPS) is the policy; the stricter meta copy would block Google.
  return mapsOn ? html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, "") : html;
}
__name(bookPageHtml, "bookPageHtml");
function bookServiceWorker() {
  return bookSwJs.replaceAll('"/book.js"', '"' + BOOK_JS_SRC + '"');
}
__name(bookServiceWorker, "bookServiceWorker");
function bookingPageMatch(pathname) {
  const match = /^\/book\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  if (!BOOKING_SLUG_RE.test(match[1])) return null;
  return { slug: match[1], rest: match[2] || "" };
}
__name(bookingPageMatch, "bookingPageMatch");
async function serveBookingManifest(env, slug) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  const companyName = publicCompanyName(company);
  const base = "/book/" + slug + "/";
  const brandNow = await renderedBrand(env, company);
  const chrome = brandNow ? brandChrome(brandNow) : null;
  const body = JSON.stringify({
    id: base,
    name: companyName + " \u2014 Book a ride",
    short_name: bookingShortName(companyName),
    description: "Request a ride with " + companyName.replace(/\.+$/, "") + ".",
    start_url: base,
    scope: base,
    display: "standalone",
    background_color: chrome ? chrome.background : themeVars(company.theme_color || "").background,
    theme_color: chrome ? chrome.header : themeVars(company.theme_color || "").background,
    icons: [
      { src: base + "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: base + "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: base + "icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: base + "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  });
  return new Response(body, { status: 200, headers: securityHeaders("application/manifest+json", "no-store") });
}
__name(serveBookingManifest, "serveBookingManifest");
async function serveBookingIcon(env, slug, spec) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  let body = spec.fallback;
  if (company.logo_data_url) {
    try {
      const composed = await composeLogoIcon(company.logo_data_url, spec.size, spec.maskable);
      if (composed) body = composed;
    } catch {
    }
  }
  return new Response(body, { status: 200, headers: securityHeaders("image/png", "public, max-age=300") });
}
__name(serveBookingIcon, "serveBookingIcon");
var BOOK_QR_TAG = assetTag(bookQrJs + bookQrCss);
function qrNotFound() {
  return new Response(qrUnavailableHtml(), { status: 404, headers: securityHeaders("text/html; charset=utf-8", "no-store") });
}
__name(qrNotFound, "qrNotFound");
async function serveBookingQr(env, slug, rest, url) {
  if (rest === "/qr") {
    return new Response(null, { status: 308, headers: securityHeaders("text/plain; charset=utf-8", "no-store", { Location: "/book/" + slug + "/qr/" + url.search }) });
  }
  // Unknown and suspended companies get the same 404 (their booking page shows "not available").
  const company = await publicBookingCompany(env, slug);
  if (!company) return rest === "/qr/" ? qrNotFound() : new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  const companyName = publicCompanyName(company);
  const bookingUrl = bookingUrlFor(url.origin, slug);
  const logoDataUrl = company.logo_data_url || "";
  if (rest === "/qr/") {
    const qrBrand = await renderedBrand(env, company);
    const html = qrPageHtml({ slug, companyName, bookingUrl, logoDataUrl, themeColor: company.theme_color || "", assetTag: BOOK_QR_TAG, brandChrome: qrBrand ? brandChrome(qrBrand) : null });
    return new Response(html, { status: 200, headers: securityHeaders("text/html; charset=utf-8", "no-store") });
  }
  if (rest === "/qr.svg") {
    return new Response(qrSvg(bookingUrl, { logoDataUrl, title: companyName + " booking link: " + bookingUrl }), { status: 200, headers: securityHeaders("image/svg+xml; charset=utf-8", "public, max-age=300") });
  }
  if (rest === "/qr.png") {
    const png = await qrPng(bookingUrl, { logoDataUrl });
    return new Response(png, { status: 200, headers: securityHeaders("image/png", "public, max-age=300") });
  }
  if (rest === "/qr/theme.css") {
    const qrBrand = await renderedBrand(env, company);
    return new Response(qrBrand ? brandQrCss(qrBrand) : "", { status: 200, headers: securityHeaders("text/css; charset=utf-8", "no-store") });
  }
  if (rest === "/qr/manifest.webmanifest") {
    const qrBrand = await renderedBrand(env, company);
    return new Response(JSON.stringify(qrManifest(slug, companyName, company.theme_color || "", qrBrand ? brandChrome(qrBrand) : null)), { status: 200, headers: securityHeaders("application/manifest+json", "no-store") });
  }
  return new Response(bookQrSwJs, { status: 200, headers: securityHeaders("text/javascript; charset=utf-8", "no-store") });
}
__name(serveBookingQr, "serveBookingQr");
async function serveBookingAsset(request, env, slug, rest, url) {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  }
  if (rest === "") {
    const location = "/book/" + slug + "/" + url.search;
    return new Response(null, { status: 308, headers: securityHeaders("text/plain; charset=utf-8", "no-store", { Location: location }) });
  }
  if (rest === "/") {
    const company = await publicBookingCompany(env, slug);
    const companyName = company ? publicCompanyName(company) : "";
    const brand = await renderedBrand(env, company);
    const mapsOn = !!(company && mapsBrowserKey(env));
    // The browser key is referrer-restricted, so with maps on the page sends its origin (only) to Google.
    const headers = mapsOn ? securityHeaders("text/html; charset=utf-8", "no-store", { "referrer-policy": "strict-origin-when-cross-origin" }, CSP_BOOK_MAPS) : securityHeaders("text/html; charset=utf-8", "no-store");
    return new Response(bookPageHtml(companyName, brand ? brandChrome(brand).header : company && company.theme_color, mapsOn), { status: 200, headers });
  }
  if (rest === "/theme.css") {
    const company = await publicBookingCompany(env, slug);
    const brand = await renderedBrand(env, company);
    const css = company ? (brand ? brandCss(brand) : themeCss(company.theme_color || "")) : "";
    return new Response(css, { status: 200, headers: securityHeaders("text/css; charset=utf-8", "no-store") });
  }
  if (rest === "/manifest.webmanifest") return serveBookingManifest(env, slug);
  if (rest === "/qr" || rest === "/qr/" || rest === "/qr.png" || rest === "/qr.svg" || rest === "/qr/manifest.webmanifest" || rest === "/qr/sw.js" || rest === "/qr/theme.css") {
    return serveBookingQr(env, slug, rest, url);
  }
  if (rest === "/sw.js") {
    const company = await publicBookingCompany(env, slug);
    if (!company) return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
    return new Response(bookServiceWorker(), { status: 200, headers: securityHeaders("text/javascript; charset=utf-8", "no-store") });
  }
  const icons = {
    "/icon-192.png": { size: 192, maskable: false, fallback: icon192 },
    "/icon-512.png": { size: 512, maskable: false, fallback: icon512 },
    "/icon-192-maskable.png": { size: 192, maskable: true, fallback: icon192Maskable },
    "/icon-512-maskable.png": { size: 512, maskable: true, fallback: icon512Maskable },
    "/apple-touch-icon.png": { size: 180, maskable: false, fallback: appleTouch }
  };
  if (icons[rest]) return serveBookingIcon(env, slug, icons[rest]);
  return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
}
__name(serveBookingAsset, "serveBookingAsset");
async function serveShell(request, env) {
  const url = new URL(request.url);
  const book = bookingPageMatch(url.pathname);
  if (book) return serveBookingAsset(request, env, book.slug, book.rest, url);
  if (url.pathname.startsWith(BRAND_FONT_PATH)) return serveBrandFont(url.pathname.slice(BRAND_FONT_PATH.length));
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/signup" || path === "/signup/complete") {
    return new Response(signupHtml, { status: 200, headers: securityHeaders("text/html; charset=utf-8", "no-cache", null, CSP_SIGNUP) });
  }
  const file = FILES[path] || (!path.includes(".") ? FILES["/index.html"] : void 0);
  if (!file) return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  // Owner/driver app with a browser key: Google's Maps JS allowlist for address suggestions, and the
  // page origin as referrer so the referrer-restricted key is accepted. Same policy as the booking page.
  if (file.body === indexHtml && mapsBrowserKey(env)) {
    return new Response(String(indexHtml).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, ""), { status: 200, headers: securityHeaders(file.type, file.cache, { "referrer-policy": "strict-origin-when-cross-origin" }, CSP_BOOK_MAPS) });
  }
  return new Response(file.body, { status: 200, headers: securityHeaders(file.type, file.cache) });
}
__name(serveShell, "serveShell");
var brandFontCache = new Map();
function serveBrandFont(name) {
  const b64 = Object.prototype.hasOwnProperty.call(BRAND_FONT_FILES, name) ? BRAND_FONT_FILES[name] : null;
  if (!b64) return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  let bytes = brandFontCache.get(name);
  if (!bytes) {
    bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    brandFontCache.set(name, bytes);
  }
  return new Response(bytes, { status: 200, headers: securityHeaders("font/woff2", "public, max-age=31536000, immutable") });
}
__name(serveBrandFont, "serveBrandFont");
function securityHeaders(type, cache, extra, csp) {
  const headers = new Headers({
    "content-type": type,
    "cache-control": cache,
    "content-security-policy": csp || CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "geolocation=(self), camera=(), microphone=(), payment=()"
  });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return headers;
}
__name(securityHeaders, "securityHeaders");

// src/index.ts
var index_default = {
  async fetch(request, env, ctx) {
    if (ctx) REQUEST_CTX.set(request, ctx);
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      return handleApi(request, env);
    }
    return serveShell(request, env);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runFlightChecks(env).then((r) => console.log(JSON.stringify({ level: "info", msg: "flight checks", ...r }))).catch((error) => console.log(JSON.stringify({ level: "error", msg: "flight checks", name: error instanceof Error ? error.name : "Error" }))));
    ctx.waitUntil(runPayPalChecks(env).then((r) => console.log(JSON.stringify({ level: "info", msg: "paypal checks", ...r }))).catch((error) => console.log(JSON.stringify({ level: "error", msg: "paypal checks", name: error instanceof Error ? error.name : "Error" }))));
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
