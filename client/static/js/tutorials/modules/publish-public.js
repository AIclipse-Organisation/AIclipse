(function registerPublishPublicTutorial() {
  const registry = window.AIclipseTutorialRegistry;
  if (!registry || typeof registry.registerModule !== "function") return;

  registry.registerModule({
    id: "publish_public",
    title: "Publish to Community",
    description: "Switch a result to public, add context, and publish it to the community feed.",
    steps: [
      {
        id: "publish-public-switch",
        pageId: "results",
        selector: "#mode-public",
        title: "Switch the scan to Public",
        body: [
          "Public means this result is no longer just for your own profile. It becomes part of the community space.",
          "Use this when your goal is discussion, comparison, or helping other users spot patterns across suspicious images.",
        ],
        completeEvent: "results-public-selected",
        allowTargetClick: true,
      },
      {
        id: "publish-public-description",
        pageId: "results",
        selector: "#post-description",
        title: "Add context before publishing",
        body: [
          "A short description helps other people understand why the image matters and what they should look at.",
          "The best descriptions are specific. Mention the source, what looks suspicious, or what question you want the community to help answer.",
        ],
        nextLabel: "Next",
        allowTargetClick: false,
      },
      {
        id: "publish-public-submit",
        pageId: "results",
        selector: "#btn-save",
        title: "Publish the post",
        body: [
          "When the visibility is Public and the description is ready, publish the result.",
          "This creates a community post using the scan result plus your explanation.",
        ],
        completeEvent: "publish-success",
        allowTargetClick: true,
      },
      {
        id: "publish-public-feed",
        pageId: "community-feed",
        selector: ".comm_grid",
        title: "This is the Community feed",
        body: [
          "Public posts appear here for other registered users to browse and discuss.",
          "This area is best for shared learning. Keep private or sensitive material out of the public flow unless you are sure it belongs here.",
        ],
        nextLabel: "Finish",
        allowTargetClick: false,
      },
    ],
  });
})();