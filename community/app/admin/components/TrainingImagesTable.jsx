"use client";
import { useState, useEffect } from "react";
import { Card, CardBody, Chip, Spinner, Button } from "@heroui/react";
import { adminService } from "@/admin/admin.js";

const STATUS_MAP = {
  0: { label: "Pending", color: "warning" },
  1: { label: "Ready", color: "success" },
  2: { label: "Used", color: "primary" },
};

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

  if (loading && images.length === 0) return <div className="p-10 flex justify-center"><Spinner size="lg" /></div>;
  if (error) return <div className="p-4 text-red-500 bg-red-50 rounded-lg">Error: {error}</div>;

  return (
    <div className="flex flex-col gap-4">
      
      {/* Header Actions */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h3 className="text-xl font-bold">Training Dataset Candidates</h3>
          <p className="text-small text-gray-500">{images.length} images accumulating for next cycle</p>
        </div>
        <div className="flex gap-2">
           <Button size="sm" variant="flat" onPress={fetchImages}>
             Refresh
           </Button>
        </div>
      </div>
      
      {/* SECTION 1: AVAILABLE FOR TRAINING */}
      <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Available for Training</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-3 border-none shadow-sm bg-white">
            <div className="text-xs font-bold text-gray-400 uppercase">Total</div>
            <div className="text-2xl font-bold text-gray-800">{availableImages.length}</div>
        </Card>
        <Card className="p-3 border-none shadow-sm bg-green-50">
            <div className="text-xs font-bold text-green-600 uppercase">Ready</div>
            <div className="text-2xl font-bold text-green-700">{availableImages.filter(i => i.status === 1).length}</div>
        </Card>
        <Card className="p-3 border-none shadow-sm bg-yellow-50">
            <div className="text-xs font-bold text-yellow-600 uppercase">Pending</div>
            <div className="text-2xl font-bold text-yellow-700">{availableImages.filter(i => i.status === 0).length}</div>
        </Card>
        {Object.entries(availableLabels).map(([label, count]) => (
            <Card key={label} className="p-3 border-none shadow-sm bg-purple-50">
                <div className="text-xs font-bold text-purple-600 uppercase">{label}</div>
                <div className="text-2xl font-bold text-purple-700">{count}</div>
            </Card>
        ))}
      </div>

      {/* SECTION 2: ALREADY USED */}
      <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mt-4">Used in Previous Cycles</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-3 border-none shadow-sm bg-blue-50">
            <div className="text-xs font-bold text-blue-600 uppercase">Total Used</div>
            <div className="text-2xl font-bold text-blue-700">{usedImages.length}</div>
        </Card>
        {Object.entries(usedLabels).map(([label, count]) => (
            <Card key={label} className="p-3 border-none shadow-sm bg-gray-50">
                <div className="text-xs font-bold text-gray-500 uppercase">{label}</div>
                <div className="text-2xl font-bold text-gray-600">{count}</div>
            </Card>
        ))}
      </div>
    </div>
  );
}
