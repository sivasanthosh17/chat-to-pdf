/**
 * create-user.mjs — create an account from the command line (e.g. the first admin).
 *
 *   npm run user:create -- --email you@example.com --role admin
 *
 * The password is read from the NEW_USER_PASSWORD environment variable or,
 * if that is not set, asked for interactively (input hidden). It is never
 * accepted as a command-line argument, which would leave it in shell history.
 */

import 'dotenv/config';
import { createInterface } from 'node:readline';
import { openDatabase } from '../src/db/database.js';
import { createUser, findUserByEmail } from '../src/services/users.service.js';
import { SignupSchema } from '../src/schemas/auth.schema.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '*');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const email = arg('email');
const role = arg('role') || 'user';
if (!email || !['user', 'admin'].includes(role)) {
  console.error('Usage: npm run user:create -- --email you@example.com [--role user|admin]');
  process.exit(2);
}

let password = process.env.NEW_USER_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('Set NEW_USER_PASSWORD, or run this in an interactive terminal to be asked for it.');
    process.exit(2);
  }
  password = await askHidden('Password (at least 10 characters): ');
}

const parsed = SignupSchema.safeParse({ email, password });
if (!parsed.success) {
  console.error(parsed.error.errors[0].message);
  process.exit(2);
}

const db = openDatabase();
if (findUserByEmail(db, parsed.data.email)) {
  console.error(`An account for ${parsed.data.email} already exists.`);
  process.exit(1);
}
const user = await createUser(db, { ...parsed.data, role });
console.log(`Created ${user.role} account ${user.email} (id ${user.id}).`);
db.close();
