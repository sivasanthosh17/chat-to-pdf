import { AppError } from '../utils/errors.js';
import { CredentialsSchema, SignupSchema, ChangePasswordSchema, parseOrThrow } from '../schemas/auth.schema.js';
import { authenticate, createUser, changePassword, toPublicUser } from '../services/users.service.js';
import { createSession, deleteSession, hashToken } from '../services/session.service.js';
import { setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

function startSession(req, res, user) {
  // A fresh token on every login (no session fixation)
  if (req.sessionToken) deleteSession(req.app.locals.db, req.sessionToken);
  const { token } = createSession(req.app.locals.db, user.id);
  setSessionCookie(req, res, token);
}

export function signupAllowed() {
  return process.env.ALLOW_SIGNUP !== 'false';
}

/** GET /api/auth/me */
export function me(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: { user: req.user, signupAllowed: signupAllowed() } });
}

/** POST /api/auth/login { email, password } */
export async function login(req, res, next) {
  try {
    const { email, password } = parseOrThrow(CredentialsSchema, req.body, AppError);
    const user = await authenticate(req.app.locals.db, email, password);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Wrong email or password.');
    startSession(req, res, user);
    res.json({ success: true, data: { user: toPublicUser(user) } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/signup { email, password } — creates a "user" role account */
export async function signup(req, res, next) {
  try {
    if (!signupAllowed()) throw new AppError('FORBIDDEN', 'Sign-up is closed. Ask an administrator for an account.');
    const { email, password } = parseOrThrow(SignupSchema, req.body, AppError);
    const user = await createUser(req.app.locals.db, { email, password, role: 'user' });
    startSession(req, res, user);
    res.status(201).json({ success: true, data: { user: toPublicUser(user) } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/logout */
export function logout(req, res) {
  if (req.sessionToken) deleteSession(req.app.locals.db, req.sessionToken);
  clearSessionCookie(req, res);
  res.json({ success: true });
}

/** POST /api/auth/password { currentPassword, newPassword } */
export async function updatePassword(req, res, next) {
  try {
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'Please log in.');
    const { currentPassword, newPassword } = parseOrThrow(ChangePasswordSchema, req.body, AppError);
    await changePassword(req.app.locals.db, req.user.id, currentPassword, newPassword, hashToken(req.sessionToken));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
