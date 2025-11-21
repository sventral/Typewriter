export const INK_PALETTE = [
  { id: 'b', name: 'Black', color: '#1f2024', buttonId: 'inkBlackBtn', sliderId: 'inkOpacityBSlider', valueId: 'inkOpacityBValue', popupId: 'inkBlackSliderPopup' },
  { id: 'r', name: 'Red', color: '#b00000', buttonId: 'inkRedBtn', sliderId: 'inkOpacityRSlider', valueId: 'inkOpacityRValue', popupId: 'inkRedSliderPopup' },
  { id: 'p', name: 'Pistachio', color: '#6a973f', buttonId: 'inkPistachioBtn', sliderId: 'inkOpacityPSlider', valueId: 'inkOpacityPValue', popupId: 'inkPistachioSliderPopup' },
  { id: 'k', name: 'Pink', color: '#ff6fae', buttonId: 'inkPinkBtn', sliderId: 'inkOpacityKSlider', valueId: 'inkOpacityKValue', popupId: 'inkPinkSliderPopup' },
  { id: 'n', name: 'Navy Blue', color: '#1c4680', buttonId: 'inkNavyBtn', sliderId: 'inkOpacityNSlider', valueId: 'inkOpacityNValue', popupId: 'inkNavySliderPopup' },
  { id: 't', name: 'Tangerine', color: '#f98b2f', buttonId: 'inkTangerineBtn', sliderId: 'inkOpacityTSlider', valueId: 'inkOpacityTValue', popupId: 'inkTangerineSliderPopup' },
  { id: 'u', name: 'Purple', color: '#7046aa', buttonId: 'inkPurpleBtn', sliderId: 'inkOpacityUSlider', valueId: 'inkOpacityUValue', popupId: 'inkPurpleSliderPopup' },
  { id: 'w', name: 'White', color: '#f7f5ee', buttonId: 'inkWhiteBtn', sliderId: 'inkOpacityWSlider', valueId: 'inkOpacityWValue', popupId: 'inkWhiteSliderPopup' },
];

export const DEFAULT_INK = 'b';

export const SUPPORTED_INKS = INK_PALETTE.map((ink) => ink.id);

export const INK_COLORS = INK_PALETTE.reduce((map, ink) => {
  map[ink.id] = ink.color;
  return map;
}, {});

export function normalizeInkId(ink) {
  if (typeof ink !== 'string') return DEFAULT_INK;
  const trimmed = ink.trim();
  return SUPPORTED_INKS.includes(trimmed) ? trimmed : DEFAULT_INK;
}

export function createDefaultInkOpacity(value = 100) {
  const defaults = {};
  SUPPORTED_INKS.forEach((id) => {
    defaults[id] = value;
  });
  return defaults;
}

export function getInkMeta(id) {
  return INK_PALETTE.find((ink) => ink.id === id) || null;
}
