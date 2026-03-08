"use client";
import { useState, useEffect } from "react";
import { Card, Spinner, Button } from "@heroui/react";
import { adminService } from "@/admin/admin.js";

// Helper component for consistent stat cards
function StatCard({ title, value, titleColor = "text-gray-400", bgStyle = "bg-[#1a1a1a]", borderStyle = "border-white/5" }) {
  return (
    <Card className={`p-6 shadow-xl rounded-[2.5rem] border ${borderStyle} ${bgStyle}`}>
      <div className={`text-[11px] font-black uppercase tracking-widest mb-2 ${titleColor}`}>
        {title}
      </div>
      <div className="text-4xl font-black text-white italic tracking-tighter">
        {value}
      </div>
    </Card>
  );
}

export default function TrainingImagesTable() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Split images into Available (Pending/Ready) and Used
  const availableImages = images.filter((i) => i.status === 0 || i.status === 1);
  const usedImages = images.filter((i) => i.status === 2);

  const getLabelCounts = (imgs) => {
    return imgs.reduce((acc, img) => {
      const label = img.label ? img.label.charAt(0).toUpperCase() + img.label.slice(1) : "Unknown";
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
  };

  const availableLabels = getLabelCounts(availableImages);
  const usedLabels = getLabelCounts(usedImages);

  useEffect(() => {
    fetchImages();
  }, []);

  const fetchImages = async () => {
    try {
      setLoading(true);
      const data = await adminService.getTrainingImages();
      setImages(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && images.length === 0) {
    return <div className="p-10 flex justify-center"><Spinner size="lg" color="warning" /></div>;
  }
  
  if (error) {
    return <div className="p-6 text-danger bg-danger/10 border border-danger/20 rounded-[2.5rem] italic font-black">Error: {error}</div>;
  }

  return (
    <div className="flex flex-col gap-8">
      
      {/* HEADER ACTIONS */}
      <div className="flex justify-between items-center bg-[#1a1a1a] p-6 px-8 rounded-[2.5rem] shadow-xl border border-white/5">
        <div>
          <h3 className="text-xl font-black text-white italic tracking-tighter uppercase">Dataset Candidates</h3>
          <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mt-1">
            {images.length} total images accumulating
          </p>
        </div>
        <Button 
          onPress={fetchImages}
          className="bg-white/5 text-white border border-white/10 font-black uppercase text-[10px] tracking-widest h-12 px-8 rounded-2xl hover:bg-white/10 transition-all"
        >
          Refresh Data
        </Button>
      </div>
      
      {/* SECTION 1: AVAILABLE FOR TRAINING */}
      <div>
        <h4 className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-4 px-2">
          Available for Next Cycle
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <StatCard 
            title="Total Available" 
            value={availableImages.length} 
          />
          <StatCard 
            title="Ready" 
            value={availableImages.filter(i => i.status === 1).length} 
            titleColor="text-success-400"
            bgStyle="bg-success/5"
            borderStyle="border-success/10"
          />
          <StatCard 
            title="Pending Review" 
            value={availableImages.filter(i => i.status === 0).length} 
            titleColor="text-warning-400"
            bgStyle="bg-warning/5"
            borderStyle="border-warning/10"
          />
          
          {/* Dynamically render available labels */}
          {Object.entries(availableLabels).map(([label, count]) => (
            <StatCard 
              key={`avail-${label}`}
              title={`Label: ${label}`}
              value={count}
              titleColor="text-[#CFB87C]"
              bgStyle="bg-[#CFB87C]/5"
              borderStyle="border-[#CFB87C]/10"
            />
          ))}
        </div>
      </div>

      {/* SECTION 2: ALREADY USED */}
      <div className="pt-4">
        <h4 className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-4 px-2">
          Used in Previous Cycles
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <StatCard 
            title="Total Used" 
            value={usedImages.length} 
            titleColor="text-blue-400"
            bgStyle="bg-blue-500/5"
            borderStyle="border-blue-500/10"
          />
          
          {/* Dynamically render used labels */}
          {Object.entries(usedLabels).map(([label, count]) => (
            <StatCard 
              key={`used-${label}`}
              title={`Label: ${label}`}
              value={count}
            />
          ))}
        </div>
      </div>
    </div>
  );
}