"use client";
import { useState } from "react";
import ModelManagement from "./components/ModelManagement";
import PostManagement from "./components/PostManagement";
import UserManagement from "./components/UserManagement";

export default function AdminPage() {
  const [activeView, setActiveView] = useState("model_management");

  const getLinkClass = (viewName) =>
    `h-11 px-4 rounded-2xl cursor-pointer transition-all text-left font-black uppercase text-xs md:text-sm tracking-wide whitespace-nowrap ${activeView === viewName
      ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10"
      : "text-gray-500 hover:bg-white/5 hover:text-[#CFB87C]"
    }`;

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden md:flex-row md:gap-6">
      <aside className="w-full bg-[#1a1a1a] border border-white/5 p-4 md:p-8 flex flex-col md:h-full rounded-[1.75rem] md:rounded-[2.5rem] shadow-2xl md:w-72">
        <div className="mb-4 md:mb-12 px-2">
          <h2 className="text-2xl font-black text-white italic tracking-tighter">
            Admin<span className="text-[#CFB87C]">.</span>
          </h2>
        </div>

        <nav className="flex gap-2 flex-1 overflow-x-auto pb-1 md:pb-0 md:flex-col md:overflow-visible">
          <button className={getLinkClass("model_management")} onClick={() => setActiveView("model_management")}>
            Model Management
          </button>
          <button className={getLinkClass("user_management")} onClick={() => setActiveView("user_management")}>
            User Management
          </button>
          <button className={getLinkClass("post_management")} onClick={() => setActiveView("post_management")}>
            Post Management
          </button>
        </nav>

        <div className="hidden md:block mt-auto pt-6 border-t border-white/5">
          <a href="/" className="flex items-center gap-2 p-3 rounded-xl hover:bg-red-500/10 text-gray-500 hover:text-red-500 transition-all text-sm font-black uppercase tracking-wide">
            ← Exit System
          </a>
        </div>
      </aside>

      <main className="flex-1 min-w-0 h-full overflow-hidden">
        {activeView === "model_management" && <ModelManagement />}
        {activeView === "user_management" && <UserManagement />}
        {activeView === "post_management" && <PostManagement />}
      </main>
    </div>
  );
}