(function initAIclipseTutorialRegistry() {
  if (window.AIclipseTutorialRegistry) return;

  const VERSION = 11;
  const modules = [];

  function registerModule(moduleDef) {
    if (!moduleDef || typeof moduleDef !== "object") return;
    if (!moduleDef.id || !moduleDef.title || !Array.isArray(moduleDef.steps)) return;

    const normalized = {
      id: String(moduleDef.id),
      title: String(moduleDef.title),
      description: String(moduleDef.description || ""),
      steps: moduleDef.steps.slice(),
    };

    const existingIndex = modules.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) {
      modules.splice(existingIndex, 1, normalized);
      return;
    }

    modules.push(normalized);
  }

  function getModules() {
    return modules.slice();
  }

  function getModule(moduleId) {
    return modules.find((module) => module.id === moduleId) || null;
  }

  window.AIclipseTutorialRegistry = {
    version: VERSION,
    registerModule,
    getModules,
    getModule,
  };
})();