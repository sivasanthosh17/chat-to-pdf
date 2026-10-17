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
    disabled: z.boolean().optional(),
    // null = use the site default; a number = custom PDFs per day
    dailyPdfLimit: z.number().int('Use a whole number.').min(0).max(10_000).nullable().optional(),
    unlimited: z.boolean().optional()
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.');

const shareLink = z.string().trim().max(2048).url('Enter a full https:// share link.').or(z.literal(''));

export const HealthLinksSchema = z
  .object({ chatgpt: shareLink.optional(), gemini: shareLink.optional(), claude: shareLink.optional() })
  .strict();

/** Parses `body` or throws a 400 with the first validation message. */
export function parseOrThrow(schema, body, AppErrorClass) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new AppErrorClass('INVALID_REQUEST', parsed.error.errors[0]?.message || 'Invalid request.');
  return parsed.data;
}
