import { Router } from 'express';
import { extractConversation } from '../controllers/extract.controller.js';

const router = Router();

// POST /api/extract
router.post('/extract', extractConversation);

export default router;
