import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-user-password", SALT_ROUNDS);

export function validatePassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 8 && password.length <= 72;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string | null): Promise<boolean> {
  // Perform a bcrypt comparison for unknown/Google-only accounts as well to reduce email enumeration timing differences.
  const matches = await bcrypt.compare(password, passwordHash ?? DUMMY_PASSWORD_HASH);
  return Boolean(passwordHash) && matches;
}
