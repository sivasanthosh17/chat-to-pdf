import { Router } from 'express';
import { validateUrl, getPlatforms } from '../controllers/validate.controller.js';

const router = Router();

// POST /api/validate-url
router.post('/validate-url', validateUrl);

// GET /api/platforms
router.get('/platforms', getPlatforms);

export default router;
