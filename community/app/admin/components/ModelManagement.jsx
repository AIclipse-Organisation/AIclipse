"use client";
import { useState, useEffect, useRef } from "react";
import { 
  Card, CardHeader, CardBody, CardFooter,
  Divider, Chip, Button, Spinner, Progress, Input
} from "@heroui/react";
import { adminService } from "@/admin/admin.js";

export default function ModelManagement() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadVersion, setUploadVersion] = useState("");
  const fileInputRef = useRef(null);

  // 1. Load Models
  const loadModels = async () => {
    try {
      setLoading(true);
      const data = await adminService.getModels();
      setModels(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  // 2. Handle Trigger Training
  const handleTrain = async () => {
    try {
      await adminService.triggerTraining();
      alert("Training signal sent successfully!");
    } catch (err) {
      alert(`Training failed: ${err.message}`);
    }
  };

  // 3. Handle Delete
  const handleDelete = async (version) => {
    if (!confirm(`Are you sure you want to delete model ${version}?`)) return;
    try {
      await adminService.deleteModel(version);
      loadModels(); // Refresh list
    } catch (err) {
      alert(err.message);
    }
  };

  // 4. Handle Upload
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files[0];
    
    if (!file || !uploadVersion) {
      alert("Please provide a version and a file.");
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("version", uploadVersion);
      
      formData.append("NewImagesCount", "0");
      formData.append("ValidationAccuracy", "0.0"); 

      await adminService.uploadModel(formData);
      
      // Reset and refresh
      setUploadVersion("");
      if(fileInputRef.current) fileInputRef.current.value = "";
      alert("Model uploaded successfully!");
      loadModels();
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  if (loading && models.length === 0) return <div className="p-10 flex justify-center"><Spinner size="lg" /></div>;
  if (error) return <div className="p-4 text-red-500 bg-red-50 rounded-lg">Error: {error}</div>;

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10">
      
      {/* Header Actions */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h3 className="text-xl font-bold">Model Versions</h3>
          <p className="text-small text-gray-500">{models.length} versions available</p>
        </div>
        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant="flat" 
            color="warning"
            onPress={handleTrain}
          >
            Trigger Training Job
          </Button>
        </div>
      </div>

      <Card className="border-none shadow-sm bg-gray-50">
        <CardBody>
          <form onSubmit={handleUploadSubmit} className="flex gap-4 items-end">
            <div className="flex-1">
               <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">New Version Tag (e.g. v1.2)</label>
               <Input 
                 placeholder="v2.0.0" 
                 value={uploadVersion}
                 onChange={(e) => setUploadVersion(e.target.value)}
                 size="sm"
                 className="bg-white"
               />
            </div>
            <div className="flex-1">
               <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Model File (.pt / .onnx)</label>
               <input 
                 type="file" 
                 ref={fileInputRef} 
                 className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
               />
            </div>
            <Button 
              type="submit" 
              color="primary" 
              isLoading={isUploading}
            >
              Upload & Deploy
            </Button>
          </form>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {models.map((model) => (
          <Card key={model.id} className="border-none bg-white shadow-sm hover:shadow-md transition-all" radius="lg">
            <CardHeader className="flex justify-between items-start pb-0">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                   <span className="text-lg font-bold text-gray-800">{model.version}</span>
                   {model.isDeployed && <Chip color="success" variant="flat" size="sm">Active</Chip>}
                </div>
                <p className="text-tiny text-default-400">
                  {new Date(model.createdAt).toLocaleDateString()}
                </p>
              </div>
            </CardHeader>
            
            <CardBody className="gap-4 py-4">
              <div className="space-y-3">
                <div className="flex justify-between text-small">
                  <span className="text-default-500">Validation Acc.</span>
                  <span className="font-bold text-gray-700">{(model.validationAccuracy * 100).toFixed(1)}%</span>
                </div>
                <Progress 
                  size="sm" 
                  value={model.validationAccuracy * 100} 
                  color={model.validationAccuracy > 0.8 ? "success" : "warning"}
                  className="max-w-md"
                />
                
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="bg-gray-50 p-2 rounded text-center">
                    <div className="text-xs text-gray-500 uppercase">F1 Score</div>
                    <div className="font-semibold text-gray-700">{(model.validationF1Score * 100).toFixed(1)}</div>
                  </div>
                  <div className="bg-gray-50 p-2 rounded text-center">
                    <div className="text-xs text-gray-500 uppercase">Recall</div>
                    <div className="font-semibold text-gray-700">{(model.validationRecall * 100).toFixed(1)}</div>
                  </div>
                </div>
              </div>
            </CardBody>
            
            <Divider className="opacity-50"/>
            
            <CardFooter className="justify-end gap-2 bg-gray-50/50">
              <Button 
                size="sm" 
                variant="light" 
                color="danger" 
                onPress={() => handleDelete(model.version)}
                isDisabled={model.isDeployed || isUploading}
              >
                Delete
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}