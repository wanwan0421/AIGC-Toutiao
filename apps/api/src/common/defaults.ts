import * as bcrypt from "bcrypt";

export const DEFAULT_USER_EMAIL = "creator@example.com";
export const DEFAULT_USER_PASSWORD = "123456";

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10);
}

export const DEFAULT_USER = {
  accountNo: 100001,
  email: DEFAULT_USER_EMAIL,
  passwordHash: hashPassword(DEFAULT_USER_PASSWORD),
  nickname: "Luna Studio",
  avatarUrl: ""
};
