import { Router } from 'express';
import { me, login, signup, logout, updatePassword } from '../controllers/auth.controller.js';

const router = Router();

// GET  /api/auth/me        current user (or null) and whether sign-up is open
// POST /api/auth/login     { email, password }
// POST /api/auth/signup    { email, password }  → role "user"
// POST /api/auth/logout
// POST /api/auth/password  { currentPassword, newPassword }
router.get('/auth/me', me);
router.post('/auth/login', login);
router.post('/auth/signup', signup);
router.post('/auth/logout', logout);
router.post('/auth/password', updatePassword);

export default router;
