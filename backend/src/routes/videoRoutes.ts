import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router as ApiRouter } from 'express';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { ALLOWED_VIDEO_EXTENSIONS, secureExtension } from '../utils/files.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadVideo, acceptVideoUrl, analyzeVideo } from '../controllers/videoController.js';
import { rateLimit } from 'express-rate-limit';

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    fs.mkdirSync(config.files.uploadsDir, { recursive: true });
    cb(null, config.files.uploadsDir);
  },
  filename(_req, file, cb) {
    const ext = secureExtension(file.originalname) ?? '.mp4';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.limits.maxVideoBytes, files: 1, fields: 10 },
  fileFilter(_req, file, cb) {
    const ext = secureExtension(file.originalname);
    if (!ext) {
      cb(new AppError('UNSUPPORTED_FILE'));
      return;
    }
    const mime = (file.mimetype ?? '').toLowerCase();
    if (mime && !mime.startsWith('video/') && mime !== 'application/octet-stream') {
      cb(new AppError('UNSUPPORTED_FILE'));
      return;
    }
    cb(null, true);
  },
});

const analyzeLimiter = rateLimit({
  windowMs: config.limits.rateWindowMs,
  limit: config.limits.analyzeRateMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many analyze requests. Please wait a moment and try again.' } },
});

export const videoRoutes: Router = ApiRouter();

videoRoutes.post(
  '/upload',
  upload.single('video'),
  asyncHandler(uploadVideo),
);

videoRoutes.post(
  '/url',
  asyncHandler(acceptVideoUrl),
);

videoRoutes.post(
  '/analyze',
  analyzeLimiter,
  asyncHandler(analyzeVideo),
);

videoRoutes.get('/formats', (_req, res) => {
  res.json({ extensions: ALLOWED_VIDEO_EXTENSIONS, maxUploadMb: Math.round(config.limits.maxVideoBytes / (1024 * 1024)) });
});
