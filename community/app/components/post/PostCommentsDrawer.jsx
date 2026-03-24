import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Spinner } from "@heroui/react";
import { timeAgo } from "./utils/timeAgo.js";

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
  return (
    <Modal 
      isOpen={isOpen} 
      onOpenChange={onOpenChange}
      placement="bottom" 
      scrollBehavior="inside"
      className="comm_bottomSheet" 
      backdrop="opaque"
      hideCloseButton={true} 
      motionProps={{
        variants: {
          enter: { y: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
          exit: { y: "100%", opacity: 1, transition: { duration: 0.25, ease: "easeIn" } },
        }
      }}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <div className="comm_sheetHandleWrap" onClick={onClose}>
              <div className="comm_sheetHandle"></div>
            </div>

            <ModalHeader className="comm_sheetHeader">
              <div className="comm_sheetHeaderTitle">
                Comments
              </div>
              <button onClick={onClose} className="comm_sheetCloseBtn" aria-label="Close comments">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </ModalHeader>
            
            <ModalBody className="comm_sheetBody">
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
                          <span className="comm_commentAuthor">{c.user_name}</span>
                          <span className="comm_commentTime">
                            {timeAgo(c.created_at)}
                          </span>
                        </div>
                        <div className="comm_commentText">{c.text}</div>
                        
                        {currentUserId && c.user_id === currentUserId && (
                          <button onClick={() => onDelete(c.comment_id)} className="comm_commentDeleteBtn">
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ModalBody>

            <ModalFooter className="comm_sheetFooter">
              <div className="comm_sheetInputWrapper">
                <input
                  className="comm_sheetInput"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={currentUserId ? "Add a comment..." : "Sign in to comment"}
                  disabled={!currentUserId || commentsBusy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && commentText.trim()) {
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
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}