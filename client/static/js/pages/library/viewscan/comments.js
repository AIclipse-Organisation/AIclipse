(function initViewscanComments() {
  if (window.AIclipseViewscanComments) return;

  const shared = window.AIclipseViewscanShared;
  const api = window.AIclipseLibraryApi;
  if (!shared) return;
  if (!api) return;

  const {
    clearEl,
    ensureStylesheet,
    getCurrentActions,
    getCurrentScan,
    getCurrentViewer,
    makeEl,
  } = shared;
  const assetUrl = window.AIclipseAssetUrl;

  function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(dateStr).toLocaleDateString();
  }

  function getInitials(name) {
    if (!name) return "?";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  }

  function ensureCommentsStylesheet() {
    return ensureStylesheet("viewscan-comments-css", assetUrl("css/pages/library/viewscan/comments.css"));
  }

  function setHidden(el, shouldHide) {
    if (el) el.hidden = !!shouldHide;
  }

  function setupShowComments(img) {
    const triggerBtn = document.getElementById("btn-comments");
    const sheet = document.getElementById("comments-sheet");
    const backdrop = document.getElementById("comments-backdrop");
    const closeBtn = document.getElementById("comments-close");
    const handle = document.getElementById("comments-handle");
    const listEl = document.getElementById("comments-list");
    const input = document.getElementById("comments-input");
    const postBtn = document.getElementById("comments-post");

    if (!triggerBtn || !sheet || !backdrop || !listEl) return;

    const imageId = img?.image_id ? String(img.image_id) : "";
    const actions = getCurrentActions();
    const shouldShow = !!(imageId && actions?.show_comments === true);
    setHidden(triggerBtn, !shouldShow);
    if (!shouldShow) return;

    void ensureCommentsStylesheet();

    const countEl = document.getElementById("btn-comments-count");
    if (countEl) {
      const initialCount = Number(img?.comment_count);
      countEl.textContent = Number.isFinite(initialCount) ? String(initialCount) : "0";
    }

    let vvHandler = null;
    const attachKeyboardListener = () => {
      const vv = window.visualViewport;
      const body = document.getElementById("comments-body");
      if (!vv || !body) return;

      vvHandler = () => {
        const currentScroll = body.scrollTop;
        const offset = Math.max(0, window.innerHeight - vv.height);
        sheet.style.setProperty("--kb-offset", `${offset}px`);

        if (offset > 0) {
          sheet.classList.add("comm_bottomSheet--keyboard");
        } else {
          sheet.classList.remove("comm_bottomSheet--keyboard");
        }

        requestAnimationFrame(() => {
          body.scrollTop = currentScroll;
        });
      };

      vv.addEventListener("resize", vvHandler);
      vvHandler();
    };

    const detachKeyboardListener = () => {
      const vv = window.visualViewport;
      if (vv && vvHandler) vv.removeEventListener("resize", vvHandler);
      vvHandler = null;
      sheet.style.removeProperty("--kb-offset");
      sheet.classList.remove("comm_bottomSheet--keyboard");
    };

    const navbar = document.querySelector(".navbar");

    const renderComments = (comments, currentUserId) => {
      clearEl(listEl);
      if (!comments || comments.length === 0) {
        listEl.appendChild(makeEl("div", "comm_emptyComments", "No comments yet. Start the conversation!"));
        return;
      }

      comments.forEach((comment) => {
        const row = makeEl("div", "comm_commentRow");
        const avatar = makeEl("div", "comm_commentAvatar", getInitials(comment.user_name));
        const content = makeEl("div", "comm_commentContent");
        const top = makeEl("div", "comm_commentTop");
        const author = makeEl("span", "comm_commentAuthor", comment.user_name || "Anonymous");
        const time = makeEl("span", "comm_commentTime", timeAgo(comment.created_at));
        const text = makeEl("div", "comm_commentText", comment.text || "");

        top.appendChild(author);
        top.appendChild(time);
        content.appendChild(top);
        content.appendChild(text);

        if (currentUserId && comment.user_id === currentUserId) {
          const deleteBtn = makeEl("button", "comm_commentDeleteBtn", "Delete");
          deleteBtn.type = "button";
          deleteBtn.addEventListener("click", () => showDeleteCommentModal(comment.comment_id, row));
          content.appendChild(deleteBtn);
        }

        row.appendChild(avatar);
        row.appendChild(content);
        listEl.appendChild(row);
      });
    };

    const loadComments = async (activeImageId) => {
      clearEl(listEl);
      listEl.appendChild(makeEl("div", "comm_loadingComments", "Loading..."));
      try {
        const data = await api.listViewscanComments(activeImageId);
        renderComments(data.items || [], getCurrentViewer()?.user_id || null);
      } catch {
        clearEl(listEl);
        listEl.appendChild(makeEl("div", "comm_emptyComments", "Failed to load comments."));
      }
    };

    const deleteComment = async (commentId, rowEl) => {
      const activeImageId = getCurrentScan()?.image_id;
      if (!activeImageId) return;
      try {
        const data = await api.removeViewscanComment(activeImageId, commentId);
        rowEl.remove();

        if (countEl) {
          if (data && typeof data.comment_count === "number") {
            countEl.textContent = String(data.comment_count);
          } else {
            const currentCount = parseInt(countEl.textContent, 10);
            if (!Number.isNaN(currentCount)) {
              countEl.textContent = String(Math.max(0, currentCount - 1));
            }
          }
        }
      } catch {}
    };

    const openDrawer = async () => {
      const activeImageId = getCurrentScan()?.image_id;
      if (!activeImageId) return;
      await ensureCommentsStylesheet();
      backdrop.hidden = false;
      sheet.classList.add("comm_bottomSheet--open");
      document.getElementById("app-container")?.classList.add("is-comments-open");
      if (navbar) navbar.hidden = true;
      attachKeyboardListener();
      if (!sheet.dataset.loaded) {
        loadComments(activeImageId);
        sheet.dataset.loaded = "1";
      }
    };

    const closeDrawer = () => {
      backdrop.hidden = true;
      sheet.classList.remove("comm_bottomSheet--open");
      document.getElementById("app-container")?.classList.remove("is-comments-open");
      if (navbar) navbar.hidden = false;
      detachKeyboardListener();
    };

    const deleteCommentModal = document.getElementById("delete-comment-modal");
    const commentModalCancel = document.getElementById("comment-modal-cancel");
    const commentModalConfirm = document.getElementById("comment-modal-confirm");
    let pendingDeleteCommentId = null;
    let pendingDeleteRowEl = null;

    const showDeleteCommentModal = (commentId, rowEl) => {
      pendingDeleteCommentId = commentId;
      pendingDeleteRowEl = rowEl;
      if (deleteCommentModal) deleteCommentModal.hidden = false;
    };

    const hideDeleteCommentModal = () => {
      if (deleteCommentModal) deleteCommentModal.hidden = true;
      pendingDeleteCommentId = null;
      pendingDeleteRowEl = null;
    };

    if (commentModalCancel && !commentModalCancel.dataset.bound) {
      commentModalCancel.dataset.bound = "1";
      commentModalCancel.addEventListener("click", hideDeleteCommentModal);
    }

    if (deleteCommentModal && !deleteCommentModal.dataset.bound) {
      deleteCommentModal.dataset.bound = "1";
      deleteCommentModal.addEventListener("click", (e) => {
        if (e.target === deleteCommentModal) hideDeleteCommentModal();
      });
    }

    if (commentModalConfirm && !commentModalConfirm.dataset.bound) {
      commentModalConfirm.dataset.bound = "1";
      commentModalConfirm.addEventListener("click", async () => {
        if (!pendingDeleteCommentId || !pendingDeleteRowEl) return;
        const commentId = pendingDeleteCommentId;
        const rowEl = pendingDeleteRowEl;
        hideDeleteCommentModal();
        await deleteComment(commentId, rowEl);
      });
    }

    const submitComment = async () => {
      const text = input.value.trim();
      const activeScan = getCurrentScan();
      const viewer = getCurrentViewer();
      const imageId = activeScan?.image_id;

      if (!text || !imageId || !viewer?.user_id) return;

      postBtn.disabled = true;
      try {
        const data = await api.saveViewscanComment(imageId, { text });
        input.value = "";
        postBtn.disabled = true;
        sheet.dataset.loaded = "";
        loadComments(imageId).then(() => {
          if (countEl) {
            if (data && typeof data.comment_count === "number") {
              countEl.textContent = String(data.comment_count);
            } else {
              countEl.textContent = String(listEl.querySelectorAll(".comm_commentRow").length);
            }
          }
        });
      } catch {
      } finally {
        postBtn.disabled = !input.value.trim();
      }
    };

    if (!triggerBtn.dataset.bound) {
      triggerBtn.dataset.bound = "1";
      triggerBtn.addEventListener("click", openDrawer);
      backdrop.addEventListener("click", closeDrawer);
      closeBtn?.addEventListener("click", closeDrawer);
      handle?.addEventListener("click", closeDrawer);
      input?.addEventListener("input", () => {
        postBtn.disabled = !input.value.trim();
      });
      input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && input.value.trim()) submitComment();
      });
      postBtn?.addEventListener("click", submitComment);
    }
  }

  window.AIclipseViewscanComments = {
    setupShowComments,
  };
})();
