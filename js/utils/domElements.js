const DOM_ID_GROUPS = {
  stage: {
    stage: 'stage',
    zoomWrap: 'zoomWrap',
    stageInner: 'stageInner',
    firstPage: 'page',
    marginBox: 'marginBox',
    caretEl: 'caret',
    lagNotice: 'lagNotice',
    lagOverlay: 'lagOverlay',
    scrollLane: 'scrollLane',
    scrollLaneInner: 'scrollLaneInner',
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
    exportDialog: 'exportDialog',
    exportDialogScrim: 'exportDialogScrim',
    exportRawBtn: 'exportRawBtn',
    exportPlainBtn: 'exportPlainBtn',
    exportPdfBtn: 'exportPdfBtn',
    exportDialogCloseBtn: 'exportDialogCloseBtn',
    docMenuBtn: 'docMenuBtn',
    docMenuPopup: 'docMenuPopup',
    docMenuList: 'docMenuList',
    docTitleInput: 'docTitleInput',
    deleteDocBtn: 'deleteDocBtn',
    storageNotice: 'storageNotice',
    inkFileDocMenuBtn: 'inkFileDocMenuBtn',
    inkFileDeleteDocBtn: 'inkFileDeleteDocBtn',
    inkFileNewDocBtn: 'inkFileNewDocBtn',
    inkFileExportBtn: 'inkFileExportBtn',
    inkFileDocMenuPopup: 'inkFileDocMenuPopup',
    inkFileDocMenuList: 'inkFileDocMenuList',
    inkFileDocTitleInput: 'inkFileDocTitleInput',
  },
  ink: {
    inkBlackBtn: 'inkBlackBtn',
    inkRedBtn: 'inkRedBtn',
    inkPistachioBtn: 'inkPistachioBtn',
    inkPinkBtn: 'inkPinkBtn',
    inkNavyBtn: 'inkNavyBtn',
    inkTangerineBtn: 'inkTangerineBtn',
    inkPurpleBtn: 'inkPurpleBtn',
    inkWhiteBtn: 'inkWhiteBtn',
    inkSettingsBtn: 'inkSettingsBtn',
    inkSettingsPanel: 'inkSettingsPanel',
    inkDock: 'inkDock',
    inkDockHandle: 'inkDockHandle',
    inkDockExtras: 'inkDockExtras',
    inkMenuBtn: 'inkMenuBtn',
    inkGearBtn: 'inkGearBtn',
    inkGearToolbar: 'inkGearToolbar',
    inkGearToolbarBtn: 'inkGearToolbarBtn',
    inkFileToolbar: 'inkFileToolbar',
    inkBlackSliderPopup: 'inkBlackSliderPopup',
    inkRedSliderPopup: 'inkRedSliderPopup',
    inkPistachioSliderPopup: 'inkPistachioSliderPopup',
    inkPinkSliderPopup: 'inkPinkSliderPopup',
    inkNavySliderPopup: 'inkNavySliderPopup',
    inkTangerineSliderPopup: 'inkTangerineSliderPopup',
    inkPurpleSliderPopup: 'inkPurpleSliderPopup',
    inkWhiteSliderPopup: 'inkWhiteSliderPopup',
    inkOpacityBSlider: 'inkOpacityBSlider',
    inkOpacityRSlider: 'inkOpacityRSlider',
    inkOpacityPSlider: 'inkOpacityPSlider',
    inkOpacityKSlider: 'inkOpacityKSlider',
    inkOpacityNSlider: 'inkOpacityNSlider',
    inkOpacityTSlider: 'inkOpacityTSlider',
    inkOpacityUSlider: 'inkOpacityUSlider',
    inkOpacityWSlider: 'inkOpacityWSlider',
    inkOpacityBValue: 'inkOpacityBValue',
    inkOpacityRValue: 'inkOpacityRValue',
    inkOpacityPValue: 'inkOpacityPValue',
    inkOpacityKValue: 'inkOpacityKValue',
    inkOpacityNValue: 'inkOpacityNValue',
    inkOpacityTValue: 'inkOpacityTValue',
    inkOpacityUValue: 'inkOpacityUValue',
    inkOpacityWValue: 'inkOpacityWValue',
  },
  customFonts: {
    customFontFileInput: 'customFontFileInput',
    customFontFileBtn: 'customFontFileBtn',
    customFontUrlLoadBtn: 'customFontUrlLoadBtn',
    customFontRadio: 'customFontRadio',
    customFontSample: 'customFontSample',
  },
  typography: {
    cpiSelect: 'cpiSelect',
    colsPreviewSpan: 'colsPreview',
    sizeInput: 'sizeInput',
    lhInput: 'lhInput',
    paperSizeSelect: 'paperSizeSelect',
    glyphJitterToggle: 'glyphJitterToggle',
    glyphJitterAmountMin: 'glyphJitterAmountMin',
    glyphJitterAmountMax: 'glyphJitterAmountMax',
    glyphJitterFrequencyMin: 'glyphJitterFrequencyMin',
    glyphJitterFrequencyMax: 'glyphJitterFrequencyMax',
    shuffleGlyphJitterSeedBtn: 'shuffleGlyphJitterSeedBtn',
    lineSlantToggle: 'lineSlantToggle',
    lineSlantMin: 'lineSlantMin',
    lineSlantMax: 'lineSlantMax',
    lineSlantValue: 'lineSlantValue',
    shuffleLineSlantBtn: 'shuffleLineSlantBtn',
  },
  layout: {
    toggleMarginsBtn: 'toggleMarginsBtn',
    showMarginBoxCb: 'showMarginBoxCb',
    wordWrapCb: 'wordWrapCb',
    wordWrapNote: 'wordWrapNote',
    wordWrapRow: 'wordWrapRow',
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
  pageNumbers: {
    pageNumberToggle: 'pageNumberToggle',
    pageNumberOffset: 'pageNumberOffset',
    pageNumberAlignLeft: 'pageNumberAlignLeft',
    pageNumberAlignCenter: 'pageNumberAlignCenter',
    pageNumberAlignRight: 'pageNumberAlignRight',
  },
  appearance: {
    appearanceAuto: 'appearanceAuto',
    appearanceLight: 'appearanceLight',
    appearanceDark: 'appearanceDark',
    darkPageToggle: 'darkPageToggle',
    lagAssistToggle: 'lagAssistToggle',
  },
  typewriter: {
    typewriterToggle: 'realTypewriterToggle',
    typewriterBellSelect: 'typewriterBellSelect',
    typewriterBellPreview: 'typewriterBellPreview',
    typewriterBellVolume: 'typewriterBellVolume',
    typewriterBellVolumeValue: 'typewriterBellVolumeValue',
    typewriterBellLead: 'typewriterBellLead',
    typewriterStopSelect: 'typewriterStopSelect',
    typewriterStopPreview: 'typewriterStopPreview',
    typewriterStopToggle: 'typewriterStopToggle',
    typewriterBackspaceToggle: 'typewriterBackspaceToggle',
    typewriterCaretLockToggle: 'typewriterCaretLockToggle',
    marginReleaseBtn: 'marginReleaseBtn',
    marginReleaseCornerBtn: 'marginReleaseCornerBtn',
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
