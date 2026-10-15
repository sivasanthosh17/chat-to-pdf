import { Router } from 'express';
import healthRoute from './health.route.js';
import validateRoute from './validate.route.js';
import extractRoute from './extract.route.js';
import convertRoute from './convert.route.js';
import authRoute from './auth.route.js';
import adminRoute from './admin.route.js';

const router = Router();

// Mount routes (which ones need a login or the admin role is decided in app.js
// and admin.route.js)
router.use('/', healthRoute);
router.use('/', authRoute);
router.use('/', validateRoute);
router.use('/', extractRoute);
router.use('/', convertRoute);
router.use('/', adminRoute);

export default router;
