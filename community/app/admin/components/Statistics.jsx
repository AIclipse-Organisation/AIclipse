"use client";
import { Card, CardBody } from "@heroui/react";

export default function Statistics() {
  // Mock Data
  const stats = {
    users: { total: 1250 },
    content: { totalPosts: 8430 },
    engagement: { totalClicks: 45200 },
    system_health: {
      pending_writes: { clicks: 120, votes: 45, comments: 12 }
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Platform Overview</h2>
        <p className="text-gray-500 text-sm">Real-time system metrics and engagement.</p>
      </div>

      {/* Top Row: Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
            label="Total Users" 
            value={stats.users.total.toLocaleString()} 
            trend="+12% this week"
            color="text-blue-600"
        />
        <StatCard 
            label="Total Posts" 
            value={stats.content.totalPosts.toLocaleString()} 
            trend="+5% this week"
            color="text-purple-600"
        />
        <StatCard 
            label="Total Interactions" 
            value={stats.engagement.totalClicks.toLocaleString()} 
            trend="+8% this week"
            color="text-green-600"
        />
      </div>

      {/* Second Row: System Health */}
      <Card className="border-none shadow-sm bg-white" radius="lg">
        <CardBody className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
                <h4 className="text-lg font-bold text-gray-800">System Health</h4>
                <p className="text-xs text-gray-400">Redis write-buffer depth</p>
            </div>
            <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-xs font-medium text-green-600">Operational</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <QueueStat label="Pending Clicks" value={stats.system_health.pending_writes.clicks} />
             <QueueStat label="Pending Votes" value={stats.system_health.pending_writes.votes} />
             <QueueStat label="Pending Comments" value={stats.system_health.pending_writes.comments} />
          </div>
        </CardBody>
      </Card>
      
      {/* Placeholder for Charts */}
      <Card className="flex-1 min-h-[300px] border-none shadow-sm bg-gray-50 border-dashed border-2 border-gray-200" radius="lg">
        <CardBody className="flex flex-col items-center justify-center text-gray-400">
           <p className="font-medium">Engagement Graph</p>
           <p className="text-xs">Charts will be implemented here</p>
        </CardBody>
      </Card>
    </div>
  );
}

// --- Helper Components ---

const StatCard = ({ label, value, trend, color }) => (
  <Card className="border-none bg-white shadow-sm hover:shadow-md transition-shadow" radius="lg">
    <CardBody className="gap-2 p-6">
      <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">{label}</p>
      <div className="flex items-end gap-2">
        <h3 className={`text-3xl font-black ${color}`}>{value}</h3>
      </div>
      <p className="text-xs text-gray-400 font-medium">{trend}</p>
    </CardBody>
  </Card>
);

const QueueStat = ({ label, value }) => (
  <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex flex-col items-center justify-center gap-1">
    <div className={`text-2xl font-bold ${value > 1000 ? 'text-red-500' : 'text-gray-800'}`}>
        {value}
    </div>
    <div className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">{label}</div>
  </div>
);