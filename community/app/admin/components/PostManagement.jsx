"use client";
import { useState, useRef, useMemo } from "react";
import { Card, CardBody, Button, Textarea, Select, SelectItem, Chip, Spinner } from "@heroui/react";
import { adminService } from "@/admin/admin.js";

export default function PostManagement() {
  const [status, setStatus] = useState({ type: "info", text: "Ready to upload." });
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false); 
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  
  const [formData, setFormData] = useState({
    description: "",
    groundTruth: "Real",
  });

  const previewUrl = useMemo(() => {
    if (!selectedFile) return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  const isFormComplete = useMemo(() => {
    return selectedFile !== null && formData.description.trim().length > 0;
  }, [selectedFile, formData.description]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) setSelectedFile(file);
  };

  const handleReplaceImage = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetForm = () => {
    setIsSuccess(false);
    setSelectedFile(null);
    setFormData({ description: "", groundTruth: "Real" });
    setStatus({ type: "info", text: "Ready to upload." });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAdminPublish = async (e) => {
    e.preventDefault();
    try {
      setIsPublishing(true);
      setStatus({ type: "info", text: "Analyzing image with AI..." });
      
      const scanData = await adminService.scanImage(selectedFile);
      const token = scanData.detection_token;

      setStatus({ type: "info", text: "Saving to database..." });
      const uploadData = await adminService.saveImage(selectedFile, token);
      
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
      setIsSuccess(true); // Trigger the success view

    } catch (err) {
      setStatus({ type: "error", text: err.message });
      setIsPublishing(false);
    } finally {
      // We don't set isPublishing(false) here because we want to switch to Success view
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto h-full overflow-y-auto">
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
          {(status.type === 'info' && isPublishing) && <span className="mr-2 animate-pulse">●</span>}
          {status.text}
        </div>

        <CardBody className="p-12">
          {isSuccess ? (
            /* Success View: Displayed after publish */
            <div className="flex flex-col items-center justify-center py-10 animate-in fade-in zoom-in duration-500">
              <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-4xl mb-6 shadow-inner">
                ✓
              </div>
              <h3 className="text-2xl font-black mb-2">Post Live!</h3>
              <p className="text-gray-500 mb-8 text-center max-w-xs">The benchmark has been added to the community feed successfully.</p>
              <Button 
                onPress={resetForm}
                className="bg-gray-900 text-white font-bold px-12 h-14 rounded-2xl"
              >
                Create Another Post
              </Button>
            </div>
          ) : (
            /* Form View: Original Upload Form */
            <form onSubmit={handleAdminPublish} className="flex flex-col gap-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
                <div className="flex flex-col gap-4">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Upload Image</label>
                  <div className="relative w-full aspect-square md:aspect-video rounded-3xl bg-gray-100 border-2 border-dashed border-gray-300 overflow-hidden flex items-center justify-center shadow-inner group transition-all">
                    {isPublishing ? (
                      <div className="flex flex-col items-center gap-3">
                        <Spinner size="lg" color="primary" />
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-tighter">Processing Scan...</p>
                      </div>
                    ) : !selectedFile ? (
                      <div className="flex flex-col items-center gap-4 p-6 text-center">
                        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-2xl group-hover:bg-gray-300 transition-colors">↑</div>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                        <Button size="sm" className="bg-gray-900 text-white font-bold px-6" onPress={() => fileInputRef.current?.click()}>
                          Choose File
                        </Button>
                      </div>
                    ) : (
                      <>
                        <img src={previewUrl} alt="Preview" className="w-full h-full object-contain p-2" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Button size="sm" color="danger" className="font-bold bg-white text-danger shadow-xl" onPress={handleReplaceImage}>
                            Replace Image
                          </Button>
                        </div>
                      </>
                    )}
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
                    isDisabled={isPublishing}
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

              <div className="flex flex-col gap-4">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Description</label>
                <Textarea 
                  placeholder="Describe this post for the community..."
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  variant="flat"
                  minRows={5}
                  isDisabled={isPublishing}
                  classNames={{
                    inputWrapper: "bg-gray-100/50 hover:bg-gray-100 rounded-3xl p-6 border-transparent",
                    input: "text-base font-medium placeholder:text-gray-400"
                  }}
                />
              </div>

              <div className="pt-4 h-24"> 
                {isFormComplete && !isPublishing && (
                  <Button 
                    type="submit" 
                    className="w-full bg-blue-600 text-white font-black text-xl h-20 rounded-3xl shadow-xl shadow-blue-200 hover:bg-blue-700 hover:-translate-y-1 transition-all animate-in fade-in zoom-in duration-300"
                  >
                    Publish Admin Post
                  </Button>
                )}
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}