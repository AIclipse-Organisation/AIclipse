"use client";
import { useState, useEffect } from "react";
import { Card, Spinner, Button } from "@heroui/react";
import { adminService } from "../admin.js";

function StatCard({ title, value, titleColor = "text-gray-300", bgStyle = "bg-[#2a2a2a]", borderStyle = "border-white/10" }) {
  return (
    <Card className={`p-4 md:p-6 shadow-xl rounded-[1.75rem] md:rounded-[2.5rem] border ${borderStyle} ${bgStyle}`}>
      <div className={`text-sm font-black uppercase tracking-wide mb-2 ${titleColor}`}>
        {title}
      </div>
      <div className="text-3xl md:text-4xl font-black text-white italic tracking-tighter">
        {value}
      </div>
    </Card>
  );
}

export default function TrainingImagesTable() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      setImages(data || []);
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
    return <div className="p-6 text-danger bg-danger/10 border border-danger/20 rounded-[1.75rem] md:rounded-[2.5rem] italic font-black">Error: {error}</div>;
  }

  return (
    <div className="flex flex-col gap-8">

      {/* HEADER ACTIONS */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-[#2a2a2a] p-4 md:p-6 md:px-8 rounded-[1.75rem] md:rounded-[2.5rem] shadow-xl border border-white/10">
        <div>
          <h3 className="text-lg md:text-xl font-black text-white italic tracking-tighter uppercase">Dataset Candidates</h3>
          <p className="text-xs md:text-sm text-gray-300 font-bold uppercase tracking-wide mt-1">
            {images.length} total images accumulating
          </p>
        </div>
        <Button
          onPress={fetchImages}
          className="w-full sm:w-auto bg-white/10 text-white border border-white/20 font-black uppercase text-xs tracking-wide h-11 md:h-12 px-6 md:px-8 rounded-2xl hover:bg-white/20 transition-all"
        >
          Refresh Data
        </Button>
      </div>

      {/* SECTION 1: AVAILABLE FOR TRAINING */}
      <div>
        <h4 className="text-sm font-black text-gray-400 uppercase tracking-wide mb-4 px-2">
          Available for Next Cycle
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          <StatCard
            title="Total Available"
            value={availableImages.length}
          />
          <StatCard
            title="Ready"
            value={availableImages.filter(i => i.status === 1).length}
            titleColor="text-success-400"
            bgStyle="bg-success/10"
            borderStyle="border-success/20"
          />
          <StatCard
            title="Pending Review"
            value={availableImages.filter(i => i.status === 0).length}
            titleColor="text-warning-400"
            bgStyle="bg-warning/10"
            borderStyle="border-warning/20"
          />

          {/* Dynamically render available labels */}
          {Object.entries(availableLabels).map(([label, count]) => (
            <StatCard
              key={`avail-${label}`}
              title={`Label: ${label}`}
              value={count}
              titleColor="text-[#CFB87C]"
              bgStyle="bg-[#CFB87C]/10"
              borderStyle="border-[#CFB87C]/20"
            />
          ))}
        </div>
      </div>

      {/* SECTION 2: ALREADY USED */}
      <div className="pt-4">
        <h4 className="text-sm font-black text-gray-400 uppercase tracking-wide mb-4 px-2">
          Used in Previous Cycles
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          <StatCard
            title="Total Used"
            value={usedImages.length}
            titleColor="text-blue-400"
            bgStyle="bg-blue-500/10"
            borderStyle="border-blue-500/20"
          />

          {/* Dynamically render used labels with a subtle purple tint instead of grey */}
          {Object.entries(usedLabels).map(([label, count]) => (
            <StatCard
              key={`used-${label}`}
              title={`Label: ${label}`}
              value={count}
              titleColor="text-purple-300"
              bgStyle="bg-purple-500/10"
              borderStyle="border-purple-500/20"
            />
          ))}
        </div>
      </div>
    </div>
  );
}