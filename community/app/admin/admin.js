async function fetchLocal(endpoint, options = {}) {
  const headers = {
    ...options.headers,
  };

  const res = await fetch(`/community/adminBFF${endpoint}`, {
    ...options,
    headers,
    credentials: "include", 
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
        console.warn("Unauthorized. Redirecting to login...");
        // window.location.href = "/"; 
        return null;
    }

    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || `Error: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const adminService = {
  getModels: async () => fetchLocal("/models"),
  getCurrentModel: async () => fetchLocal("/models/current"),
  getTrainingImages: async () => fetchLocal("/models/training-images"),
  triggerTraining: async () => fetchLocal("/models/train", { method: "POST" }),
  deleteModel: async (version) => fetchLocal(`/models/${version}`, { method: "DELETE" }),
  getStatistics: async () => fetchLocal("/stats"),

  scanImage: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/checks", { 
      method: "POST", 
      body: formData, 
      credentials: "include" 
    });
    if (!res.ok) throw new Error("AI Scan failed");
    return res.json();
  },

  saveImage: async (file, token) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("detection_token", token);
    formData.append("is_public", "true");
    
    const res = await fetch("/upload/image", { 
      method: "POST", 
      body: formData, 
      credentials: "include" 
    });
    if (!res.ok) throw new Error("Image save failed");
    return res.json();
  },

  createOfficialPost: async (postBody) => {
    const res = await fetch("/community/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
      credentials: "include",
    });
    if (!res.ok) throw new Error("Community publish failed");
    return res.json();
  },
  
  uploadModel: async (formData) => {
    const res = await fetch(`/community/adminBFF/models`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Upload failed");
    }
    return res.json();
  }
};