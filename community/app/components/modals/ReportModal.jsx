"use client";

import { useState } from "react";
import ModalBase from "./ModalBase"; // Adjust the import path if needed
import { RadioGroup, Radio, Textarea } from "@heroui/react";

export default function ReportModal({ isOpen, onClose, onSubmit, isSubmitting }) {
  const [reportReason, setReportReason] = useState("AI Misinformation");
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

      <RadioGroup
        value={reportReason}
        onValueChange={setReportReason}
        color="warning"
        classNames={{ wrapper: "gap-3" }}
      >
        <Radio value="AI Misinformation" classNames={{ label: "text-sm text-[#f3f3f3]" }}>
          AI Misinformation
        </Radio>
        <Radio value="Harassment" classNames={{ label: "text-sm text-[#f3f3f3]" }}>
          Harassment
        </Radio>
        <Radio value="Spam" classNames={{ label: "text-sm text-[#f3f3f3]" }}>
          Spam
        </Radio>
        <Radio value="Inappropriate Content" classNames={{ label: "text-sm text-[#f3f3f3]" }}>
          Inappropriate Content
        </Radio>
      </RadioGroup>

      <div className="modal-section">
        <Textarea
          label="Extra details (Optional)"
          labelPlacement="outside"
          placeholder="Provide context for our moderators..."
          value={reportDetails}
          onValueChange={setReportDetails}
          classNames={{
            input: "text-[#f3f3f3] placeholder:text-gray-500",
            inputWrapper: "bg-[#2c2c2c] border-[#2c2c2c] focus-within:!border-[#CFB87C] transition-colors",
          }}
        />
      </div>
    </ModalBase>
  );
}