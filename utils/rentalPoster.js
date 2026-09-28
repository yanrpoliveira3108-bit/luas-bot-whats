'use strict';

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const CONFIG = require('../config');
const logger = require('./logger').child('rentalPoster');

const ACTIVE = path.join(CONFIG.paths.rentalDir, 'poster.jpg');
const META = path.join(CONFIG.paths.rentalDir, 'poster.json');
const MAX_BYTES = 12 * 1024 * 1024;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function paths() { CONFIG.helpers.ensureDirs(); return { active: ACTIVE, meta: META }; }
function current() { paths(); if (!fs.existsSync(ACTIVE)) return null; let meta = {}; try { meta = JSON.parse(fs.readFileSync(META, 'utf8')); } catch (_) {} return { path: ACTIVE, ...meta }; }
async function validate(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES || !MIME.has(String(mime || '').toLowerCase())) throw new Error('RENTAL_IMAGE_INVALID');
  const image = await Jimp.read(buffer);
  if (!image.bitmap || !image.bitmap.width || !image.bitmap.height || image.bitmap.width > 10000 || image.bitmap.height > 10000) throw new Error('RENTAL_IMAGE_INVALID');
  return image;
}
async function update(buffer, mime, actor) {
  const image = await validate(buffer, mime);
  const { active, meta } = { active: ACTIVE, meta: META };
  CONFIG.helpers.ensureDirs();
  const stamp = `${process.pid}-${Date.now()}`;
  const tmp = path.join(CONFIG.paths.rentalDir, `.poster-${stamp}.tmp.jpg`);
  try {
    await image.quality(90).writeAsync(tmp);
    const stat = fs.statSync(tmp);
    if (!stat.size || stat.size > MAX_BYTES) throw new Error('RENTAL_IMAGE_INVALID');
    const record = { updatedAt: new Date().toISOString(), bytes: stat.size, width: image.bitmap.width, height: image.bitmap.height, mime: 'image/jpeg', updatedBy: String(actor || '') };
    // O arquivo validado só substitui o ativo depois de todos os checks.
    fs.renameSync(tmp, active);
    try {
      const metaTmp = `${meta}.${stamp}.tmp`;
      fs.writeFileSync(metaTmp, JSON.stringify(record, null, 2), 'utf8');
      fs.renameSync(metaTmp, meta);
    } catch (metaErr) {
      logger.warn({ err: metaErr.message }, '[RENTAL_POSTER_METADATA_ERROR] imagem ativa preservada');
    }
    logger.info({ bytes: stat.size, width: record.width, height: record.height }, '[RENTAL_POSTER_UPDATED]');
    return { path: active, ...record };
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}
module.exports = { ACTIVE, META, MAX_BYTES, validate, update, current };
