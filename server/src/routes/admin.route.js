import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  getStats, getUsers, getUserActivity, getFailures, postUser, patchUser, removeUser,
  exportUsage, exportUsers, getHealth, putHealthLinks, postHealthRun
} from '../controllers/admin.controller.js';

const router = Router();

// Every admin route requires the "admin" role
router.use('/admin', requireAdmin);

router.get('/admin/stats', getStats);
router.get('/admin/failures', getFailures);

router.get('/admin/users', getUsers);
router.post('/admin/users', postUser);
router.get('/admin/users/:id/activity', getUserActivity);
router.patch('/admin/users/:id', patchUser);
router.delete('/admin/users/:id', removeUser);

router.get('/admin/export/usage.csv', exportUsage);
router.get('/admin/export/users.csv', exportUsers);

router.get('/admin/health', getHealth);
router.put('/admin/health/links', putHealthLinks);
router.post('/admin/health/run', postHealthRun);

export default router;
