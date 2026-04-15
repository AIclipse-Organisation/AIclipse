function buildLibraryApi(httpClient) {
  if (!httpClient || typeof httpClient.jsonFetch !== "function") {
    throw new Error("AIclipseHttp.jsonFetch is required");
  }

  async function request(method, url, body) {
    const { res, data } = await httpClient.jsonFetch(method, url, body);
    if (!res.ok) {
      throw new Error(data?.detail || data?.error || `Request failed (${res.status})`);
    }
    return data;
  }

  return {
    deleteViewscan(imageId) {
      return request("DELETE", `/viewscan/${encodeURIComponent(imageId)}`);
    },

    listImages() {
      return request("GET", "/images");
    },

    listViewscanComments(imageId) {
      return request("GET", `/viewscan/${encodeURIComponent(imageId)}/comments`);
    },

    makeViewscanPrivate(imageId) {
      return request("POST", `/viewscan/${encodeURIComponent(imageId)}/make-private`);
    },

    markNotificationsRead(postId) {
      return request("POST", "/community/notifications/read", { post_id: String(postId || "").trim() });
    },

    publishViewscan(imageId, payload) {
      return request("POST", `/viewscan/${encodeURIComponent(imageId)}/publish`, payload);
    },

    removeViewscanComment(imageId, commentId) {
      return request(
        "DELETE",
        `/viewscan/${encodeURIComponent(imageId)}/comments/${encodeURIComponent(commentId)}`
      );
    },

    saveViewscanComment(imageId, payload) {
      return request("POST", `/viewscan/${encodeURIComponent(imageId)}/comments`, payload);
    },

    updateViewscanDescription(imageId, payload) {
      return request("PATCH", `/viewscan/${encodeURIComponent(imageId)}/description`, payload);
    },
  };
}

if (typeof window !== "undefined" && !window.AIclipseLibraryApi) {
  window.AIclipseLibraryApi = buildLibraryApi(window.AIclipseHttp);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildLibraryApi,
  };
}
