import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export default function PostMedia({
  url,
  label,
  onClick,
  revealPhase,
  isUserCorrect,
  groundTruth,
}) {
  // 1. Add a state to track when the image is fully loaded
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className="comm_postImageWrap">
      {/* 2. Change to motion.img and use onLoad */}
      <motion.img
        className="comm_postImage"
        src={url}
        alt={label || "Community image"}
        onClick={onClick}
        onLoad={() => setIsLoaded(true)}
        animate={{ opacity: isLoaded ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        style={{ color: "transparent" }}
      />

      {/* Full overlay */}
      <AnimatePresence>
        {(revealPhase === "showing" || revealPhase === "text-fading") && (
          <div className="comm_truthOverlayWrap">
            <motion.div
              className="comm_truthOverlay"
              initial={{ opacity: 0, scale: 0.78, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.28 } }}
              transition={{ type: "spring", stiffness: 360, damping: 26 }}
            >
              <div className={`comm_truthOverlayIcon ${isUserCorrect ? "is-correct" : "is-incorrect"}`}>
                {isUserCorrect ? (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                )}
              </div>
              <motion.div
                className="comm_truthOverlayText"
                animate={{ opacity: revealPhase === "text-fading" ? 0 : 1 }}
                transition={{ duration: 0.38 }}
              >
                <span className={`comm_truthTitle ${isUserCorrect ? "is-correct" : "is-incorrect"}`}>
                  {isUserCorrect ? "Correct!" : "Nice Try!"}
                </span>
                <span className="comm_truthSub">This was {groundTruth}</span>
              </motion.div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Truth label */}
      <AnimatePresence>
        {(revealPhase === "settled" || revealPhase === "pre-existing") && (
          <motion.div
            className={`comm_truthLabel ${groundTruth === "Real" ? "is-real" : "is-fake"}`}
            initial={revealPhase === "pre-existing" ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55, ease: "easeIn" }}
          >
            {groundTruth === "Real" ? "REAL" : "FAKE"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Corner badge */}
      <AnimatePresence>
        {(revealPhase === "icon-moving" || revealPhase === "settled" || revealPhase === "pre-existing") && (
          <motion.div
            className={`comm_truthCornerBadge ${isUserCorrect ? "is-correct" : "is-incorrect"}`}
            initial={revealPhase === "pre-existing" ? false : { opacity: 0, scale: 2.4, x: -62, y: -52 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            transition={{ type: "spring", stiffness: 80, damping: 18 }}
          >
            {isUserCorrect ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}