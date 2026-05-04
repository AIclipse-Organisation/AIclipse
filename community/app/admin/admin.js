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

    throw new Error(await buildResponseError(res));
  }

  if (res.status === 204) return null;
  return res.json();
}

async function buildResponseError(res) {
  const rawText = await res.text().catch(() => "");
  let errorBody = {};
  if (rawText) {
    try {
      errorBody = JSON.parse(rawText);
    } catch {
      errorBody = {};
    }
  }
  const parsedErrorBody = errorBody || {};
  const detail = parsedErrorBody?.detail;
  let detailText = "";
  if (typeof detail === "string") detailText = detail;
  else if (Array.isArray(detail)) {
    detailText = detail
      .map((d) => (typeof d?.msg === "string" ? d.msg : JSON.stringify(d)))
      .join("; ");
  } else if (detail && typeof detail === "object") {
    detailText = detail.message || detail.code || JSON.stringify(detail);
  }

  return detailText || parsedErrorBody.error || rawText || `Error: ${res.status}`;
}

async function uploadModelPart(uploadId, partNumber, chunk) {
  const res = await fetch(`/community/adminBFF/models/uploads/parts/${partNumber}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Upload-Id": uploadId,
    },
    body: chunk,
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Unauthorized");
    }
    throw new Error(await buildResponseError(res));
  }

  return res.json();
}

async function uploadModelInParts(uploadSession, file) {
  const partSizeBytes = Number(uploadSession?.partSizeBytes || 0);
  const totalParts = Number(uploadSession?.totalParts || 0);
  if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) {
    throw new Error("Upload session is missing a valid part size.");
  }
  if (!Number.isInteger(totalParts) || totalParts <= 0) {
    throw new Error("Upload session is missing a valid part count.");
  }

  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    const start = (partNumber - 1) * partSizeBytes;
    const end = Math.min(start + partSizeBytes, file.size);
    const chunk = file.slice(start, end);
    await uploadModelPart(uploadSession.uploadId, partNumber, chunk);
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

    await uploadModelInParts(uploadSession, file);

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