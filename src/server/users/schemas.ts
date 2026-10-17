import { z } from "zod";
import { ROLES } from "@/domain/access/roles";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const roleSchema = z.enum(ROLES);
const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  email: emailSchema,
  role: roleSchema,
  password: newPasswordSchema,
});

export const resetPasswordSchema = z.object({ password: newPasswordSchema });

export const uuidSchema = z.uuid();

/** Login fields are not held to the password policy, so a wrong guess never reveals the rules. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export { roleSchema };
