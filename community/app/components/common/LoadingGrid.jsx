"use client";

import "../../styles/loading.css";

function SkeletonPostBox() {
  return (
    <div className="comm_postBox comm_postBoxSkeleton" aria-hidden="true">
      {/* top row */}
      <div className="comm_topRow">
        <div className="comm_headerLeft">
          <div className="comm_avatar">
            <div className="sk sk-avatar" />
          </div>

          <div className="comm_headerMeta">
            <div className="comm_headerNameLine">
              <div className="sk sk-line sk-name" />
            </div>
            <div className="sk sk-line sk-time" />
          </div>
        </div>

        <div className="comm_headerActions">
          <div className="sk sk-dot" />
        </div>
      </div>

      {/* description */}
      <div className="comm_body">
        <div className="sk sk-line sk-desc-1" />
      </div>

      {/* image */}
      <div className="comm_postImageWrap">
        <div className="sk sk-media" />
      </div>

      {/* bars */}
      <div className="comm_bars_wrapper">
        <div className="comm_bars is-revealed">
          <div className="comm_barBlock">
            <div className="sk sk-line sk-barLabel" />
            <div className="sk sk-bar" />
          </div>
          <div className="comm_barBlock">
            <div className="sk sk-line sk-barLabel" />
            <div className="sk sk-bar" />
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="comm_bottomRow">
        <div className="comm_actionsLeft">
          <div className="sk sk-pill" />
          <div className="sk sk-pill" />
        </div>
        <div className="comm_actionsRight">
          <div className="sk sk-pill sk-pill-wide" />
        </div>
      </div>
    </div>
  );
}

export default function LoadingGrid({ count = 3 }) {
  return (
    <div className="comm_grid comm_gridLoading">
      {Array.from({ length: count }).map((_, idx) => (
        <SkeletonPostBox key={idx} />
      ))}
    </div>
  );
}
