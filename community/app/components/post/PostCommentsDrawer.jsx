import { useEffect, useState } from "react";
import Link from "next/link";
import { Spinner } from "@heroui/react";
import { timeAgo } from "./utils/timeAgo.js";
import ModalBase from "../modals/ModalBase";

// Helper for quick avatar initials
function getInitials(name) {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export default function PostCommentsDrawer({
  isOpen,
  onOpenChange,
  comments,
  currentUserId,
  commentsBusy,
  commentText,
  setCommentText,
  onSubmit,
  onDelete,
}) {
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const handleDeleteClick = (commentId) => {
    setDeleteConfirmId(commentId);
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };

  function close() {
    onOpenChange(false);
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="comm_sheetBackdrop"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Bottom sheet */}
      <div
        className={`comm_bottomSheet${isOpen ? " comm_bottomSheet--open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Comments"
      >
        {/* Drag handle */}
        <div className="comm_sheetHandleWrap" onClick={close}>
          <div className="comm_sheetHandle" />
        </div>

        {/* Header */}
        <div className="comm_sheetHeader">
          <div className="comm_sheetHeaderTitle">Comments</div>
          <button onClick={close} className="comm_sheetCloseBtn" aria-label="Close comments">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="comm_sheetBody">
          {commentsBusy && comments.length === 0 ? (
            <div className="comm_loadingComments">
              <Spinner size="lg" color="warning" />
              <p>Loading comments...</p>
            </div>
          ) : comments.length === 0 ? (
            <div className="comm_emptyComments">No comments yet. Start the conversation!</div>
          ) : (
            <div className="comm_commentsList">
              {comments.map((c) => (
                <div key={c.comment_id} className="comm_commentRow">
                  <div className="comm_commentAvatar">
                    {getInitials(c.user_name)}
                  </div>
                  <div className="comm_commentContent">
                    <div className="comm_commentTop">
                      {c.user_id ? (
                        <Link href={`/profile/${c.user_id}`} className="comm_commentAuthor comm_headerNameLink">
                          {c.user_name}
                        </Link>
                      ) : (
                        <span className="comm_commentAuthor">{c.user_name}</span>
                      )}
                      <span className="comm_commentTime">
                        {timeAgo(c.created_at)}
                      </span>
                    </div>
                    <div className="comm_commentText">{c.text}</div>

                    {currentUserId && c.user_id === currentUserId && (
                      <button onClick={() => handleDeleteClick(c.comment_id)} className="comm_commentDeleteBtn">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="comm_sheetFooter">
          <div className="comm_sheetInputWrapper">
            <input
              className="comm_sheetInput"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={currentUserId ? "Add a comment..." : "Sign in to comment"}
              disabled={!currentUserId || commentsBusy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commentText.trim()) {
                  onSubmit();
                }
              }}
            />
            <button
              className="comm_sheetPostBtn"
              type="button"
              onClick={onSubmit}
              disabled={!currentUserId || commentsBusy || !commentText.trim()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <ModalBase
        open={deleteConfirmId !== null}
        onClose={handleDeleteCancel}
        title="Delete Comment"
        footer={
          <>
            <button className="modal-secondary" onClick={handleDeleteCancel}>
              Cancel
            </button>
            <button className="modal-danger" onClick={handleDeleteConfirm}>
              Delete
            </button>
          </>
        }
      >
        <p>Are you sure you want to delete this comment? This action cannot be undone.</p>
      </ModalBase>
    </>
  );
}
