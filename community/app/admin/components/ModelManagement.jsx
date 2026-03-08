"use client";
import { useState, useEffect, useRef } from "react";
import { 
  Card, CardHeader, CardBody, CardFooter, Chip, Button, 
  Spinner, Progress, Input, ScrollShadow, Divider 
} from "@heroui/react";
import { adminService } from "@/admin/admin.js";
import TrainingImagesTable from "./TrainingImagesTable";

export default function ModelManagement() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadVersion, setUploadVersion] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => { loadModels(); }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      const data = await adminService.getModels();
      setModels(data);
    } finally { setLoading(false); }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files[0];
    if (!file || !uploadVersion) return alert("Please provide a tag and a file.");

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("version", uploadVersion);
      formData.append("NewImagesCount", "0");
      formData.append("ValidationAccuracy", "0.0"); 

      await adminService.uploadModel(formData);
      setUploadVersion("");
      if(fileInputRef.current) fileInputRef.current.value = "";
      loadModels();
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (version) => {
    if(!confirm(`Are you sure you want to delete ${version}?`)) return;
    try {
      // Assumes adminService.deleteModel exists on your backend
      await adminService.deleteModel(version);
      loadModels();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  if (loading && models.length === 0) return (
    <div className="flex justify-center h-full items-center">
      <Spinner size="lg" color="warning" label="Loading..." />
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* UNIFIED HEADER SECTION */}
      <div className="flex-shrink-0 flex flex-col md:flex-row md:items-end justify-between gap-3 mb-12">
        <div className="flex flex-col gap-2">
           <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic leading-none">
            Model Management
          </h2>
          <p className="text-gray-500 font-bold uppercase text-[10px] tracking-[0.2em]">
            Manage model versions
          </p>
        </div>

        <div className="flex bg-black/40 p-2 rounded-3xl border border-white/5 shadow-xl">
           <Button 
            onPress={() => adminService.triggerTraining()}
            className="bg-black/40 text-white border border-white/5 font-black uppercase text-[10px] tracking-widest h-12 px-8 rounded-2xl hover:bg-[#CFB87C] hover:text-[#222222] transition-all"
          >
            Initialize Training
          </Button>
        </div>
      </div>

      <ScrollShadow className="flex-grow pb-12 pr-4 scrollbar-hide" size={40}>
        <div className="flex flex-col gap-8">
          
          {/* COMPACT INJECTION PANEL */}
          <Card className="border border-white/5 shadow-2xl bg-[#1a1a1a] rounded-[2.5rem] overflow-hidden">
            <CardBody className="p-8 text-white">
              <form onSubmit={handleUploadSubmit} className="flex flex-col md:flex-row gap-8 items-center justify-between">
                <div className="flex flex-col gap-2 w-full md:w-1/3">
                  <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest px-2">Version</label>
                  <Input 
                    placeholder="E.G. V2.0.1" 
                    value={uploadVersion} 
                    onChange={(e) => setUploadVersion(e.target.value)} 
                    variant="flat" 
                    classNames={{ 
                      inputWrapper: "bg-black/40 h-12 rounded-2xl border border-white/5 focus-within:ring-2 focus-within:ring-[#CFB87C]/20 transition-all", 
                      input: "font-black text-white text-center uppercase placeholder:text-gray-600" 
                    }} 
                  />
                </div>

                <div className="flex flex-col gap-2 w-full md:w-1/3 items-center">
                   <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Model File</label>
                   <input 
                     type="file" 
                     ref={fileInputRef} 
                     className="block text-[10px] font-black uppercase text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/5 file:text-[#CFB87C] cursor-pointer" 
                   />
                </div>

                <Button 
                  type="submit" 
                  isLoading={isUploading}
                  className={`font-black uppercase text-[10px] tracking-widest h-12 px-10 rounded-2xl transition-all ${
                    uploadVersion ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-white/5 text-gray-600"
                  }`}
                >
                  Upload Model
                </Button>
              </form>
            </CardBody>
          </Card>

          {/* VERSION GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {models.map((model) => (
              <Card key={model.id} className="border border-white/5 bg-[#1a1a1a] shadow-xl rounded-[2.5rem] p-4 text-white">
                <CardHeader className="p-4 pb-0 flex justify-between items-start">
                  <div>
                     <h4 className="text-2xl font-black text-white italic tracking-tighter">{model.version}</h4>
                     <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">{new Date(model.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {model.isDeployed ? (
                      <Chip className="bg-[#CFB87C] text-[#222222] font-black uppercase text-[8px] tracking-widest px-3 border-none shadow-lg shadow-[#CFB87C]/10">ACTIVE</Chip>
                    ) : model.rejectionReason ? (
                      <Chip className="bg-danger/20 text-danger font-black uppercase text-[8px] tracking-widest px-3 border border-danger/20">REJECTED</Chip>
                    ) : (
                      <Chip className="bg-white/5 text-gray-500 font-black uppercase text-[8px] tracking-widest px-3 border border-white/5">ARCHIVED</Chip>
                    )}
                  </div>
                </CardHeader>
                
                <CardBody className="gap-6 p-4 py-6 flex flex-col">
                  
                  {/* GOLDEN TEST SET SECTION */}
                  <div className="p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Golden Test Set</span>
                      <span className="text-lg font-black text-blue-400">
                        {(model.goldenTestAccuracy * 100).toFixed(1)}%
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-3">
                      <div className="flex flex-col">
                        <span className="text-[8px] text-gray-500 font-black uppercase">F1 Score</span>
                        <span className="text-sm font-black text-white">{(model.goldenTestF1Score).toFixed(3)}</span>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-[8px] text-gray-500 font-black uppercase">Recall</span>
                        <span className="text-sm font-black text-white">{(model.goldenTestRecall).toFixed(3)}</span>
                      </div>
                    </div>

                    <Divider className="my-3 bg-white/5" />

                    <div className="flex justify-between text-[10px] font-bold italic">
                      <div className="text-gray-500">
                        Fake → <span className="text-danger">Real</span>: {model.goldenFakeToRealMisclassifications}
                      </div>
                      <div className="text-gray-500">
                        Real → <span className="text-danger">Fake</span>: {model.goldenRealToFakeMisclassifications}
                      </div>
                    </div>
                  </div>

                  {/* SECONDARY STAT: VALIDATION */}
                  <div>
                    <div className="flex justify-between items-end mb-2 px-1 text-[9px] font-black uppercase tracking-widest">
                      <span className="text-gray-500">Validation Accuracy</span>
                      <span className="text-[#CFB87C]">{(model.validationAccuracy * 100).toFixed(1)}%</span>
                    </div>
                    <Progress 
                      size="sm" 
                      value={model.validationAccuracy * 100} 
                      classNames={{ track: "bg-white/5", indicator: "bg-[#CFB87C]" }} 
                    />
                  </div>

                  {/* TRAINING DATA LINEAGE */}
                  <div className="flex justify-between items-center pt-2 border-t border-white/5">
                    <div className="flex gap-4">
                      <div className="flex flex-col">
                          <span className="text-[8px] text-gray-500 font-black uppercase">New Data</span>
                          <span className="text-xs font-black text-white">{model.newImagesCount} <span className="text-[9px] text-gray-600">IMG</span></span>
                      </div>
                      <div className="flex flex-col border-l border-white/10 pl-4">
                          <span className="text-[8px] text-gray-500 font-black uppercase">Replay</span>
                          <span className="text-xs font-black text-white">{model.replayBufferCount} <span className="text-[9px] text-gray-600">IMG</span></span>
                      </div>
                    </div>
                  </div>

                  {/* REJECTION REASON */}
                  {model.rejectionReason && (
                    <div className="text-[10px] text-danger bg-danger/5 p-3 rounded-xl border border-danger/10 italic font-medium">
                      Reason: {model.rejectionReason}
                    </div>
                  )}

                </CardBody>
                
                <CardFooter className="justify-end p-4 pt-0">
                  <Button 
                    size="sm" 
                    variant="light" 
                    className="font-black uppercase text-[9px] tracking-tighter text-gray-600 hover:text-danger transition-colors"
                    onPress={() => handleDelete(model.version)}
                    isDisabled={model.isDeployed}
                  >
                    Delete Version
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </ScrollShadow>

      <Divider className="my-6 bg-white/5" />

      <TrainingImagesTable />
    </div>
  );
}