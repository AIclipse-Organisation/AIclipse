"use client";
import { useState } from "react";
import { Button } from "@heroui/react";
import PostCreator from "./PostCreator";
import ReportedPostsList from "./ReportedPostsList";

export default function PostManagement() {
  const [activeView, setActiveView] = useState("creator");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* REDUCED HEADER SECTION */}
      <div className="flex-shrink-0 flex flex-col md:flex-row md:items-end justify-between gap-1 mb-12">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic leading-none">
            {activeView === "creator" ? "Post Creator" : "Moderation Queue"}
          </h2>
          <p className="text-gray-400 font-semibold uppercase text-sm tracking-wide">
            {activeView === "creator"
              ? "Upload authenticated images to train the community."
              : "Review and resolve community reports."}
          </p>
        </div>

        <div className="flex bg-black/40 p-2 rounded-3xl border border-white/5 shadow-xl">
          <Button
            size="sm"
            onPress={() => setActiveView("creator")}
            className={`font-black px-10 rounded-2xl transition-all uppercase text-sm tracking-wide h-12 ${activeView === "creator" ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-transparent text-gray-500 hover:text-white"
              }`}
          >
            Create
          </Button>
          <Button
            size="sm"
            onPress={() => setActiveView("reports")}
            className={`font-black px-10 rounded-2xl transition-all uppercase text-sm tracking-wide h-12 ${activeView === "reports" ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-transparent text-gray-500 hover:text-white"
              }`}
          >
            Reports
          </Button>
        </div>
      </div>

      <div className="flex-grow overflow-hidden relative">
        {activeView === "creator" ? <PostCreator /> : <ReportedPostsList />}
      </div>
    </div>
  );
}
