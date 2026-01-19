"use client";

import "../../styles/loading.css"


export default function LoadingGrid({ count = 8 }) {
  return (
      <div className="comm_loadingWrapper">
        <div className="comm_loadingSpinner" />
      </div>
    );
}
