(function registerNotificationsBasicsTutorial() {
  const registry = window.AIclipseTutorialRegistry;
  if (!registry || typeof registry.registerModule !== "function") return;

  registry.registerModule({
    id: "notifications_basics",
    title: "Notifications",
    description: "See where activity updates and moderation feedback appear.",
    steps: [
      {
        id: "notifications-list",
        pageId: "notifications",
        selector: "#notification-list",
        title: "Your notifications appear here",
        body: [
          "This screen collects app activity that matters to you, such as post activity or moderation updates.",
          "Check it when you want to know whether something changed after you saved or published content.",
        ],
        nextLabel: "Finish",
        allowTargetClick: false,
      },
    ],
  });
})();