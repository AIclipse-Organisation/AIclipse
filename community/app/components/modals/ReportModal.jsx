"use client";

import { useState } from "react";
import ModalBase from "./ModalBase";

const REPORT_REASONS = [
  "AI Misinformation",
  "Harassment",
  "Spam",
  "Inappropriate Content",
];

export default function ReportModal({ isOpen, onClose, onSubmit, isSubmitting }) {
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState("");

  const handleSubmit = () => {
    onSubmit({ reason: reportReason, details: reportDetails });
  };

  const footer = (
    <>
      <button
        className="modal-secondary"
        onClick={onClose}
        disabled={isSubmitting}
      >
        Cancel
      </button>
      <button
        className="modal-primary"
        onClick={handleSubmit}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Sending..." : "Submit Report"}
      </button>
    </>
  );

  return (
    <ModalBase
      open={isOpen}
      onClose={onClose}
      title="Report Post"
      footer={footer}
    >
      <p className="modal-lead">Why are you reporting this content?</p>

      <div className="report-options">
        {REPORT_REASONS.map((reason) => (
          <label key={reason} className="report-option">
            <span className="report-option-label">{reason}</span>
            <input
              type="radio"
              name="reportReason"
              value={reason}
              checked={reportReason === reason}
              onChange={(e) => setReportReason(e.target.value)}
              className="report-radio"
            />
            <span className="report-radio-custom" />
          </label>
        ))}
      </div>

      <div className="modal-section">
        <label className="report-textarea-label">Extra details (Optional)</label>
        <textarea
          className="report-textarea"
          placeholder="Provide context for our moderators..."
          value={reportDetails}
          onChange={(e) => setReportDetails(e.target.value)}
          rows={3}
        />
      </div>
    </ModalBase>
  );
}