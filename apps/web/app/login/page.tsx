"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail, Phone, UserRound } from "lucide-react";
import { login, logout, register, sendVerificationCode } from "../../lib/api";
import { useAuth } from "../../components/auth-provider";

type AuthMode = "login" | "register";
type RegisterMethod = "phone" | "email";

export default function LoginPage() {
  const router = useRouter();
  const { setSession, clearSession } = useAuth();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [registerMethod, setRegisterMethod] = useState<RegisterMethod>("phone");
  const [loginAccount, setLoginAccount] = useState("");
  const [registerAccount, setRegisterAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [nickname, setNickname] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [codeHint, setCodeHint] = useState("");

  const registerLabel = registerMethod === "phone" ? "手机号" : "邮箱";
  const registerPlaceholder = registerMethod === "phone" ? "请输入手机号" : "请输入邮箱";
  const registerIcon = registerMethod === "phone" ? <Phone className="h-4 w-4" /> : <Mail className="h-4 w-4" />;
  const passwordMismatch = mode === "register" && Boolean(confirmPassword) && password !== confirmPassword;

  useEffect(() => {
    setReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
  }, []);

  const canSubmit = useMemo(() => {
    if (!password) return false;
    if (mode === "login") return Boolean(loginAccount.trim());
    return Boolean(registerAccount.trim() && verificationCode.trim() && confirmPassword.trim() && !passwordMismatch);
  }, [confirmPassword, loginAccount, mode, password, passwordMismatch, registerAccount, verificationCode]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setCodeHint("");
    setConfirmPassword("");
    setShowPassword(false);
  }

  function switchRegisterMethod(nextMethod: RegisterMethod) {
    setRegisterMethod(nextMethod);
    setRegisterAccount("");
    setVerificationCode("");
    setCodeHint("");
    setError("");
  }

  async function handleSendVerificationCode() {
    if (!registerAccount.trim()) {
      setError(`请先填写${registerLabel}`);
      return;
    }

    setSendingCode(true);
    setError("");
    setCodeHint("");

    try {
      const result = await sendVerificationCode({ account: registerAccount.trim() });
      setCodeHint(
        result.delivery === "console"
          ? result.verificationCode
            ? `本次验证码：${result.verificationCode}`
            : "验证码已生成"
          : `验证码已发送至你的${registerLabel}`
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "验证码发送失败，请稍后重试");
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (mode === "register") {
        if (password !== confirmPassword) {
          throw new Error("两次输入的密码不一致");
        }

        await register({
          account: registerAccount.trim(),
          password,
          nickname,
          verificationCode: verificationCode.trim()
        });
        await logout().catch(() => undefined);
        clearSession();
        setMode("login");
        setLoginAccount(registerAccount.trim());
        setPassword("");
        setConfirmPassword("");
        setVerificationCode("");
        setNickname("");
        setError("");
        setCodeHint("注册成功，请使用新账号重新登录");
        return;
      } else {
        const response = await login({ account: loginAccount.trim(), password });
        setSession(response.user);
        router.replace(safeReturnTo(returnTo));
        return;
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败，请检查账号或稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex min-h-screen items-center justify-center bg-[#f6f7f9] px-4 py-8">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-2xl font-black text-slate-950">今日头条创作服务平台</h1>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {mode === "login" ? (
              <>
                <AuthField
                  icon={<UserRound className="h-4 w-4" />}
                  label="手机号或邮箱"
                  value={loginAccount}
                  onChange={setLoginAccount}
                  placeholder="请输入手机号或邮箱"
                />
                <AuthField
                  icon={<KeyRound className="h-4 w-4" />}
                  label="密码"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder="请输入密码"
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="flex items-center justify-center rounded-full p-1 text-slate-400 transition hover:text-rose-600"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => switchRegisterMethod("phone")}
                    className={`h-10 rounded-xl text-sm font-bold transition ${
                      registerMethod === "phone" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    手机号注册
                  </button>
                  <button
                    type="button"
                    onClick={() => switchRegisterMethod("email")}
                    className={`h-10 rounded-xl text-sm font-bold transition ${
                      registerMethod === "email" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    邮箱注册
                  </button>
                </div>

                <AuthField
                  icon={<UserRound className="h-4 w-4" />}
                  label="昵称"
                  value={nickname}
                  onChange={setNickname}
                  placeholder="请输入创作者昵称"
                />

                <AuthField
                  icon={registerIcon}
                  label={registerLabel}
                  value={registerAccount}
                  onChange={(value) => {
                    setRegisterAccount(value);
                    setCodeHint("");
                  }}
                  placeholder={registerPlaceholder}
                />

                <div className="grid gap-2">
                  <span className="text-sm font-bold text-slate-700">验证码</span>
                  <div className="flex gap-3">
                    <span className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 transition focus-within:border-rose-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-rose-50">
                      <CheckCircle2 className="h-4 w-4 text-slate-400" />
                      <input
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                        value={verificationCode}
                        onChange={(event) => setVerificationCode(event.target.value)}
                        placeholder="输入验证码"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSendVerificationCode()}
                      disabled={sendingCode || !registerAccount.trim()}
                      className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "获取验证码"}
                    </button>
                  </div>
                  {codeHint ? <p className="text-xs font-semibold text-emerald-600">{codeHint}</p> : null}
                </div>

                <AuthField
                  icon={<KeyRound className="h-4 w-4" />}
                  label="密码"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder="至少 8 位，包含字母和数字"
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="flex items-center justify-center rounded-full p-1 text-slate-400 transition hover:text-rose-600"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />

                <AuthField
                  icon={<KeyRound className="h-4 w-4" />}
                  label="确认密码"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="再次输入密码"
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="flex items-center justify-center rounded-full p-1 text-slate-400 transition hover:text-rose-600"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />
                {passwordMismatch ? (
                  <p className="-mt-3 text-xs font-semibold text-rose-600">两次输入的密码不一致，请重新确认。</p>
                ) : confirmPassword ? (
                  <p className="-mt-3 text-xs font-semibold text-emerald-600">两次密码一致</p>
                ) : null}
              </>
            )}

            {error ? <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div> : null}

            <button
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
              disabled={loading || !canSubmit}
              type="submit"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </form>

          {mode === "login" ? (
            <p className="mt-5 text-center text-sm text-slate-500">
              还没有账号？
              <button type="button" onClick={() => switchMode("register")} className="font-bold text-rose-600 hover:text-rose-700">
                立即注册
              </button>
            </p>
          ) : (
            <p className="mt-5 text-center text-sm text-slate-500">
              已有账号？
              <button type="button" onClick={() => switchMode("login")} className="font-bold text-rose-600 hover:text-rose-700">
                返回登录
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function safeReturnTo(value: string | null) {
  if (value?.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/studio/dashboard";
}

function AuthField({
  icon,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  trailing
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  trailing?: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <span className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 transition focus-within:border-rose-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-rose-50">
        <span className="text-slate-400">{icon}</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        {trailing ? <span className="shrink-0">{trailing}</span> : null}
      </span>
    </label>
  );
}
