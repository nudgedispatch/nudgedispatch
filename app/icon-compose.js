// Compose 192/512 (and other) PNG icons from a company logo data URL.
// PNG is supported (8-bit, non-interlaced). JPEG/WebP logos fall back to the caller.
"use strict";

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function putU32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

async function inflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { kind, bytes };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(data, width, height, bpp) {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let src = 0;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    const type = data[src++];
    if (type === 0) {
      out.set(data.subarray(src, src + stride), dst);
    } else if (type === 1) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? out[dst + x - bpp] : 0;
        out[dst + x] = (data[src + x] + left) & 255;
      }
    } else if (type === 2) {
      for (let x = 0; x < stride; x++) {
        const up = y > 0 ? out[dst + x - stride] : 0;
        out[dst + x] = (data[src + x] + up) & 255;
      }
    } else if (type === 3) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? out[dst + x - bpp] : 0;
        const up = y > 0 ? out[dst + x - stride] : 0;
        out[dst + x] = (data[src + x] + ((left + up) >> 1)) & 255;
      }
    } else if (type === 4) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? out[dst + x - bpp] : 0;
        const up = y > 0 ? out[dst + x - stride] : 0;
        const ul = y > 0 && x >= bpp ? out[dst + x - stride - bpp] : 0;
        out[dst + x] = (data[src + x] + paeth(left, up, ul)) & 255;
      }
    } else {
      return null;
    }
    src += stride;
    dst += stride;
  }
  return out;
}

function toRgba(pixels, width, height, colorType, bits, palette, trns) {
  const rgba = new Uint8Array(width * height * 4);
  if (bits !== 8) return null;
  if (colorType === 6) {
    rgba.set(pixels);
    return rgba;
  }
  if (colorType === 2) {
    for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 3, q += 4) {
      rgba[q] = pixels[p];
      rgba[q + 1] = pixels[p + 1];
      rgba[q + 2] = pixels[p + 2];
      rgba[q + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 0) {
    for (let i = 0, q = 0; i < width * height; i++, q += 4) {
      const v = pixels[i];
      rgba[q] = v;
      rgba[q + 1] = v;
      rgba[q + 2] = v;
      rgba[q + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 4) {
    for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 2, q += 4) {
      const v = pixels[p];
      rgba[q] = v;
      rgba[q + 1] = v;
      rgba[q + 2] = v;
      rgba[q + 3] = pixels[p + 1];
    }
    return rgba;
  }
  if (colorType === 3 && palette) {
    for (let i = 0, q = 0; i < width * height; i++, q += 4) {
      const idx = pixels[i];
      rgba[q] = palette[idx * 3];
      rgba[q + 1] = palette[idx * 3 + 1];
      rgba[q + 2] = palette[idx * 3 + 2];
      rgba[q + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
    return rgba;
  }
  return null;
}

export async function decodePng(bytes) {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return null;
  let width = 0;
  let height = 0;
  let bits = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return null;
    if (type === "IHDR") {
      if (length !== 13) return null;
      width = u32(bytes, start);
      height = u32(bytes, start + 4);
      bits = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
      if (bytes[start + 10] !== 0 || bytes[start + 11] !== 0) return null;
    } else if (type === "PLTE") {
      palette = bytes.slice(start, end);
    } else if (type === "tRNS") {
      trns = bytes.slice(start, end);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (!width || !height || width > 2048 || height > 2048 || interlace || bits !== 8) return null;
  const bppMap = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bpp = bppMap[colorType];
  if (!bpp) return null;
  let total = 0;
  for (const part of idat) total += part.length;
  const compressed = new Uint8Array(total);
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }
  let inflated;
  try {
    inflated = await inflateZlib(compressed);
  } catch {
    return null;
  }
  const raw = unfilter(inflated, width, height, bpp);
  if (!raw) return null;
  const rgba = toRgba(raw, width, height, colorType, bits, palette, trns);
  if (!rgba) return null;
  return { width, height, rgba };
}

export async function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const compressed = await deflateZlib(raw);
  const ihdr = new Uint8Array(13);
  putU32(ihdr, 0, width);
  putU32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array(0))];
  let size = 8;
  for (const c of chunks) size += c.length;
  const out = new Uint8Array(size);
  out.set(PNG_SIG, 0);
  let offset = 8;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  putU32(out, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8), 0);
  crcInput.set(data, 4);
  putU32(out, 8 + data.length, crc32(crcInput));
  return out;
}

function sample(rgba, width, height, x, y) {
  const ix = x < 0 ? 0 : x > width - 1 ? width - 1 : x;
  const iy = y < 0 ? 0 : y > height - 1 ? height - 1 : y;
  const i = (iy * width + ix) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

function blitContain(src, sw, sh, dst, size, box) {
  const scale = Math.min(box / sw, box / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const ox = Math.floor((size - dw) / 2);
  const oy = Math.floor((size - dh) / 2);
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const c00 = sample(src, sw, sh, x0, y0);
      const c10 = sample(src, sw, sh, x0 + 1, y0);
      const c01 = sample(src, sw, sh, x0, y0 + 1);
      const c11 = sample(src, sw, sh, x0 + 1, y0 + 1);
      const di = ((oy + y) * size + (ox + x)) * 4;
      const srcA = (c00[3] * (1 - fx) * (1 - fy) + c10[3] * fx * (1 - fy) + c01[3] * (1 - fx) * fy + c11[3] * fx * fy) / 255;
      for (let k = 0; k < 3; k++) {
        const srcC = c00[k] * (1 - fx) * (1 - fy) + c10[k] * fx * (1 - fy) + c01[k] * (1 - fx) * fy + c11[k] * fx * fy;
        dst[di + k] = Math.round(srcC * srcA + dst[di + k] * (1 - srcA));
      }
      dst[di + 3] = 255;
    }
  }
}

const BG = [11, 11, 11, 255];

export async function composeLogoIcon(dataUrl, size, maskable) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || parsed.kind !== "png") return null;
  const img = await decodePng(parsed.bytes);
  if (!img) return null;
  const canvas = new Uint8Array(size * size * 4);
  for (let i = 0; i < canvas.length; i += 4) {
    canvas[i] = BG[0];
    canvas[i + 1] = BG[1];
    canvas[i + 2] = BG[2];
    canvas[i + 3] = 255;
  }
  // Maskable safe zone is a centered circle of radius 40% of the width.
  // Fit the logo in ~72% of the canvas so it stays inside that circle.
  const box = Math.max(1, Math.floor(size * (maskable ? 0.72 : 0.86)));
  blitContain(img.rgba, img.width, img.height, canvas, size, box);
  return encodePng(canvas, size, size);
}
