"use client";

import { usePathname } from "next/navigation";
import Topbar from "./Topbar";
import BottomNav from "./BottomNav";
import { HeroUIProvider } from "@heroui/react";

export default function ShellWrapper({ children, user }) {
  const pathname = usePathname();
  
  const isAdminRoute = pathname?.startsWith("/admin") || pathname?.startsWith("/community/admin");

  if (isAdminRoute) {
      return (
        <HeroUIProvider>
          <div className="fixed inset-0 flex flex-col bg-gray-50 overflow-hidden z-0">
            <header className="flex-none h-[56px] w-full border-b shadow-sm bg-white">
              <Topbar 
                isAdmin={user?.is_admin === true} 
                userName={user?.user_name || "Admin"} 
              />
            </header>

            <main className="flex-1 min-h-0 overflow-hidden p-4 md:p-8 relative z-0">
              <div className="max-w-7xl mx-auto h-full w-full">
                {children}
              </div>
            </main>
          </div>
        </HeroUIProvider>
      );
    }

  return (
    <div className="app">
      <div className="app-container">
        <Topbar 
          isAdmin={user?.role === "admin" || user?.is_admin === true} 
          userName={user?.user_name || "Guest"} 
        />

        <main className="screen">
          <section className="page-header" aria-label="Page title">
            <h1 className="page-title">Home</h1>
            <div className="page-underline" role="presentation" />
          </section>

          {children}
        </main>

        <BottomNav />
      </div>
    </div>
  );
}