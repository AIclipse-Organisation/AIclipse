"use client";

import ModalBase from "./ModalBase";

function StepCard({ step, title, icon, children }) {
  return (
    <div className="tut-card">
      <div className="tut-card-head">
        <div className="tut-chip">Step {step}</div>
        <div className="tut-title-row">
          <span className="tut-icon" aria-hidden="true">{icon}</span>
          <h3 className="tut-h3">{title}</h3>
        </div>
      </div>
      <div className="tut-card-body">{children}</div>
    </div>
  );
}

export default function TutorialModal({ open, onClose, onRunAnalyzer }) {
  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="How to tell if the image is AI?"
      footer={null}
    >
      <div className="tut-intro">
        <p className="modal-lead">Try our simple 3-step method:</p>
        <div className="tut-steps-row" aria-hidden="true">
          <span className="tut-step-dot active" />
          <span className="tut-step-dot active" />
          <span className="tut-step-dot active" />
        </div>
      </div>

      <div className="tut-grid">
        <StepCard step={1} title="See" icon="👀">
          <p>
            AI images sometimes struggle with small details or logical consistency. Pay attention to:
          </p>
          <ul className="tut-list">
            <li>◾ Hands, fingers, and teeth</li>
            <li>◾ Jewelry or glasses</li>
            <li>◾ Reflections in mirrors or windows</li>
            <li>◾ Background objects that look slightly “off”</li>
          </ul>
        </StepCard>

        <StepCard step={2} title="Think" icon="🧠">
          <p>Most of the AI-generated images fail on the simple logic tests:</p>
          <ul className="tut-list">
            <li>◾ Does the light make sense?</li>
            <li>◾ Does the background seem real?</li>
            <li>◾ Is the image too perfect to be real?</li>
          </ul>
        </StepCard>

        <StepCard step={3} title="Verify" icon="☑️">
          <p>
            Run the image through our AIclipse analyzer for the most accurate results.
          </p>
        </StepCard>
      </div>
    </ModalBase>
  );
}
