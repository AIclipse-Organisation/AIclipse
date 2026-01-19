import "../../styles/postBox.css"

export default function PostBox({ image }) {
  return (
    <div className="comm_postBox">
      <div className="comm_topRow">
        <button>🚩 (report)</button>
      </div>
      <img
        className="comm_postImage"
        src={image.url}
        alt={image.label || "Community image"}
      />

      <div className="comm_bottomRow">
        <div className="comm_votesCell">
          <button>⬆️</button>
          <button>⬇️</button>
        </div>

        <div className="comm_CommentsCell">
          <button>💬</button>
        </div>
      </div>
    </div>
  );
}
