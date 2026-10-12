import { Router } from 'express';
import { getJobStatus, getJobResults } from '../controllers/videoController.js';
import { getJobAudio } from '../controllers/jobController.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const jobRoutes: Router = Router();

jobRoutes.get('/:jobId', getJobStatus);
jobRoutes.get('/:jobId/results', getJobResults);
jobRoutes.get('/:jobId/audio', getJobAudio);
