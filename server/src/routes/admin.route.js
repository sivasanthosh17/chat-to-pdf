import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { getStats, getUsers, postUser, patchUser, removeUser } from '../controllers/admin.controller.js';

const router = Router();

// Every admin route requires the "admin" role
router.use('/admin', requireAdmin);

router.get('/admin/stats', getStats);
router.get('/admin/users', getUsers);
router.post('/admin/users', postUser);
router.patch('/admin/users/:id', patchUser);
router.delete('/admin/users/:id', removeUser);

export default router;
