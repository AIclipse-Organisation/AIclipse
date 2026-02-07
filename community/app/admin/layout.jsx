"use client";
import { HeroUIProvider } from "@heroui/react";

export default function AdminLayout({ children }) {
  return (
    <HeroUIProvider>
      <div className="flex min-h-screen bg-gray-50">
        <aside className="w-64 bg-white border-r p-6 hidden md:block">
          <h2 className="text-xl font-bold mb-8">Admin</h2>
          <nav className="flex flex-col gap-2">
            <a href="/admin" className="p-2 hover:bg-gray-100 rounded">Dashboard</a>
            <a href="/admin/reports" className="p-2 hover:bg-gray-100 rounded">Reports</a>
            <a href="/" className="p-2 hover:bg-gray-100 rounded text-gray-400">Exit</a>
          </nav>
        </aside>

        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </HeroUIProvider>
  );
}