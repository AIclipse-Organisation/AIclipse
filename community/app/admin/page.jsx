"use client";
import { useState } from "react";
import ModelManagement from "./components/ModelManagement";
import PostManagement from "./components/PostManagement";

export default function AdminPage() {
  const [activeView, setActiveView] = useState("model_management");

  const getLinkClass = (viewName) =>
    `p-4 rounded-2xl cursor-pointer transition-all text-left font-black uppercase text-sm tracking-wide ${activeView === viewName
      ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10"
      : "text-gray-500 hover:bg-white/5 hover:text-[#CFB87C]"
    }`;

  return (
    <div className="flex h-full w-full gap-6 overflow-hidden">
      {/* SIDEBAR: No white, rounded and floating from bottom */}
      <aside className="w-72 bg-[#1a1a1a] border border-white/5 p-8 flex flex-col h-full rounded-[2.5rem] shadow-2xl">
        <div className="mb-12 px-2">
          <h2 className="text-2xl font-black text-white italic tracking-tighter">
            Admin<span className="text-[#CFB87C]">.</span>
          </h2>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          <button className={getLinkClass("model_management")} onClick={() => setActiveView("model_management")}>
            Model Management
          </button>
          <button className={getLinkClass("post_management")} onClick={() => setActiveView("post_management")}>
            Post Management
          </button>
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5">
          <a href="/" className="flex items-center gap-2 p-3 rounded-xl hover:bg-red-500/10 text-gray-500 hover:text-red-500 transition-all text-sm font-black uppercase tracking-wide">
            ← Exit System
          </a>
        </div>
      </aside>

      <main className="flex-1 min-w-0 h-full">
        {activeView === "model_management" && <ModelManagement />}
        {activeView === "post_management" && <PostManagement />}
      </main>
    </div>
  );
}