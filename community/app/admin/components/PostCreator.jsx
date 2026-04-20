"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { Card, CardBody, Button, Textarea, Spinner } from "@heroui/react";
import { adminService } from "../admin.js";

export default function PostCreator() {
  const [status, setStatus] = useState({ type: "info", text: "Ready to upload." });
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const [groundTruth, setGroundTruth] = useState("Real");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const url = selectedFile ? URL.createObjectURL(selectedFile) : null;
    setPreviewUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [selectedFile]);

  const isFormComplete = useMemo(() => selectedFile !== null && description.trim().length > 0, [selectedFile, description]);

  const handleAdminPublish = async (e) => {
    e.preventDefault();
    try {
      setIsPublishing(true);
      setStatus({ type: "info", text: "Analyzing image..." });
      const scanData = await adminService.scanImage(selectedFile);
      const uploadData = await adminService.saveImage(scanData.normalizedFile, scanData.detection_token);
      const payload = uploadData.body || uploadData;

      await adminService.createOfficialPost({
        image_id: payload.image_id || payload.image?.image_id,
        description: description,
        result: { label: payload.label || scanData.label, confidence: payload.confidence || scanData.confidence },
        ground_truth: groundTruth,
        is_admin_post: true
      });

      setStatus({ type: "success", text: "Post published." });
      setIsSuccess(true);
    } catch (err) {
      setStatus({ type: "error", text: err.message });
      setIsPublishing(false);
    }
  };

  return (
    <Card className="w-full h-full border border-white/5 shadow-2xl rounded-[1.75rem] md:rounded-[3rem] bg-[#1a1a1a] overflow-hidden text-white">
      <div className="px-4 md:px-10 py-4 text-xs tracking-wide uppercase font-black border-b border-white/5 flex justify-between items-center bg-black/20 text-[#CFB87C]">
        <span>STATUS: {status.text}</span>
        {isPublishing && <Spinner size="sm" color="warning" />}
      </div>

      <CardBody className="p-4 md:p-10 relative flex flex-col h-full overflow-y-auto scrollbar-hide">
        {isSuccess ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-[#CFB87C] text-[#222222] rounded-full flex items-center justify-center text-4xl mb-6 shadow-xl shadow-[#CFB87C]/20">✓</div>
            <h3 className="text-3xl font-black uppercase tracking-tighter mb-10">Case Live</h3>
            <Button onPress={() => { setIsSuccess(false); setSelectedFile(null); setDescription(""); }}
              className="w-full sm:w-auto bg-[#CFB87C] text-[#222222] font-black px-10 md:px-16 h-12 md:h-16 rounded-[1.25rem] md:rounded-[2rem] hover:scale-105 transition-all">
              Reset Creator
            </Button>
          </div>
        ) : (
          <form onSubmit={handleAdminPublish} className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-10 flex-1">
            <div className="col-span-12 lg:col-span-5 flex flex-col gap-4">
              <label className="text-sm font-black text-gray-500 uppercase tracking-wide px-2">Evidence Media</label>
              <div className="relative aspect-square rounded-[1.5rem] md:rounded-[2.5rem] bg-black/40 border-2 border-dashed border-white/10 overflow-hidden flex items-center justify-center group">
                {!selectedFile ? (
                  <div className="flex flex-col items-center gap-4 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <input type="file" ref={fileInputRef} onChange={(e) => setSelectedFile(e.target.files[0])} className="hidden" accept="image/*" />
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-[#CFB87C] text-3xl group-hover:scale-110 transition-all">↑</div>
                    <Button className="bg-[#CFB87C] text-[#222222] font-black px-8 h-11 md:h-12 rounded-2xl uppercase text-sm tracking-wide pointer-events-none">Browse</Button>
                  </div>
                ) : (
                  <div className="w-full h-full relative group">
                    <img src={previewUrl} className="w-full h-full object-contain p-4 md:p-8" alt="Preview" />
                    <div className="absolute inset-0 bg-[#222222]/80 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center backdrop-blur-sm">
                      <Button variant="flat" className="font-black bg-[#CFB87C] text-[#222222] rounded-2xl px-8 h-11 md:h-12" onPress={() => setSelectedFile(null)}>Replace</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="col-span-12 lg:col-span-7 flex flex-col gap-8 h-full">
              <div className="flex flex-col gap-4">
                <label className="text-sm font-black text-gray-500 uppercase tracking-wide px-2">Truth Verdict</label>
                {/* CUSTOM PILL SELECTOR (Replacing HeroUI Tabs for reliability) */}
                <div className="flex bg-black/40 p-1.5 rounded-[1.25rem] md:rounded-[2rem] border border-white/5">
                  <button type="button" onClick={() => setGroundTruth("Real")}
                    className={`flex-1 h-11 md:h-14 rounded-xl md:rounded-[1.5rem] font-black uppercase text-xs md:text-sm tracking-wide transition-all ${groundTruth === "Real" ? "bg-[#CFB87C] text-[#222222]" : "text-gray-500 hover:text-white"}`}>
                    REAL
                  </button>
                  <button type="button" onClick={() => setGroundTruth("AI")}
                    className={`flex-1 h-11 md:h-14 rounded-xl md:rounded-[1.5rem] font-black uppercase text-xs md:text-sm tracking-wide transition-all ${groundTruth === "AI" ? "bg-red-500 text-white" : "text-gray-500 hover:text-white"}`}>
                    FAKE
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4 flex-grow">
                <label className="text-sm font-black text-gray-500 uppercase tracking-wide px-2 text-center">Post Description</label>
                <Textarea
                  placeholder="Provide context..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  variant="flat"
                  classNames={{
                    inputWrapper: "bg-black/40 hover:bg-black/60 rounded-[1.5rem] md:rounded-[3rem] p-4 md:p-10 border border-white/5 focus-within:ring-2 focus-within:ring-[#CFB87C]/20 transition-all h-full flex items-center min-h-[200px] md:min-h-[250px]",
                    input: "text-base md:text-xl font-bold placeholder:text-gray-700 text-white text-center outline-none ring-0 focus:ring-0 w-full"
                  }}
                />
              </div>

              <div className="mt-auto pb-4">
                <Button type="submit" isDisabled={!isFormComplete || isPublishing}
                  className={`w-full font-black text-base md:text-xl h-14 md:h-24 rounded-[1.25rem] md:rounded-[2.5rem] transition-all duration-500 ${isFormComplete ? "bg-[#CFB87C] text-[#222222] shadow-xl shadow-[#CFB87C]/10 hover:-translate-y-1" : "bg-white/5 text-gray-600"
                    }`}>
                  {isPublishing ? "Posting..." : "Publish Post"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}