const { buildLibraryApi } = require("../static/js/pages/library/api.js");

describe("library page API contract", () => {
  test("routes viewscan mutations through one shared JSON client", async () => {
    const calls = [];
    const api = buildLibraryApi({
      jsonFetch: async (method, url, body) => {
        calls.push({ method, url, body });
        return { res: { ok: true, status: 200 }, data: { ok: true } };
      },
    });

    await api.updateViewscanDescription("img_1", { description: "Hello" });
    await api.publishViewscan("img_1", { description: "Hello" });
    await api.makeViewscanPrivate("img_1");
    await api.deleteViewscan("img_1");
    await api.saveViewscanComment("img_1", { text: "Hi" });
    await api.removeViewscanComment("img_1", "c_1");

    expect(calls).toEqual([
      { method: "PATCH", url: "/viewscan/img_1/description", body: { description: "Hello" } },
      { method: "POST", url: "/viewscan/img_1/publish", body: { description: "Hello" } },
      { method: "POST", url: "/viewscan/img_1/make-private", body: undefined },
      { method: "DELETE", url: "/viewscan/img_1", body: undefined },
      { method: "POST", url: "/viewscan/img_1/comments", body: { text: "Hi" } },
      { method: "DELETE", url: "/viewscan/img_1/comments/c_1", body: undefined },
    ]);
  });

  test("surfaces detail and error messages from the shared JSON client", async () => {
    const api = buildLibraryApi({
      jsonFetch: async () => ({
        res: { ok: false, status: 403 },
        data: { detail: "Blocked" },
      }),
    });

    await expect(api.listImages()).rejects.toThrow("Blocked");
  });
});
