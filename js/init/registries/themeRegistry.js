import { registerThemeController } from '../controllers/themeControllers.js';

export function registerThemeDomain(options) {
  const { themeController, applyAppearance } = registerThemeController(options);

  return {
    controller: themeController,
    applyAppearance,
  };
}
