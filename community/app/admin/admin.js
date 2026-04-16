async function normalizeImageToJpeg(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92)
  );

  const baseName = file.name.replace(/\.\w+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

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
    const detail = errorBody?.detail;
    let detailText = "";
    if (typeof detail === "string") detailText = detail;
    else if (Array.isArray(detail)) {
      detailText = detail
        .map((d) => (typeof d?.msg === "string" ? d.msg : JSON.stringify(d)))
        .join("; ");
    } else if (detail && typeof detail === "object") {
      detailText = detail.message || detail.code || JSON.stringify(detail);
    }

    throw new Error(detailText || errorBody.error || `Error: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function uploadFileToPresignedUrl(uploadSession, file) {
  const uploadHeaders = {
    ...(uploadSession?.uploadHeaders || {}),
  };

  if (!Object.keys(uploadHeaders).some((key) => key.toLowerCase() === "content-type")) {
    uploadHeaders["Content-Type"] = file.type || "application/octet-stream";
  }

  const res = await fetch(uploadSession.uploadUrl, {
    method: uploadSession.uploadMethod || "PUT",
    headers: uploadHeaders,
    body: file,
    credentials: "omit",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Storage upload failed: ${res.status}`);
  }
}

export const adminService = {
  getModels: async () => fetchLocal("/models"),
  getCurrentModel: async () => fetchLocal("/models/current"),
  getTrainingImages: async () => fetchLocal("/models/training-images"),
  triggerTraining: async () => fetchLocal("/models/train", { method: "POST" }),
  deleteModel: async (version) => fetchLocal(`/models/${version}`, { method: "DELETE" }),
  getStatistics: async () => fetchLocal("/stats"),
  getUsers: async (params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      searchParams.set(k, v);
    });
    return fetchLocal(`/users?${searchParams.toString()}`);
  },

  createUser: async (payload) =>
    fetchLocal("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  deleteUser: async (userId, payload) =>
    fetchLocal(`/users/${userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  getDeletionLogs: async (params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      searchParams.set(k, v);
    });
    return fetchLocal(`/user-deletion-logs?${searchParams.toString()}`);
  },

  getAccessRequests: async (params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      searchParams.set(k, v);
    });
    return fetchLocal(`/access-requests?${searchParams.toString()}`);
  },

  approveAccessRequest: async (userId) =>
    fetchLocal(`/access-requests/${userId}/approve`, {
      method: "POST",
    }),

  rejectAccessRequest: async (userId) =>
    fetchLocal(`/access-requests/${userId}/reject`, {
      method: "DELETE",
    }),

  scanImage: async (file) => {
    const normalizedFile = await normalizeImageToJpeg(file);
    const formData = new FormData();
    formData.append("file", normalizedFile);
    const res = await fetch("/checks", {
      method: "POST",
      body: formData,
      credentials: "include"
    });
    if (!res.ok) throw new Error("AI Scan failed");
    const data = await res.json();
    return { ...data, normalizedFile };
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

  uploadModel: async ({ file, version, ...metadata }) => {
    if (!file) {
      throw new Error("Model file is required");
    }

    const normalizedVersion = String(version || "").trim();
    if (!normalizedVersion) {
      throw new Error("Model version is required");
    }

    const uploadSession = await fetchLocal("/models/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: normalizedVersion,
        fileName: file?.name,
        fileSize: file?.size,
        contentType: file?.type || "application/octet-stream",
      }),
    });

    if (!uploadSession) {
      throw new Error("Unauthorized");
    }

    await uploadFileToPresignedUrl(uploadSession, file);

    const finalized = await fetchLocal("/models/uploads/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: uploadSession.uploadId,
        version: normalizedVersion,
        ...metadata,
      }),
    });

    if (!finalized) {
      throw new Error("Unauthorized");
    }

    return finalized;
  },

  getReportedPosts: async () => {
    const res = await fetch("/community/posts/report");
    if (!res.ok) throw new Error("Failed to load queue");
    return res.json();
  },

  moderatePost: async ({ post_id, action, note }) => {
    const res = await fetch("/community/posts/report", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id, action, note }),
      credentials: "include",
    });
    if (!res.ok) throw new Error("Moderation failed");
    return res.json();
  },

  hardDeletePost: async (post_id) => {
    const res = await fetch(`/community/posts?post_id=${post_id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json();
  }

};