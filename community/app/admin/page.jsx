"use client";
import { useState } from "react";
import { 
  Card, CardHeader, CardBody, 
  Divider, Badge, Button 
} from "@heroui/react";

// --- SUB-COMPONENT: Model Management ---
const ModelManagement = () => (
  <div className="flex flex-col gap-6 h-full overflow-y-auto">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="border-none bg-white shadow-sm" radius="lg">
        <CardBody className="gap-2"><p>Model Card 1</p></CardBody>
      </Card>
      <Card className="border-none bg-white shadow-sm" radius="lg">
        <CardBody className="gap-2"><p>Model Card 2</p></CardBody>
      </Card>
      <Card className="border-none bg-white shadow-sm" radius="lg">
        <CardBody className="gap-2"><p>Model Card 3</p></CardBody>
      </Card>
    </div>
    <Card className="flex-1 min-h-0 border-none shadow-sm" radius="lg">
      <CardHeader className="flex gap-3">
        <div className="flex flex-col"><p className="text-md font-bold">Model Logs</p></div>
      </CardHeader>
      <Divider />
      <CardBody className="bg-default-50/50 flex items-center justify-center italic text-default-400">
         <p>No active tasks.</p>
      </CardBody>
    </Card>
  </div>
);

// --- SUB-COMPONENT: Statistics ---
const Statistics = () => (
  <div className="flex flex-col gap-6 h-full overflow-y-auto">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="border-none bg-white shadow-sm" radius="lg">
         <CardBody className="gap-2"><p>Stats Card 1</p></CardBody>
      </Card>
      <Card className="border-none bg-white shadow-sm" radius="lg">
         <CardBody className="gap-2"><p>Stats Card 2</p></CardBody>
      </Card>
      <Card className="border-none bg-white shadow-sm" radius="lg">
         <CardBody className="gap-2"><p>Stats Card 3</p></CardBody>
      </Card>
    </div>
    <Card className="flex-1 min-h-0 border-none shadow-sm" radius="lg">
      <Divider />
      <CardBody className="bg-default-50/50 flex items-center justify-center italic text-default-400">
         <p>No data available.</p>
      </CardBody>
    </Card>
  </div>
);

// --- SUB-COMPONENT: User Management ---
const UserManagement = () => (
  <Card className="h-full border-none shadow-sm">
    <CardHeader><h2 className="text-xl font-bold">User Management</h2></CardHeader>
    <CardBody>
       <p>User management table will go here.</p>
    </CardBody>
  </Card>
);

// --- MAIN COMPONENT --- 
export default function AdminPage() {
  const [activeView, setActiveView] = useState("statistics");

  const getLinkClass = (viewName) => 
    `p-2 rounded cursor-pointer transition-colors text-left ${
      activeView === viewName 
        ? "bg-gray-100 text-black font-medium" 
        : "hover:bg-gray-50 text-gray-600"
    }`;

  return (
    <div className="flex h-full w-full gap-6">
      
      <aside className="w-64 bg-white border-r border-gray-200 p-6 hidden md:flex flex-col h-full rounded-2xl shadow-sm">
        <h2 className="text-xl font-bold mb-8 text-gray-800">Admin</h2>
        
        <nav className="flex flex-col gap-2 flex-1">
          {/* 1. STATISTICS */}
          <button 
            className={getLinkClass("statistics")}
            onClick={() => setActiveView("statistics")}
          >
            Statistics
          </button>

          {/* 2. MODEL MANAGEMENT */}
          <button 
            className={getLinkClass("model_management")}
            onClick={() => setActiveView("model_management")}
          >
            Model Management
          </button>

          {/* 3. USER MANAGEMENT */}
          <button 
            className={getLinkClass("user_management")}
            onClick={() => setActiveView("user_management")}
          >
            User Management
          </button>
        </nav>

        <div className="mt-auto pt-4 border-t border-gray-100">
           <a href="/" className="p-2 block hover:bg-gray-50 rounded text-gray-400 text-sm transition-colors">
             Exit Admin
           </a>
        </div>
      </aside>

      <main className="flex-1 min-w-0 h-full overflow-hidden">
        {activeView === "statistics" && <Statistics />}
        {activeView === "model_management" && <ModelManagement />}
        {activeView === "user_management" && <UserManagement />}
      </main>

    </div>
  );
}