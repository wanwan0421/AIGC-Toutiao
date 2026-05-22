import { createHash } from "node:crypto";

export const DEFAULT_USER_EMAIL = "creator@example.com";
export const DEFAULT_USER_PASSWORD = "123456";

export function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

export const DEFAULT_USER = {
  email: DEFAULT_USER_EMAIL,
  passwordHash: hashPassword(DEFAULT_USER_PASSWORD),
  nickname: "Luna Studio",
  avatarUrl: ""
};
