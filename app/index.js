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
var PROGRESS_STEPS = ["", "En route", "Picked up", "Completed"];
var STEP_BUTTON = {
  "En route": "On my way",
  "Picked up": "Picked up",
  Completed: "Dropped off \xB7 complete ride"
};
var STEP_NOW = {
  "": "Not started",
  "En route": "On the way to pickup",
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
function mapsDirectionsUrl(address) {
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(address);
}
__name(mapsDirectionsUrl, "mapsDirectionsUrl");
function rideSchedule(ride) {
  const progress = isProgressStep(ride.progress) ? ride.progress : "";
  const index = stepIndex(progress);
  const next = index >= 0 && index < PROGRESS_STEPS.length - 1 ? PROGRESS_STEPS[index + 1] : null;
  const previous = index > 0 ? PROGRESS_STEPS[index - 1] : null;
  const plannedPickupAt = zonedWallToUnix(ride.pickupDate, ride.pickupTime);
  const navAddress = progress === "En route" ? ride.pickup : progress === "Picked up" || progress === "Completed" ? ride.dropoff : "";
  const navLabel = progress === "En route" ? "Navigate to pickup" : navAddress ? "Navigate to drop-off" : "";
  return {
    progress,
    now: ride.status === "requested" ? "Requested" : ride.status === "declined" ? "Declined" : STEP_NOW[progress],
    nextStep: ride.status === "scheduled" ? next : null,
    nextLabel: next && ride.status === "scheduled" ? STEP_BUTTON[next] : null,
    undoStep: ride.status === "cancelled" || ride.status === "requested" || ride.status === "declined" ? null : previous,
    plannedPickupAt,
    plannedDropoffAt: null,
    enRouteAt: ride.enRouteAt,
    pickedUpAt: ride.pickedUpAt,
    droppedOffAt: ride.completedAt,
    enRouteLabel: ride.enRouteAt === null ? null : formatEt(ride.enRouteAt),
    pickedUpLabel: ride.pickedUpAt === null ? null : formatEt(ride.pickedUpAt),
    droppedOffLabel: ride.completedAt === null ? null : formatEt(ride.completedAt),
    toPickupMinutes: minutesBetween(ride.enRouteAt, ride.pickedUpAt),
    tripMinutes: minutesBetween(ride.pickedUpAt, ride.completedAt),
    waitingMinutes: null,
    nav: navAddress ? { label: navLabel, url: mapsDirectionsUrl(navAddress) } : null
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
var LOCKED_ALLOWED = new Set(["/api/trial", "/api/billing", "/api/export/rides.csv", "/api/export/clients.csv"]);
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
    updatedAt: row.updated_at
  };
}
__name(clientJson, "clientJson");
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
    miles: q.miles ?? null
  };
}
__name(rideQuoteJson, "rideQuoteJson");
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
    flightAlert: row.flight_alert ? { kind: row.flight_alert_kind, message: row.flight_alert, at: row.flight_alert_at } : null,
    updatedAt: row.updated_at,
    ...owner ? { clientId: row.client_id, clientPhone: row.client_phone || "", clientEmail: row.client_email || "", fareCents: row.fare_cents, fare: money(row.fare_cents), notes: row.notes, payment: row.payment, source: row.source || "", quote: rideQuoteJson(row) } : {},
    schedule: rideSchedule({
      pickupDate: row.pickup_date,
      pickupTime: row.pickup_time,
      pickup: row.pickup,
      dropoff: row.dropoff,
      progress: row.progress || "",
      status,
      enRouteAt: row.en_route_at,
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

var BOOKING_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var BOOKING_RESERVED = new Set(["book", "api", "admin", "login", "settings", "rides", "clients", "icons", "brand", "www", "app", "demo", "static", "assets", "public", "health", "start", "where", "index", "manifest", "sw", "new", "invoice", "invoices"]);
function slugBase(name) {
  const s = str(name, 80).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return s.length >= 2 ? s : "book";
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
            c.trial_days, c.trial_ended_at, c.trial_end_reason, c.stripe_customer_id, c.stripe_subscription_id, c.billing_status, c.billing_past_due_at, c.billing_paid_through, c.billing_last_paid_at, c.billing_event_at, c.billing_updated_at, s.business_name, s.logo_data_url, s.phone AS contact_phone, s.email AS contact_email
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

// ---- Free trial (draft, Nov 10, 2026): 15 completed rides or 30 days, whichever comes first ----
var TRIAL_COLS = "c.id, c.created_at, c.trial_status, c.trial_started_at, c.trial_ride_limit, c.trial_days, c.trial_ended_at, c.trial_end_reason";
async function companyTrial(env, companyId, row) {
  const company = row && row.trial_status !== void 0 ? row : await env.DB.prepare(`SELECT ${TRIAL_COLS} FROM companies c WHERE c.id = ?`).bind(companyId).first();
  if (!company) return null;
  const completed = await count(env, "SELECT COUNT(*) AS n FROM rides WHERE company_id = ? AND status = 'completed'", companyId);
  const now = Date.now();
  const t = trialState(company, completed, now);
  if (t.newlyEnded) {
    // Record the end once, so undoing a drop-off later does not quietly reopen the trial.
    await env.DB.prepare("UPDATE companies SET trial_status = 'ended', trial_ended_at = ?, trial_end_reason = ? WHERE id = ? AND trial_status = 'trial'").bind(now, t.endedReason, companyId).run();
  }
  return t;
}
__name(companyTrial, "companyTrial");
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
  const t = await companyTrial(env, user.companyId);
  if (!t) return fail(404, "Company not found.");
  return json({ ok: true, trial: trialJson(t), banner: trialBanner(t) });
}
__name(getTrial, "getTrial");
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
    return json({ ok: true, open: false, companyName: publicCompanyName(company), logoDataUrl: company.logo_data_url || "", quotes: null, closed: publicPausedView(company) });
  }
  const trial = await companyTrial(env, company.id, company);
  const settings = await loadBookingSettings(env, company.id);
  if (trial && !trial.open) {
    return json({
      ok: true,
      open: false,
      companyName: publicCompanyName(company),
      logoDataUrl: company.logo_data_url || "",
      quotes: null,
      closed: publicClosedView(company)
    });
  }
  return json({
    ok: true,
    open: true,
    companyName: publicCompanyName(company),
    logoDataUrl: company.logo_data_url || "",
    quotes: await publicQuoteInfo(env, company.id, settings),
    airports: publicAirportInfo(settings.airports),
    capacities: settings.capacities,
    places: placesEnabled(env)
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
  const q = sheet ? await quoteTrip(env, request, company.id, sheet, trip) : null;
  const quoted = q && q.available ? q : null;
  const now = Date.now();
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
    `INSERT INTO rides (id, company_id, client_id, driver_user_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight, fare_cents, notes, status, payment, created_at, updated_at, approval, source, trip_type, vehicle_name, hours, quote_cents, quote_json, airport_json, luggage)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, 'scheduled', 'unpaid', ?, ?, 'requested', 'booking-page', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    rideId, company.id, clientId, date, time, pickup, dropoff, passengers, flight, notes, now, now,
    trip.tripType, trip.vehicleName, trip.tripType === "hourly" ? trip.hours : null,
    quoted ? quoted.totalCents : null,
    quoted ? JSON.stringify({ v: 1, basis: quoted.basis, label: quoted.label, vehicle: quoted.vehicle, lines: quoted.lines, notes: quoted.notes, miles: quoted.miles ?? null, minutes: quoted.minutes ?? null, at: now }) : null,
    placed.airport ? JSON.stringify(placed.airport) : null,
    luggageRaw
  ).run();
  const view = quoted ? quoteView(quoted, publicCompanyName(company)) : null;
  return json({
    ok: true,
    companyName: publicCompanyName(company),
    estimate: view ? { total: view.total, estimate: view.estimate, label: view.label, confirm: view.confirm } : null,
    trip: { pickup, dropoff, vehicle: trip.vehicleName || "", airport: placed.airport ? airportSummary(placed.airport) : "", meeting: riderMeetingNote(placed.airport) }
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
// Road distance. Google Routes API (Compute Routes Essentials) when the GOOGLE_MAPS_SERVER_KEY
// secret is set; otherwise no distance, and the quote falls back to flat fares / hourly / "operator
// will confirm". QUOTE_DEV_FAKE_ROUTE=1 (local .dev.vars only, and only on localhost) returns a
// made-up distance so the distance path can be tested without a key.
function routingProvider(env, request) {
  if (env.GOOGLE_MAPS_SERVER_KEY) return "google";
  if (env.QUOTE_DEV_FAKE_ROUTE === "1") {
    const host = new URL(request.url).hostname;
    if (host === "127.0.0.1" || host === "localhost") return "fake";
  }
  return "none";
}
__name(routingProvider, "routingProvider");
async function routeMiles(env, request, companyId, pickup, dropoff) {
  const provider = routingProvider(env, request);
  if (provider === "none") return null;
  const a = pickup.toLowerCase().replace(/\s+/g, " ").trim();
  const b = dropoff.toLowerCase().replace(/\s+/g, " ").trim();
  if (a.length < 4 || b.length < 4 || a === b) return null;
  if (provider === "fake") {
    if (/far away/.test(a + " " + b)) return { miles: 640, minutes: 560 };
    const h = parseInt((await sha256Hex(a + "|" + b)).slice(0, 6), 16);
    const miles = 5 + (h % 350) / 10;
    return { miles, minutes: Math.round(miles * 1.6) };
  }
  const cacheKey = new Request("https://route-cache.nudgedispatch.invalid/v1/" + await sha256Hex(provider + "|" + a + "|" + b));
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
  // Cost guard: at most 500 uncached lookups per company per day (well inside Google's 10,000 free/month for one busy company).
  if (!await limitHit(env, "route:" + companyId, 500, 24 * 60 * 60 * 1e3)) return null;
  let result = null;
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_MAPS_SERVER_KEY, "x-goog-fieldmask": "routes.distanceMeters,routes.duration" },
      // TRAFFIC_UNAWARE + only distance/duration keeps this on the Compute Routes Essentials SKU.
      body: JSON.stringify({ origin: { address: pickup }, destination: { address: dropoff }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", regionCode: "us", units: "IMPERIAL" }),
      signal: AbortSignal.timeout(4e3)
    });
    if (r.ok) {
      const j = await r.json();
      const route = j && j.routes && j.routes[0];
      if (route && route.distanceMeters > 0) {
        const secs = parseInt(String(route.duration || "0").replace("s", ""), 10) || 0;
        result = { miles: Math.round(route.distanceMeters / 160.9344) / 10, minutes: Math.round(secs / 60) };
      }
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
__name(routeMiles, "routeMiles");
async function quoteTrip(env, request, companyId, sheet, trip) {
  if (!sheet || !trip.vehicle) return null;
  const req = { tripType: trip.tripType || "one-way", vehicle: trip.vehicle, pickup: trip.pickup, dropoff: trip.dropoff, hours: trip.hours, passengers: trip.passengers };
  const route = needsDistance(sheet, req) ? await routeMiles(env, request, companyId, trip.pickup, trip.dropoff) : null;
  return computeQuote(sheet, req, route);
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
  const settings = await loadBookingSettings(env, company.id);
  const classes = await fleetClassSet(env, company.id);
  const offered = offeredVehicles(saved.sheet, classes, settings.capacities);
  const vehicleRow = offered.find((v) => v.id === str(body.vehicle, 40)) || vehicleForPassengers(offered, Number(body.passengers ?? 1), settings.capacities);
  const placed = applyAirportChoice(body, settings, vehicleRow ? vehicleRow.name : "");
  if (placed.error) return json({ ok: true, quote: null });
  const trip = readTrip({ ...body, pickup: placed.pickup, dropoff: placed.dropoff, vehicle: vehicleRow ? vehicleRow.id : "" }, saved.sheet);
  const q = await quoteTrip(env, request, company.id, saved.sheet, trip);
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
  return json({ ok: true, settings: { airports: s.airports, capacities: s.capacities, flightRules: s.flightRules }, fleetClasses: [...classes], flightTracking: flightProvider(env).ready, presets: ["ATL"] });
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
  const q = await quoteTrip(env, request, user.companyId, saved.sheet, trip);
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

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (method === "GET" && path === "/api/health") return json({ ok: true, service: "nudge-app" });
  // Stripe calls this directly (no X-Nudge-Client header); it is authenticated by the Stripe-Signature HMAC instead.
  if (path === "/api/stripe/webhook" && method === "POST") {
    try { return await stripeWebhook(request, env); } catch (error) {
      console.log(JSON.stringify({ level: "error", msg: "stripe webhook", name: error instanceof Error ? error.name : "Error" }));
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
    if (path === "/api/platform/billing" && method === "GET") return platformBillingStatus(request, env);
    if (path === "/api/platform/billing/sms-meter" && method === "POST") return platformSetupSmsMeter(request, env);
    if (path === "/api/invites/peek" && method === "POST") return peekInvite(request, env);
    if (path === "/api/sms/status" && method === "GET") return smsStatus(request, env);
    const rideText = /^\/api\/rides\/([0-9a-f-]{36})\/text$/.exec(path);
    if (rideText && method === "POST") return postRideText(request, env, rideText[1]);
    if (path === "/api/billing" && method === "GET") return ownerBilling(request, env);
    if (path === "/api/billing/portal" && method === "POST") return billingPortal(request, env);
    if (path === "/api/invites/accept" && method === "POST") return acceptInvite(request, env);
    if (path === "/api/login" && method === "POST") return login(request, env);
    if (path === "/api/logout" && method === "POST") return logout(request, env);
    if (path === "/api/me" && method === "GET") return me(request, env);
    if (path === "/api/trial" && method === "GET") return getTrial(request, env);
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
    const invoiceGet = /^\/api\/invoices\/([0-9a-f-]{36})$/.exec(path);
    if (invoiceGet && method === "GET") return getInvoice(request, env, invoiceGet[1]);
    if (path === "/api/location" && method === "GET") return getLocation(request, env);
    if (path === "/api/location/sharing" && method === "POST") return setSharing(request, env);
    if (path === "/api/location" && method === "POST") return postLocation(request, env);
    if (path === "/api/location/links" && method === "POST") return createLocationLink(request, env);
    const revokeLink = /^\/api\/location\/links\/([0-9a-f-]{36})\/revoke$/.exec(path);
    if (revokeLink && method === "POST") return revokeLocationLink(request, env, revokeLink[1]);
    const viewLink = /^\/api\/location\/view\/([A-Za-z0-9_-]{20,})$/.exec(path);
    if (viewLink && method === "GET") return viewLocation(env, viewLink[1]);
    if (path === "/api/settings" && method === "GET") return getSettings(request, env);
    if (path === "/api/settings" && method === "PUT") return putSettings(request, env);
    if (path === "/api/rate-sheet" && method === "GET") return getRateSheet(request, env);
    if (path === "/api/rate-sheet" && method === "PUT") return putRateSheet(request, env);
    if (path === "/api/rate-sheet/preview" && method === "POST") return previewRateSheet(request, env);
    if (path === "/api/booking-settings" && method === "GET") return getBookingSettings(request, env);
    if (path === "/api/booking-settings" && method === "PUT") return putBookingSettings(request, env);
    const publicPlaces = /^\/api\/public\/book\/([^/]+)\/places$/.exec(path);
    if (publicPlaces && method === "POST") return postPublicPlaces(request, env, decodeURIComponent(publicPlaces[1]));
    const publicQuote = /^\/api\/public\/book\/([^/]+)\/quote$/.exec(path);
    if (publicQuote && method === "POST") return postPublicQuote(request, env, decodeURIComponent(publicQuote[1]));
    const publicBook = /^\/api\/public\/book\/([^/]+)$/.exec(path);
    if (publicBook && method === "GET") return getPublicBook(request, env, decodeURIComponent(publicBook[1]));
    if (publicBook && method === "POST") return postPublicBook(request, env, decodeURIComponent(publicBook[1]));
    const approveMatch = /^\/api\/rides\/([0-9a-f-]{36})\/approve$/.exec(path);
    if (approveMatch && method === "POST") return decideBooking(request, env, approveMatch[1], "approve");
    const declineMatch = /^\/api\/rides\/([0-9a-f-]{36})\/decline$/.exec(path);
    if (declineMatch && method === "POST") return decideBooking(request, env, declineMatch[1], "decline");
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
    `SELECT ${TRIAL_COLS}, c.name, c.status, c.booking_slug,
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
  return json({ ok: true, betaSpots: { limit: BETA_SPOTS, onTrial }, companies });
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
  return trialChange(request, env, id);
}
__name(platformTrialChange, "platformTrialChange");
async function trialChange(request, env, id) {
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const row = await adminTrialRow(env, id);
  if (!row) return fail(404, "No company with that id.");
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
    ["Date", "Time", "Client", "Client phone", "Client email", "Pickup", "Drop-off", "Passengers", "Flight", "Status", "Fare", "Estimate", "Payment", "Trip type", "Vehicle", "Hours", "Notes", "Source"],
    (rows.results || []).map((r) => [r.pickup_date, r.pickup_time, r.client_name, r.client_phone, r.client_email, r.pickup, r.dropoff, r.passengers, r.flight,
      displayRideStatus(r), (r.fare_cents / 100).toFixed(2), r.quote_cents === null || r.quote_cents === void 0 ? "" : (r.quote_cents / 100).toFixed(2),
      r.payment, TRIP_LABELS[r.trip_type] || "", r.vehicle_name || "", r.hours ?? "", r.notes, r.source || ""]));
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
    `SELECT c.id, c.name, c.kind, c.status, c.created_at, c.billing_plan, c.sms_addon_enabled, c.stripe_customer_id, c.stripe_subscription_id, c.billing_status, c.billing_paid_through, c.billing_last_paid_at, c.billing_past_due_at, c.billing_event_at, c.billing_updated_at,
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
  return json({ ok: true, accounts });
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
  if (existing.stripe_subscription_id && planOf(existing) !== billingPlan) return fail(409, "This company has a Stripe test subscription. Plan changes on a subscription are not built yet; cancel it in the Stripe test dashboard first.");
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

// ---- Plan billing + SMS texting add-on (DRAFT, Stripe TEST MODE only) ----
// Texting (sending SMS) is NOT built. These endpoints only store the choice and keep the
// Stripe test subscription in step with it.
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
    `SELECT id, name, kind, billing_plan, sms_addon_enabled, sms_setup_billed_at, stripe_customer_id, stripe_subscription_id, billing_status, billing_paid_through, billing_last_paid_at FROM companies WHERE id = ?`
  ).bind(id).first();
}
__name(billingRow, "billingRow");
function stripeFail(error) {
  if (error instanceof StripeError) return fail(error.status === 503 ? 503 : 502, "Stripe (test mode): " + error.message);
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
  return json({ ok: true, billing: { plan: b.plan, planLabel: b.planLabel, smsAddon: b.smsAddon, smsAllowed: b.smsAllowed, smsPriceText: b.smsPriceText, smsNote: b.smsNote, monthlyEstimate: b.monthlyEstimate, canManageBilling: !!row.stripe_customer_id } });
}
__name(ownerBilling, "ownerBilling");
// Stripe customer portal (TEST MODE): card update + invoice history only. Owner only; needs the company's Stripe customer.
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
    await writeAudit(env, user.userId, "billing.portal", "company", row.id, { mode: "test" });
    return json({ ok: true, url: session.url });
  } catch (error) {
    if (error instanceof StripeError) return fail(502, "Could not open the billing page. Try again, or email nudgedispatch@gmail.com.");
    throw error;
  }
}
__name(billingPortal, "billingPortal");
// Authenticated self-check (signed with the webhook secret, so only Stripe's signer or we can call it). Reports classes only, never values.
async function stripeSelfCheck(env) {
  const key = typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY : "";
  const keyClass = !key ? "empty" : (["sk_test_", "rk_test_", "sk_live_", "rk_live_"].find((p) => key.startsWith(p)) || "other");
  const out = { keyClass, keyLength: key.length > 90 ? "long" : key.length > 0 ? "short" : "none", stripe: "not-tried", portalConfig: env.STRIPE_PORTAL_CONFIGURATION ? "set" : "unset", portal: "not-tried" };
  if (stripeKeyProblem(env)) return out;
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
  const problem = stripeKeyProblem(env);
  return json({ ok: true, stripeConnected: !problem, testMode: true, problem });
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
  const enabled = body.enabled;
  if (enabled && !smsAllowed(plan)) return fail(400, "The texting add-on is for Small fleet and Fleet plans only.");
  if (enabled && !payingNow(row)) return fail(409, SMS_NOT_PAYING_NOTE);
  const now = Date.now();
  let stripeNote = "No Stripe subscription yet, so only the account setting changed.";
  let setupBilledAt = row.sms_setup_billed_at || null;
  if (row.stripe_subscription_id) {
    try {
      const sub = await liveSubscription(env, row.stripe_subscription_id);
      if (sub && sub.status === "incomplete") return fail(409, "The first invoice on this Stripe test subscription is not paid yet, so Stripe won't allow line-item changes. Pay it (or let it expire) and try again.");
      if (sub) {
        const prices = await pricesByLookup(env, smsLookupKeys());
        const missing = smsLookupKeys().filter((k) => !prices[k]);
        if (enabled && missing.length) return fail(409, "Stripe test catalog is missing texting prices: " + missing.join(", ") + ". Use \"Set up texting meter\" first.");
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
            await stripe(env, "POST", "/v1/invoiceitems", { customer: sub.customer, subscription: sub.id, pricing: { price: prices[LOOKUP.sms.setup] }, metadata: { app: "nudge-dispatch", company_id: row.id } }, `sms-setup-${row.id}`);
            setupBilledAt = now;
          }
          stripeNote = "Texting items added to the Stripe test subscription.";
        } else {
          for (const it of present) {
            await stripe(env, "DELETE", "/v1/subscription_items/" + encodeURIComponent(it.id), { proration_behavior: "create_prorations" });
          }
          stripeNote = "Texting items removed from the Stripe test subscription.";
        }
      } else {
        stripeNote = "The Stripe test subscription is canceled, so only the account setting changed.";
      }
    } catch (error) {
      return stripeFail(error);
    }
  }
  await env.DB.prepare("UPDATE companies SET sms_addon_enabled = ?, sms_addon_updated_at = ?, sms_setup_billed_at = ?, billing_updated_at = ? WHERE id = ?")
    .bind(enabled ? 1 : 0, now, setupBilledAt, now, id).run();
  await writeAudit(env, user.userId, enabled ? "sms.on" : "sms.off", "company", id, { name: row.name, plan, stripe: row.stripe_subscription_id ? "synced" : "none" });
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
  const beta = body.beta === true;
  try {
    if (await liveSubscription(env, row.stripe_subscription_id)) return fail(409, "This company already has a Stripe test subscription.");
    const L = LOOKUP[plan];
    const prices = await pricesByLookup(env, [L.base, L.extra, L.setup, ...(sms ? smsLookupKeys() : [])]);
    let promoId = "";
    if (beta) {
      const promos = await stripe(env, "GET", "/v1/promotion_codes", { code: BETA_PROMO_CODE, active: true, limit: 1 });
      promoId = (promos.data && promos.data[0] && promos.data[0].id) || "";
      if (!promoId) return fail(409, "Promotion code " + BETA_PROMO_CODE + " was not found in Stripe test mode.");
    }
    const drivers = await driverCountFor(env, id);
    const built = subscriptionPlanItems(plan, drivers, sms, prices, beta, promoId);
    if (built.missing.length) return fail(409, "Stripe test catalog is missing prices: " + built.missing.join(", ") + (sms ? ". If it is the texting overage, use \"Set up texting meter\" first." : "."));
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
      metadata: { app: "nudge-dispatch", company_id: row.id, plan, sms: sms ? "on" : "off" },
      expand: ["latest_invoice"]
    }, `nudge-sub-${row.id}-${Date.now()}`);
    const now = Date.now();
    await env.DB.prepare("UPDATE companies SET stripe_customer_id = ?, stripe_subscription_id = ?, stripe_livemode = 0, billing_updated_at = ?, sms_setup_billed_at = COALESCE(sms_setup_billed_at, ?), billing_status = ?, billing_past_due_at = NULL, sms_addon_enabled = 0 WHERE id = ?")
      .bind(customerId, sub.id, now, sms ? now : null, subStatusToBilling(sub.status) || "incomplete", id).run();
    await writeAudit(env, user.userId, "billing.subscribe", "company", id, { name: row.name, plan, sms: sms ? "on" : "off", beta: beta ? "yes" : "no", mode: "test" });
    const inv = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
    return json({ ok: true, id, subscriptionId: sub.id, status: sub.status, invoiceUrl: (inv && inv.hosted_invoice_url) || "", amountDue: inv ? inv.amount_due : null, testMode: true }, 201);
  } catch (error) {
    return stripeFail(error);
  }
}
__name(platformStartSubscription, "platformStartSubscription");
// One-time catalog step: Stripe meters can't be made from the connector, so the app makes the
// texting meter + the $0.03/text-after-500 metered price itself (test key only). Idempotent.
async function platformSetupSmsMeter(request, env) {
  const user = await platformUser(request, env, true);
  if (isResponse(user)) return user;
  const problem = stripeKeyProblem(env);
  if (problem) return fail(503, problem.replace(" Texting was saved on the account only.", ""));
  try {
    const existing = await pricesByLookup(env, [LOOKUP.sms.overage]);
    if (existing[LOOKUP.sms.overage]) return json({ ok: true, created: false, priceId: existing[LOOKUP.sms.overage] });
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
    if (!product) return fail(409, "Stripe test product for extra texts (metadata tier=sms_overage) was not found.");
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
    await writeAudit(env, user.userId, "billing.sms_meter", "platform", "", { meter: meter.id, price: price.id, mode: "test" });
    return json({ ok: true, created: true, meterId: meter.id, priceId: price.id }, 201);
  } catch (error) {
    return stripeFail(error);
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
  // Count it on the Stripe test meter (500 included, then $0.03). Skipped (kept for later) if not subscribed.
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

// ---- Stripe webhook (DRAFT, test mode). Verifies Stripe-Signature, idempotent by event id. ----
async function stripeWebhook(request, env) {
  const raw = await request.text();
  if (raw.length > 1e6) return fail(413, "Too large.");
  const problem = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET || "");
  if (problem) return fail(400, "Invalid signature.");
  let event;
  try { event = JSON.parse(raw); } catch { return fail(400, "Bad payload."); }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") return fail(400, "Bad payload.");
  if (event.type === "nudge.self_check") return json({ received: true, selfCheck: await stripeSelfCheck(env) });
  const now = Date.now();
  // Test-mode build: never act on live-mode events.
  if (event.livemode === true) return json({ received: true, ignored: "livemode event" });
  if (!HANDLED_EVENTS.includes(event.type)) return json({ received: true, ignored: "event type not handled" });
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type, livemode, received_at) VALUES (?, ?, 0, ?)").bind(event.id, event.type, now).run();
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
  const refs = refsOf(event.type, obj);
  if (!refs.customer && !refs.subscription) return { result: "ignored: no customer" };
  const company = await env.DB.prepare(
    `SELECT id, name, stripe_customer_id, stripe_subscription_id, billing_event_at FROM companies
     WHERE (stripe_subscription_id IS NOT NULL AND stripe_subscription_id = ?) OR (stripe_customer_id IS NOT NULL AND stripe_customer_id = ?)
     ORDER BY CASE WHEN stripe_subscription_id = ? THEN 0 ELSE 1 END LIMIT 1`
  ).bind(refs.subscription || "", refs.customer || "", refs.subscription || "").first();
  if (!company) return { result: "ignored: unknown customer" };
  // A different (older) subscription for the same customer must not change the current one's status.
  if (refs.subscription && company.stripe_subscription_id && refs.subscription !== company.stripe_subscription_id) return { companyId: company.id, result: "ignored: not the current subscription" };
  const createdMs = Number(event.created || 0) * 1000;
  const stale = company.billing_event_at && createdMs && createdMs < company.billing_event_at;
  const now = Date.now();
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const through = paidThroughMs(obj);
    // Paid dates always move forward; status only if this event is not older than the last applied one.
    await env.DB.prepare(
      `UPDATE companies SET billing_last_paid_at = MAX(COALESCE(billing_last_paid_at, 0), ?),
         billing_paid_through = CASE WHEN ? IS NULL THEN billing_paid_through ELSE MAX(COALESCE(billing_paid_through, 0), ?) END,
         billing_updated_at = ? WHERE id = ?`
    ).bind(createdMs || now, through, through, now, company.id).run();
    if (stale) return { companyId: company.id, result: "paid recorded (older event, status kept)" };
    await env.DB.prepare("UPDATE companies SET billing_status = 'active', billing_past_due_at = NULL, billing_event_at = ?, trial_status = 'active' WHERE id = ?").bind(createdMs || now, company.id).run();
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
    return { companyId: company.id, result: "canceled" };
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
          "INSERT INTO users (id, company_id, email, password_hash, password_salt, password_iterations, password_kdf, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(userId, company.id, invite.email, hashed.hash, hashed.salt, hashed.iterations, PASSWORD_KDF, now, now),
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
        env.DB.prepare("INSERT INTO companies (id, name, created_at, kind, trial_started_at, billing_plan, sms_addon_enabled, sms_addon_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(companyId, invite.company_name || "My car service", now, kind, now, billingPlan, smsChoice, now),
        env.DB.prepare(
          "INSERT INTO users (id, company_id, email, password_hash, password_salt, password_iterations, password_kdf, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(userId, companyId, invite.email, hashed.hash, hashed.salt, hashed.iterations, PASSWORD_KDF, now, now),
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
  return json({ ok: true, ...publicUser(user) });
}
__name(me, "me");
async function authed(request, env, mutate) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  if (user.platformAdmin) return fail(404, "Not found.");
  if (user.access && user.access.locked) {
    const path = new URL(request.url).pathname;
    const allowed = (request.method === "GET" && LOCKED_ALLOWED.has(path)) || (request.method === "POST" && path === "/api/billing/portal");
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
  const rows = await env.DB.prepare(
    "SELECT id, name, phone, email, notes, created_at, updated_at FROM clients WHERE company_id = ? ORDER BY name COLLATE NOCASE"
  ).bind(user.companyId).all();
  return json({ ok: true, clients: (rows.results || []).map(clientJson) });
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
  return env.DB.prepare(
    "SELECT id, name, phone, email, notes, created_at, updated_at FROM clients WHERE company_id = ? AND id = ?"
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
  return json({ ok: true, client: clientJson(row) });
}
__name(getClient, "getClient");
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
async function deleteClient(request, env, id) {
  const user = await authed(request, env, true);
  if (isResponse(user)) return user;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const existing = await ownedClient(env, user.companyId, id);
  if (!existing) return fail(404, "Client not found.");
  const ride = await env.DB.prepare("SELECT id FROM rides WHERE company_id = ? AND client_id = ?").bind(user.companyId, id).first();
  if (ride) return fail(409, "This client has rides, so the record stays.");
  await env.DB.prepare("DELETE FROM clients WHERE company_id = ? AND id = ?").bind(user.companyId, id).run();
  return json({ ok: true });
}
__name(deleteClient, "deleteClient");
var RIDE_SELECT = `SELECT r.id, r.client_id, c.name AS client_name, c.phone AS client_phone, c.email AS client_email, r.pickup_date, r.pickup_time, r.pickup, r.dropoff,
  r.passengers, r.flight, r.fare_cents, r.notes, r.status, r.payment, r.progress, r.en_route_at, r.picked_up_at, r.completed_at,
  r.driver_user_id, drv.name AS assigned_driver_name, r.created_at, r.updated_at, r.approval, r.source, r.trip_type, r.vehicle_name, r.hours, r.quote_cents, r.quote_json,
  r.airport_json, r.luggage,
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
  return { error: "", fields: { client_id: clientId, pickup_date: date, pickup_time: time, pickup, dropoff, passengers, flight, fare_cents: fare, notes } };
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
    `INSERT INTO rides (id, company_id, client_id, driver_user_id, pickup_date, pickup_time, pickup, dropoff, passengers, flight, fare_cents, notes, status, payment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 'unpaid', ?, ?)`
  ).bind(id, user.companyId, f.client_id, user.accountKind === "individual" ? user.userId : null, f.pickup_date, f.pickup_time, f.pickup, f.dropoff, f.passengers, f.flight, f.fare_cents, f.notes, now, now).run();
  const row = await ownedRide(env, user, id);
  return json({ ok: true, ride: row ? rideJson(row, user.role) : null }, 201);
}
__name(createRide, "createRide");
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
    notes: body.notes ?? existing.notes
  });
  if (!parsed.fields) return fail(400, parsed.error);
  const client = await ownedClient(env, user.companyId, parsed.fields.client_id);
  if (!client) return fail(404, "Client not found.");
  const now = Date.now();
  const f = parsed.fields;
  await env.DB.prepare(
    `UPDATE rides SET client_id = ?, pickup_date = ?, pickup_time = ?, pickup = ?, dropoff = ?, passengers = ?, flight = ?,
      fare_cents = ?, notes = ?, payment = ?, updated_at = ? WHERE company_id = ? AND id = ?`
  ).bind(f.client_id, f.pickup_date, f.pickup_time, f.pickup, f.dropoff, f.passengers, f.flight, f.fare_cents, f.notes, payment, now, user.companyId, id).run();
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
      `UPDATE rides SET progress = ?, status = ?, en_route_at = COALESCE(en_route_at, ?), picked_up_at = COALESCE(picked_up_at, ?),
        completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE company_id = ? AND id = ? AND progress = ? AND status != 'cancelled'`
    ).bind(
      step,
      step === "Completed" ? "completed" : "scheduled",
      stamp("En route"),
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
        picked_up_at = CASE WHEN ? = 'Picked up' THEN NULL ELSE picked_up_at END,
        completed_at = CASE WHEN ? = 'Completed' THEN NULL ELSE completed_at END,
        updated_at = ?
       WHERE company_id = ? AND id = ? AND progress = ?`
    ).bind(step, current, current, current, now, companyId, existing.id, current).run();
  }
  if (!result.meta.changes) {
    const raced = await ownedRide(env, user, existing.id);
    if (raced && !undo && raced.progress === step) return json({ ok: true, ride: rideJson(raced, user.role) });
    return fail(409, "That step is out of order. Refresh the ride and try the next one.");
  }
  const row = await ownedRide(env, user, existing.id);
  return json({ ok: true, ride: row ? rideJson(row, user.role) : null });
}
__name(applyProgress, "applyProgress");
function invoiceText(settings, ride, number, issuedOn) {
  const contact = [settings.address, settings.phone, settings.email, settings.website].filter(Boolean).join(" | ");
  const trip = [
    `Date / time: ${longDate(ride.pickup_date)}, ${time12(ride.pickup_time)}`,
    `Pickup: ${ride.pickup}`,
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
    pickedUpAt: ride.picked_up_at,
    completedAt: ride.completed_at
  });
  if (clock.enRouteLabel) trip.push(`On my way: ${clock.enRouteLabel} ET`);
  if (clock.pickedUpLabel) trip.push(`Picked up: ${clock.pickedUpLabel} ET`);
  if (clock.droppedOffLabel) trip.push(`Dropped off: ${clock.droppedOffLabel} ET`);
  if (clock.toPickupMinutes !== null) trip.push(`On my way to pickup: ${clock.toPickupMinutes} min`);
  if (clock.tripMinutes !== null) trip.push(`Trip: ${clock.tripMinutes} min`);
  const pay = settings.payment_instructions || "Pay the operator directly. This invoice is not sent for you.";
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
    "How to pay",
    pay,
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
            s.business_name, s.address, s.phone, s.email, s.website, s.payment_instructions, s.gratuity_note, s.terms, s.logo_data_url
     FROM invoices i JOIN invoice_settings s ON s.company_id = i.company_id
     WHERE i.company_id = ? AND i.id = ?`
  ).bind(user.companyId, id).first();
  if (!row) return fail(404, "Invoice not found.");
  return json({
    ok: true,
    invoice: {
      id: row.id,
      rideId: row.ride_id,
      number: row.number,
      amountCents: row.amount_cents,
      fare: money(Number(row.amount_cents)),
      issuedOn: row.issued_on,
      snapshotText: row.snapshot_text,
      billTo: { name: row.bill_name, phone: row.bill_phone, email: row.bill_email },
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
  let logo = existing.logo_data_url;
  if (body.logoDataUrl !== void 0) {
    if (body.logoDataUrl === "") logo = "";
    else if (typeof body.logoDataUrl !== "string" || body.logoDataUrl.length > 18e4 || !LOGO_RE.test(body.logoDataUrl)) {
      return fail(400, "The logo must be a PNG, JPG, or WebP image under about 120 KB.");
    } else logo = body.logoDataUrl;
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE invoice_settings SET business_name = ?, address = ?, phone = ?, email = ?, website = ?, payment_instructions = ?,
      gratuity_note = ?, terms = ?, prefix = ?, next_number = ?, logo_data_url = ?, updated_at = ? WHERE company_id = ?`
  ).bind(businessName, address, phone, email, website, paymentInstructions, gratuityNote, terms, prefix, nextNumber, logo, now, user.companyId).run();
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

// src/shell.ts
import indexHtml from "./index.html";
import appCss from "./app.css";
import appJs from "./client-app.txt";
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
import { validateRateSheet, sheetForEditor, publicSheetInfo, computeQuote, needsDistance, formatCents, TRIP_TYPES, TRIP_LABELS } from "./quote-engine.js";
import { trialState, trialBanner, trialBlockedMessage, applyTrialChange, trialJson, BETA_SPOTS } from "./trial.js";
import { billingAccess, billingBanner, lockedView, lockedMessage } from "./access.js";
import { normPlan, planOf, kindForPlan, smsAllowed, smsOn, billingJson, payingNow, smsEnableProblem, SMS_NOT_PAYING_NOTE, stripe, stripeKeyProblem, StripeError, pricesByLookup, subscriptionPlanItems, smsLookupKeys, reportSmsUsage, LOOKUP, BETA_PROMO_CODE, SMS_METER_EVENT, SMS_PRICE_TEXT, SMS_COMING_SOON, PLAN_LABELS } from "./billing.js";
import { verifyStripeSignature, HANDLED_EVENTS, subStatusToBilling, refsOf, paidThroughMs } from "./stripe_webhook.js";
import { usCanadaE164, onMyWayMessage, sendBlandSms, textingProblem, recipientProblem, smsMode } from "./sms.js";
import { isListedPlatformAdmin } from "./platform-admin.js";
import { driverFields, passcodeProblem, isRosterEmail, rosterEmailFor } from "./drivers.js";
import { validateAirportConfig, validateCapacities, publicAirportInfo, readAirportChoice, airportSummary, riderMeetingNote, parseStoredAirport, fleetClasses, bookableVehicles, vehiclesForPassengers, vehicleForPassengers, seatsFor, vehicleClassOf, presetConfig, DEFAULT_CAPACITIES } from "./airport-booking.js";
import { flightProvider, fetchFlightSnapshot, flightAlerts, flightRules, normalizeFlight, shouldWatch } from "./flight-alerts.js";
var CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
var FILES = {
  "/": { body: indexHtml, type: "text/html; charset=utf-8", cache: "no-cache" },
  "/index.html": { body: indexHtml, type: "text/html; charset=utf-8", cache: "no-cache" },
  "/app.css": { body: appCss, type: "text/css; charset=utf-8", cache: "public, max-age=300" },
  "/app.js": { body: appJs, type: "text/javascript; charset=utf-8", cache: "no-cache" },
  "/sw.js": { body: swJs, type: "text/javascript; charset=utf-8", cache: "no-cache" },
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
  "/book.js": { body: bookJs, type: "text/javascript; charset=utf-8", cache: "no-store" }
};
function assetTag(s) {
  let h = 0;
  const text = String(s);
  for (let i = 0; i < text.length; i++) h = Math.imul(31, h) + text.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
__name(assetTag, "assetTag");
var BOOK_JS_SRC = "/book.js?v=" + assetTag(bookJs);
function bookPageHtml() {
  return bookHtml.replace('src="/book.js"', 'src="' + BOOK_JS_SRC + '"');
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
function bookingShortName(name) {
  const text = String(name || "").trim() || "Book a ride";
  if (text.length <= 12) return text;
  const first = text.split(/\s+/)[0];
  if (first.length >= 3 && first.length <= 12) return first;
  return text.slice(0, 12).trim();
}
__name(bookingShortName, "bookingShortName");
async function serveBookingManifest(env, slug) {
  const company = await publicBookingCompany(env, slug);
  if (!company) return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  const companyName = publicCompanyName(company);
  const base = "/book/" + slug + "/";
  const body = JSON.stringify({
    id: base,
    name: companyName + " \u2014 Book a ride",
    short_name: bookingShortName(companyName),
    description: "Request a ride with " + companyName.replace(/\.+$/, "") + ".",
    start_url: base,
    scope: base,
    display: "standalone",
    background_color: "#0b0b0b",
    theme_color: "#0b0b0b",
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
    return new Response(bookPageHtml(), { status: 200, headers: securityHeaders("text/html; charset=utf-8", "no-store") });
  }
  if (rest === "/manifest.webmanifest") return serveBookingManifest(env, slug);
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
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const file = FILES[path] || (!path.includes(".") ? FILES["/index.html"] : void 0);
  if (!file) return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8", "no-store") });
  return new Response(file.body, { status: 200, headers: securityHeaders(file.type, file.cache) });
}
__name(serveShell, "serveShell");
function securityHeaders(type, cache, extra) {
  const headers = new Headers({
    "content-type": type,
    "cache-control": cache,
    "content-security-policy": CSP,
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      return handleApi(request, env);
    }
    return serveShell(request, env);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runFlightChecks(env).then((r) => console.log(JSON.stringify({ level: "info", msg: "flight checks", ...r }))).catch((error) => console.log(JSON.stringify({ level: "error", msg: "flight checks", name: error instanceof Error ? error.name : "Error" }))));
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
