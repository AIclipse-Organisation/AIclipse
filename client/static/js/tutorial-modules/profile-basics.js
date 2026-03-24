(function registerProfileBasicsTutorial() {
  const registry = window.AIclipseTutorialRegistry;
  if (!registry || typeof registry.registerModule !== "function") return;

  registry.registerModule({
    id: "profile_basics",
    title: "Profile and scans",
    description: "Understand your profile area and where your saved scans appear.",
    steps: [
      {
        id: "profile-summary",
        pageId: "profile",
        selector: ".profile-summary",
        title: "Your profile summary",
        body: [
          "This section gives you the account-level overview: who you are in the app and the information tied to your profile.",
          "Think of it as your control point for identity and account context, while saved work appears in the scan list below.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "profile-scans",
        pageId: "profile",
        selector: "#scans-container",
        title: "Your saved scans",
        body: [
          "This area contains scans you chose to save. It is your working history inside the product.",
          "Use it to revisit results, compare previous scans, and decide later whether something should remain private or be shared publicly.",
        ],
        nextLabel: "Finish",
        allowTargetClick: false,
      },
    ],
  });
})();