(function registerCommunityBasicsTutorial() {
  const registry = window.AIclipseTutorialRegistry;
  if (!registry || typeof registry.registerModule !== "function") return;

  registry.registerModule({
    id: "community_basics",
    title: "Community basics",
    description: "Understand what the public community feed is for.",
    steps: [
      {
        id: "community-feed",
        pageId: "community-feed",
        selector: ".comm_grid",
        title: "This is the public community area",
        body: [
          "Users browse public posts here, compare suspicious images, and react to shared scans.",
          "Think of this as the shared discussion layer of the product, not as the safest place for first-pass or sensitive review.",
        ],
        nextLabel: "Finish",
        allowTargetClick: false,
      },
    ],
  });
})();