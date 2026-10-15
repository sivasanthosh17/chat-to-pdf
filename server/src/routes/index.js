import { Router } from 'express';
import healthRoute from './health.route.js';
import validateRoute from './validate.route.js';
import extractRoute from './extract.route.js';
import convertRoute from './convert.route.js';

const router = Router();

// Mount routes
router.use('/', healthRoute);
router.use('/', validateRoute);
router.use('/', extractRoute);
router.use('/', convertRoute);

export default router;

