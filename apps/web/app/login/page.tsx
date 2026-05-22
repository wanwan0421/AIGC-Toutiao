import Link from "next/link";

export default function LoginPage() {
  return (
    <section className="flex min-h-[calc(100vh-64px)] items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl flex overflow-hidden border border-slate-100">
        
        {/* 左侧：品牌宣发区 */}
        <div className="flex-1 bg-linear-to-br from-blue-600 to-indigo-900 p-12 text-white max-md:hidden flex flex-col justify-between relative overflow-hidden">
          {/* 背景装饰 */}
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-blue-400/20 rounded-full blur-3xl"></div>
          
          <div className="relative z-10">
            <h2 className="text-3xl font-black mb-4 tracking-tight">CreatorFlow Studio</h2>
            <p className="text-blue-100 text-sm leading-relaxed mb-6 font-medium">
              基于大模型的下一代智能图文生产中心，让内容创作与分发从未如此高效。
            </p>
            <div className="space-y-4 mt-12">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm backdrop-blur-sm">🚀</div>
                <span className="text-sm font-medium text-blue-50">一键生成结构化高质量长文</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm backdrop-blur-sm">🛡️</div>
                <span className="text-sm font-medium text-blue-50">内置安全审核与智能合规改写</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm backdrop-blur-sm">📊</div>
                <span className="text-sm font-medium text-blue-50">实时榜单数据反哺流量分发</span>
              </div>
            </div>
          </div>
          
          <div className="relative z-10 text-xs text-blue-200 mt-12 font-medium">
            © 2026 AI Creator Platform. All rights reserved.
          </div>
        </div>

        {/* 右侧：登录表单 */}
        <div className="w-full md:w-110 p-10 flex flex-col justify-center shrink-0">
          <div className="mb-8">
            <h1 className="text-2xl font-black text-slate-900 mb-2">欢迎回来</h1>
            <p className="text-sm text-slate-500 font-medium">登录你的创作者账号，开始今天的灵感之旅</p>
          </div>

          <form className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="account">
                账号 / 邮箱
              </label>
              <input
                className="w-full min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 placeholder:text-slate-400"
                id="account"
                placeholder="输入你的邮箱或手机号"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-bold text-slate-700" htmlFor="password">
                  密码
                </label>
                <a href="#" className="text-xs font-bold text-blue-600 hover:text-blue-700 transition">忘记密码？</a>
              </div>
              <input
                className="w-full min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 placeholder:text-slate-400"
                id="password"
                type="password"
                placeholder="••••••••"
              />
            </div>

            <div className="pt-2">
              <Link href="/dashboard" className="w-full block text-center rounded-xl bg-slate-900 px-5 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800 transition-all hover:shadow-md">
                安全登录
              </Link>
            </div>
            
            <div className="flex items-center justify-center gap-2 mt-4 text-sm text-slate-500">
              <span className="font-medium">还没有账号？</span>
              <a href="#" className="font-bold text-blue-600 hover:text-blue-700">立即注册</a>
            </div>
          </form>

          {/* 快捷登录或第三方占位 */}
          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-xs font-medium text-slate-400 mb-4 uppercase tracking-wider">其他登录方式</p>
            <div className="flex justify-center gap-3">
              <button className="w-12 h-12 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition" title="微信">💬</button>
              <button className="w-12 h-12 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition" title="飞书">🕊️</button>
              <button className="w-12 h-12 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition" title="Github">🐱</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
