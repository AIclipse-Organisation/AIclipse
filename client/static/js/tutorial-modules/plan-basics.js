(function registerPlanBasicsTutorial() {
  const registry = window.AIclipseTutorialRegistry;
  if (!registry || typeof registry.registerModule !== "function") return;

  registry.registerModule({
    id: "plan_basics",
    title: "Plan and usage",
    description: "Review how much you have used and what each plan offers.",
    steps: [
      {
        id: "plan-usage",
        pageId: "plan",
        selector: "#usage-info",
        title: "Check your current usage first",
        body: [
          "This block shows how much of your current allowance you have already used.",
          "Look here before you assume something is broken. In many products, a limit problem and a technical problem feel similar to the user, but they are different cases.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "plan-cards",
        pageId: "plan",
        selector: ".plans-container",
        title: "Compare plans here",
        body: [
          "This section explains the available plans and what changes when you upgrade.",
          "Use it to decide whether your current usage pattern still fits the plan you are on.",
        ],
        nextLabel: "Finish",
        allowTargetClick: false,
      },
    ],
  });
})();