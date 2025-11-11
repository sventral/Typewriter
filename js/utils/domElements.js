const DOM_ID_GROUPS = {
  stage: {
    stage: 'stage',
    zoomWrap: 'zoomWrap',
    stageInner: 'stageInner',
    firstPage: 'page',
    marginBox: 'marginBox',
    caretEl: 'caret',
  },
  rulers: {
    rulerH_host: 'rulerH_host',
    rulerH_stops_container: 'rulerH_stops_container',
    rulerV_host: 'rulerV_host',
    rulerV_stops_container: 'rulerV_stops_container',
    guideV: 'guideV',
    guideH: 'guideH',
  },
  documents: {
    newDocBtn: 'newDocBtn',
    exportBtn: 'exportTxtBtn',
    docMenuBtn: 'docMenuBtn',
    docMenuPopup: 'docMenuPopup',
    docMenuList: 'docMenuList',
    docTitleInput: 'docTitleInput',
    deleteDocBtn: 'deleteDocBtn',
  },
  ink: {
    inkBlackBtn: 'inkBlackBtn',
    inkRedBtn: 'inkRedBtn',
    inkWhiteBtn: 'inkWhiteBtn',
    inkSettingsBtn: 'inkSettingsBtn',
    inkSettingsPanel: 'inkSettingsPanel',
    inkBlackSliderPopup: 'inkBlackSliderPopup',
    inkRedSliderPopup: 'inkRedSliderPopup',
    inkWhiteSliderPopup: 'inkWhiteSliderPopup',
    inkOpacityBSlider: 'inkOpacityBSlider',
    inkOpacityRSlider: 'inkOpacityRSlider',
    inkOpacityWSlider: 'inkOpacityWSlider',
    inkOpacityBValue: 'inkOpacityBValue',
    inkOpacityRValue: 'inkOpacityRValue',
    inkOpacityWValue: 'inkOpacityWValue',
  },
  typography: {
    cpiSelect: 'cpiSelect',
    colsPreviewSpan: 'colsPreview',
    sizeInput: 'sizeInput',
    lhInput: 'lhInput',
    glyphJitterToggle: 'glyphJitterToggle',
    glyphJitterAmountMin: 'glyphJitterAmountMin',
    glyphJitterAmountMax: 'glyphJitterAmountMax',
    glyphJitterFrequencyMin: 'glyphJitterFrequencyMin',
    glyphJitterFrequencyMax: 'glyphJitterFrequencyMax',
    shuffleGlyphJitterSeedBtn: 'shuffleGlyphJitterSeedBtn',
  },
  layout: {
    toggleMarginsBtn: 'toggleMarginsBtn',
    showMarginBoxCb: 'showMarginBoxCb',
    wordWrapCb: 'wordWrapCb',
    mmLeft: 'mmLeft',
    mmRight: 'mmRight',
    mmTop: 'mmTop',
    mmBottom: 'mmBottom',
    stageWidthPct: 'stageWidthPct',
    stageHeightPct: 'stageHeightPct',
    zoomControls: 'zoomControls',
    zoomSlider: 'zoomSlider',
    zoomTrack: 'zoomTrack',
    zoomFill: 'zoomFill',
    zoomThumb: 'zoomThumb',
    zoomIndicator: 'zoomIndicator',
  },
  appearance: {
    appearanceAuto: 'appearanceAuto',
    appearanceLight: 'appearanceLight',
    appearanceDark: 'appearanceDark',
    darkPageToggle: 'darkPageToggle',
  },
  lowResZoom: {
    lowResZoomToggle: 'lowResZoomToggle',
    lowResZoomSoftCap: 'lowResZoomSoftCap',
    lowResZoomMargin: 'lowResZoomMargin',
  },
};

const DOM_SELECTOR_MAP = {
  firstPageWrap: '.page-wrap',
  lowResZoomControls: '.low-res-zoom-controls',
};

const NODELIST_SELECTORS = {
  appearanceRadios: 'input[name="appearanceMode"]',
  fontRadios: 'input[name="fontChoice"]',
};

function assignGroupedElements(target, groups, resolver) {
  Object.values(groups).forEach((group) => {
    Object.entries(group).forEach(([key, selector]) => {
      target[key] = resolver(selector);
    });
  });
}

export function createDomRefs() {
  const app = {};

  assignGroupedElements(app, DOM_ID_GROUPS, (id) => document.getElementById(id));
  assignGroupedElements(app, { selectors: DOM_SELECTOR_MAP }, (selector) => document.querySelector(selector));

  Object.entries(NODELIST_SELECTORS).forEach(([key, selector]) => {
    app[key] = () => Array.from(document.querySelectorAll(selector));
  });

  return app;
}
