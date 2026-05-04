"use client";
import { useState } from "react";
import { Button } from "@heroui/react";
import PostCreator from "./PostCreator";
import ReportedPostsList from "./ReportedPostsList";

export default function PostManagement() {
  const [activeView, setActiveView] = useState("creator");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex flex-col md:flex-row md:items-end justify-between gap-3 mb-5 md:mb-10">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl md:text-3xl font-black text-white tracking-tighter uppercase italic leading-none">
            {activeView === "creator" ? "Post Creator" : "Moderation Queue"}
          </h2>
          <p className="text-gray-400 font-semibold uppercase text-xs md:text-sm tracking-wide">
            {activeView === "creator"
              ? "Upload authenticated images to train the community."
              : "Review and resolve community reports."}
          </p>
        </div>

        <div className="flex bg-black/40 p-1.5 md:p-2 rounded-2xl md:rounded-3xl border border-white/5 shadow-xl w-full md:w-auto">
          <Button
            size="sm"
            onPress={() => setActiveView("creator")}
            className={`flex-1 md:flex-initial font-black px-4 md:px-10 rounded-xl md:rounded-2xl transition-all uppercase text-xs md:text-sm tracking-wide h-11 md:h-12 ${activeView === "creator" ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-transparent text-gray-500 hover:text-white"
              }`}
          >
            Create
          </Button>
          <Button
            size="sm"
            onPress={() => setActiveView("reports")}
            className={`flex-1 md:flex-initial font-black px-4 md:px-10 rounded-xl md:rounded-2xl transition-all uppercase text-xs md:text-sm tracking-wide h-11 md:h-12 ${activeView === "reports" ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-transparent text-gray-500 hover:text-white"
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
