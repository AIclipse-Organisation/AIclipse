"use client";
import { useState, useRef } from "react";
import { Card, CardBody, Button, Textarea, Select, SelectItem, Chip } from "@heroui/react";
import { adminService } from "@/admin/admin.js";

export default function PostManagement() {
  const [status, setStatus] = useState({ type: "info", text: "Ready to upload." });
  const [isPublishing, setIsPublishing] = useState(false);
  const fileInputRef = useRef(null);
  
  const [formData, setFormData] = useState({
    description: "",
    groundTruth: "Real",
  });

  const handleAdminPublish = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files[0];
    
    if (!file || !formData.description) {
      return setStatus({ type: "error", text: "File and description are required." });
    }

    try {
      setIsPublishing(true);
      setStatus({ type: "info", text: "Analyzing image with AI..." });
      const scanData = await adminService.scanImage(file);
      const token = scanData.detection_token;

      setStatus({ type: "info", text: "Saving to database..." });
      const uploadData = await adminService.saveImage(file, token);
      
      const uploadPayload = uploadData.body || uploadData;
      const imageId = uploadPayload.image_id || (uploadPayload.image && uploadPayload.image.image_id);

      setStatus({ type: "info", text: "Finalizing community post..." });
      const postBody = {
        image_id: imageId,
        description: formData.description,
        result: {
          verdict: uploadPayload.verdict || scanData.verdict,
          label: uploadPayload.label || scanData.label,
          confidence: uploadPayload.confidence || scanData.confidence,
        },
        ground_truth: formData.groundTruth,
        is_admin_post: true 
      };

      await adminService.createOfficialPost(postBody);
      
      setStatus({ type: "success", text: "Success! Admin post published." });
      setFormData({ description: "", groundTruth: "Real" });
      if(fileInputRef.current) fileInputRef.current.value = "";

    } catch (err) {
      setStatus({ type: "error", text: err.message });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto h-full overflow-y-auto">
      {/* Page Header Area */}
      <div className="flex flex-col gap-2 mb-10">
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Post Creator</h2>
        </div>
        <p className="text-gray-500 text-lg font-medium">Upload authenticated images to train the community.</p>
      </div>

      <Card className="border-none shadow-2xl shadow-gray-200/50 rounded-[2.5rem] overflow-hidden">
        {/* Dynamic Status Banner */}
        <div className={`px-8 py-4 text-sm font-bold border-b transition-colors ${
          status.type === 'error' ? 'bg-red-50 border-red-100 text-red-600' : 
          status.type === 'success' ? 'bg-green-50 border-green-100 text-green-600' : 
          'bg-blue-50 border-blue-100 text-blue-600'
        }`}>
          {status.type === 'info' && <span className="mr-2 animate-pulse">●</span>}
          {status.text}
        </div>

        <CardBody className="p-12">
          <form onSubmit={handleAdminPublish} className="flex flex-col gap-10">
            
            {/* Top Row: File and Select */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
               
               <div className="flex flex-col gap-4">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Upload Image</label>
                  <div className="relative group">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-4 file:px-8 file:rounded-2xl file:border-0 file:text-sm file:font-black file:bg-gray-900 file:text-white hover:file:bg-gray-800 cursor-pointer transition-all active:scale-95"
                    />
                  </div>
               </div>

               <div className="flex flex-col gap-4">
                 <label className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Ground Truth Label</label>
                 <Select 
                    placeholder="Pick a label"
                    selectedKeys={[formData.groundTruth]}
                    onSelectionChange={(keys) => setFormData({...formData, groundTruth: Array.from(keys)[0]})}
                    variant="flat"
                    className="w-full"
                    classNames={{
                      trigger: "bg-gray-100/50 hover:bg-gray-100 rounded-2xl h-14 border-transparent",
                      value: "font-bold text-gray-900",
                    }}
                  >
                    <SelectItem key="Real" className="font-bold">REAL</SelectItem>
                    <SelectItem key="AI" className="font-bold">AI / DEEPFAKE</SelectItem>
                  </Select>
               </div>
            </div>

            {/* Description Row */}
            <div className="flex flex-col gap-4">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Description</label>
              <Textarea 
                placeholder="Create a believable description to assist in getting users to believe this is a community post!"
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                variant="flat"
                minRows={5}
                classNames={{
                  inputWrapper: "bg-gray-100/50 hover:bg-gray-100 rounded-3xl p-6 border-transparent",
                  input: "text-base font-medium placeholder:text-gray-400"
                }}
              />
            </div>

            {/* Submit Action */}
            <div className="pt-4">
              <Button 
                type="submit" 
                isLoading={isPublishing}
                className="w-full bg-blue-600 text-white font-black text-xl h-20 rounded-3xl shadow-xl shadow-blue-200 hover:bg-blue-700 hover:-translate-y-1 transition-all active:scale-[0.98]"
              >
                {isPublishing ? "Synchronizing Handshake..." : "Scan & Publish Official Post"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}