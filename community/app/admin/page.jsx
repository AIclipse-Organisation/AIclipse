"use client";
import { useState } from "react";
import ModelManagement from "./components/ModelManagement";
import Statistics from "./components/Statistics.jsx";
import UserManagement from "./components/UserManagement"; 

export default function AdminPage() {
  const [activeView, setActiveView] = useState("statistics");

  const getLinkClass = (viewName) => 
    `p-3 rounded-xl cursor-pointer transition-all text-left font-medium ${
      activeView === viewName 
        ? "bg-gray-900 text-white shadow-md" 
        : "hover:bg-gray-100 text-gray-600"
    }`;

  return (
    <div className="flex h-screen w-full gap-6 p-6 bg-gray-50">

      <aside className="w-64 bg-white border border-gray-100 p-6 hidden md:flex flex-col h-full rounded-3xl shadow-xl shadow-gray-100/50">
        <div className="mb-8 px-2">
           <h2 className="text-2xl font-black text-gray-900 tracking-tight">Admin<span className="text-blue-500">.</span></h2>
        </div>
        
        <nav className="flex flex-col gap-2 flex-1">
          <button className={getLinkClass("statistics")} onClick={() => setActiveView("statistics")}>
            Statistics
          </button>
          <button className={getLinkClass("model_management")} onClick={() => setActiveView("model_management")}>
            Model Management
          </button>
          <button className={getLinkClass("user_management")} onClick={() => setActiveView("user_management")}>
            User Management
          </button>
        </nav>

        <div className="mt-auto pt-4 border-t border-gray-100">
           <a href="/" className="flex items-center gap-2 p-3 rounded-xl hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors text-sm font-medium">
             ← Exit Dashboard
           </a>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 h-full overflow-hidden">
        {activeView === "statistics" && <Statistics />}
        {activeView === "model_management" && <ModelManagement />}
        {activeView === "user_management" && <UserManagement />}
      </main>

    </div>
  );
}