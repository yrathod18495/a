// Panel permissions only: hiding a group never removes its artwork from the rig.
const denied = (map, base, id) => !!(map?.['*']?.includes(id) || (base && map?.[base]?.includes(id)));
export const testerGroupVisible = (rules, base, group) => rules?.admin === true || (rules?.verified === true && !denied(rules.hiddenGroups, base, group));
export const testerLayerDownloadable = (rules, base, layer) => rules?.admin === true || (testerGroupVisible(rules, base, layer.group) && !denied(rules.blockedDownloads, base, `${layer.slot}|${layer.key}`));
export const testerCanSave = rules => rules?.admin === true;
