"use client";
import { useState, useEffect, useRef } from "react";
import {
  Card, CardHeader, CardBody, CardFooter, Chip, Button,
  Spinner, Progress, Input, ScrollShadow, Divider
} from "@heroui/react";
import { adminService } from "../admin.js";
import TrainingImagesTable from "./TrainingImagesTable";

export default function ModelManagement() {
  const [activeView, setActiveView] = useState("models");

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
      setModels(data || []);
    } catch (err) {
      console.error("Failed to load models:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files[0];
    if (!file || !uploadVersion) return alert("Please provide a tag and a file.");

    try {
      setIsUploading(true);
      await adminService.uploadModel({
        file,
        version: uploadVersion,
        newImagesCount: 0,
        replayBufferCount: 0,
        validationAccuracy: 0.0,
        validationPrecision: 0.0,
        validationRecall: 0.0,
        validationF1Score: 0.0,
        goldenTestAccuracy: 0.0,
        goldenTestPrecision: 0.0,
        goldenTestRecall: 0.0,
        goldenTestF1Score: 0.0,
        goldenFakeToRealMisclassifications: 0,
        goldenRealToFakeMisclassifications: 0,
      });
      setUploadVersion("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadModels();
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (version) => {
    if (!confirm(`Are you sure you want to delete ${version}?`)) return;
    try {
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
      {/* UNIFIED HEADER SECTION WITH TABS */}
      <div className="flex-shrink-0 flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic leading-none">
            {activeView === "models" ? "Model Versions" : "Training Data"}
          </h2>
          <p className="text-gray-400 font-semibold uppercase text-sm tracking-wide">
            {activeView === "models"
              ? "Manage and deploy model versions"
              : "Review accumulating dataset candidates"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-black/40 p-2 rounded-3xl border border-white/5 shadow-xl">
            <Button
              size="sm"
              onPress={() => setActiveView("models")}
              className={`font-black px-8 rounded-2xl transition-all uppercase text-sm tracking-wide h-12 ${activeView === "models" ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-transparent text-gray-500 hover:text-white"
                }`}
            >
              Models
            </Button>
            <Button
              size="sm"
              onPress={() => setActiveView("data")}
              className={`font-black px-8 rounded-2xl transition-all uppercase text-sm tracking-wide h-12 ${activeView === "data" ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-transparent text-gray-500 hover:text-white"
                }`}
            >
              Data
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-grow overflow-hidden relative">
        <ScrollShadow className="h-full pr-4 scrollbar-hide" size={40}>

          {activeView === "models" && (
            <div className="flex flex-col gap-8 pb-12">
              <Card className="border border-white/5 shadow-2xl bg-[#1a1a1a] rounded-[2.5rem] overflow-hidden flex-shrink-0">
                <CardBody className="p-8 text-white">
                  <form onSubmit={handleUploadSubmit} className="flex flex-col md:flex-row gap-8 items-center justify-between">
                    <div className="flex flex-col gap-2 w-full md:w-1/3">
                      <label className="text-sm font-black text-gray-400 uppercase tracking-wide px-2">Version</label>
                      <Input
                        placeholder="E.G. V2.0.1"
                        value={uploadVersion}
                        onChange={(e) => setUploadVersion(e.target.value)}
                        variant="flat"
                        classNames={{
                          base: "h-12",
                          inputWrapper: "h-full bg-black/40 data-[hover=true]:bg-black/40 data-[focus=true]:bg-black/40 rounded-2xl border border-white/5 focus-within:ring-2 focus-within:ring-[#CFB87C]/20 transition-all",
                          input: "font-black text-white text-center uppercase placeholder:text-gray-500"
                        }}
                      />
                    </div>

                    <div className="flex flex-col gap-2 w-full md:w-1/3 items-center">
                      <label className="text-sm font-black text-gray-400 uppercase tracking-wide">Model File</label>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".pt,.bin,.safetensors,application/octet-stream"
                        className="block text-sm font-black uppercase text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/10 file:text-[#CFB87C] cursor-pointer"
                      />
                    </div>

                    <Button
                      type="submit"
                      isLoading={isUploading}
                      className={`font-black uppercase text-sm tracking-wide h-12 px-10 rounded-2xl transition-all ${uploadVersion ? "bg-[#CFB87C] text-[#222222] shadow-lg shadow-[#CFB87C]/10" : "bg-white/5 text-gray-400"
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
                        <p className="text-sm font-bold text-gray-400 uppercase tracking-wide mt-1">{new Date(model.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {model.isDeployed ? (
                          <Chip className="bg-[#CFB87C] text-[#222222] font-black uppercase text-xs tracking-wide px-3 border-none shadow-lg shadow-[#CFB87C]/10">ACTIVE</Chip>
                        ) : model.rejectionReason ? (
                          <Chip className="bg-danger/20 text-danger font-black uppercase text-xs tracking-wide px-3 border border-danger/20">REJECTED</Chip>
                        ) : (
                          <Chip className="bg-white/5 text-gray-400 font-black uppercase text-xs tracking-wide px-3 border border-white/5">ARCHIVED</Chip>
                        )}
                      </div>
                    </CardHeader>

                    <CardBody className="gap-6 p-4 py-6 flex flex-col">
                      {/* GOLDEN TEST SET SECTION */}
                      <div className="p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-sm font-black text-blue-400 uppercase tracking-wide">Golden Test Set</span>
                          <span className="text-lg font-black text-blue-400">
                            {(model.goldenTestAccuracy * 100).toFixed(1)}%
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-3">
                          <div className="flex flex-col">
                            <span className="text-xs text-gray-400 font-black uppercase">F1 Score</span>
                            <span className="text-base font-black text-white">{(model.goldenTestF1Score).toFixed(3)}</span>
                          </div>
                          <div className="flex flex-col text-right">
                            <span className="text-xs text-gray-400 font-black uppercase">Recall</span>
                            <span className="text-base font-black text-white">{(model.goldenTestRecall).toFixed(3)}</span>
                          </div>
                        </div>

                        <Divider className="my-3 bg-white/10" />

                        <div className="flex justify-between text-xs font-bold italic">
                          <div className="text-gray-300">
                            Fake → <span className="text-danger">Real</span>: {model.goldenFakeToRealMisclassifications}
                          </div>
                          <div className="text-gray-300">
                            Real → <span className="text-danger">Fake</span>: {model.goldenRealToFakeMisclassifications}
                          </div>
                        </div>
                      </div>

                      {/* SECONDARY STAT: VALIDATION */}
                      <div>
                        <div className="flex justify-between items-end mb-2 px-1 text-sm font-black uppercase tracking-wide">
                          <span className="text-gray-400">Validation Accuracy</span>
                          <span className="text-[#CFB87C]">{(model.validationAccuracy * 100).toFixed(1)}%</span>
                        </div>
                        <Progress
                          size="sm"
                          value={model.validationAccuracy * 100}
                          classNames={{ track: "bg-white/10", indicator: "bg-[#CFB87C]" }}
                        />
                      </div>

                      {/* TRAINING DATA LINEAGE */}
                      <div className="flex justify-between items-center pt-3 border-t border-white/10">
                        <div className="flex gap-4">
                          <div className="flex flex-col">
                            <span className="text-xs text-gray-400 font-black uppercase">New Data</span>
                            <span className="text-sm font-black text-white">{model.newImagesCount} <span className="text-xs text-gray-400">IMG</span></span>
                          </div>
                          <div className="flex flex-col border-l border-white/10 pl-4">
                            <span className="text-xs text-gray-400 font-black uppercase">Replay</span>
                            <span className="text-sm font-black text-white">{model.replayBufferCount} <span className="text-xs text-gray-400">IMG</span></span>
                          </div>
                        </div>
                      </div>

                      {/* REJECTION REASON */}
                      {model.rejectionReason && (
                        <div className="text-xs text-danger bg-danger/5 p-3 rounded-xl border border-danger/10 italic font-medium mt-2">
                          Reason: {model.rejectionReason}
                        </div>
                      )}
                    </CardBody>

                    <CardFooter className="justify-end p-4 pt-0">
                      <Button
                        size="sm"
                        variant="light"
                        className="font-black uppercase text-xs tracking-wide text-gray-400 hover:text-danger hover:bg-danger/10 transition-colors"
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
          )}

          {activeView === "data" && (
            <div className="pb-12">
              <TrainingImagesTable />
            </div>
          )}

        </ScrollShadow>
      </div>
    </div>
  );
}
