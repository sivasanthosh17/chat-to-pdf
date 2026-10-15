import { z } from 'zod';

const email = z
  .string({ required_error: 'Email is required.' })
  .trim()
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.');

export const newPassword = z
  .string({ required_error: 'Password is required.' })
  .min(10, 'Use at least 10 characters for your password.')
  .max(200, 'Password is too long.');

export const CredentialsSchema = z.object({
  email,
  password: z.string({ required_error: 'Password is required.' }).min(1, 'Password is required.').max(200)
});

export const SignupSchema = z.object({ email, password: newPassword });

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(200),
  newPassword
});

export const AdminCreateUserSchema = z.object({
  email,
  password: newPassword,
  role: z.enum(['user', 'admin']).default('user')
});

export const AdminUpdateUserSchema = z
  .object({
    role: z.enum(['user', 'admin']).optional(),
    disabled: z.boolean().optional()
  })
  .strict()
  .refine((v) => v.role !== undefined || v.disabled !== undefined, 'Nothing to change.');

/** Parses `body` or throws a 400 with the first validation message. */
export function parseOrThrow(schema, body, AppErrorClass) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new AppErrorClass('INVALID_REQUEST', parsed.error.errors[0]?.message || 'Invalid request.');
  return parsed.data;
}
