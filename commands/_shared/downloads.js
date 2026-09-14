/**
 * commands/_shared/downloads.js — envio de mídia baixada + limpeza.
 */

'use strict';

const { deleteFile } = require('../../utils/download');

async function sendAudioResult(ctx, result) {
  try {
    await ctx.sendAudio(result.path, { mimetype: result.mimetype || 'audio/mp4', ptt: false });
  } finally {
    deleteFile(result.path);
  }
}

async function sendVideoResult(ctx, result, caption = '') {
  try {
    await ctx.sendVideo(result.path, caption, { mimetype: result.mimetype || 'video/mp4' });
  } finally {
    deleteFile(result.path);
  }
}

async function sendImageResult(ctx, result, caption = '') {
  try {
    await ctx.sendImage(result.path, caption);
  } finally {
    deleteFile(result.path);
  }
}

module.exports = { sendAudioResult, sendVideoResult, sendImageResult };
