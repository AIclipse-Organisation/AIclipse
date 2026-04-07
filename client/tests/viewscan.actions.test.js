const { normalizeViewscanActionState } = require("../static/js/pages/library/viewscan/actions.js");

describe("viewscan action visibility contract", () => {
  test("uses only server action flags for a public owner post", () => {
    expect(
      normalizeViewscanActionState({
        show_delete_scan: true,
        show_publish: false,
        show_make_private: true,
        show_edit_description: true,
      })
    ).toEqual({
      showDeleteScan: true,
      showPublish: false,
      showMakePrivate: true,
      showEditDescription: true,
    });
  });

  test("does not infer publish or make-private from missing post metadata", () => {
    expect(normalizeViewscanActionState({})).toEqual({
      showDeleteScan: false,
      showPublish: false,
      showMakePrivate: false,
      showEditDescription: false,
    });
  });
});
