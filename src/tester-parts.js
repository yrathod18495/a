// Panel permissions only: hiding a group never removes its artwork from the rig.
// For now every group and every part is open to testers, whatever is saved in Tester Permissions. Set this to true to apply the hide / download switches again.
let enforced = false;
export const setPartRulesEnforced = (on) => { enforced = on === true; };
export const partRulesEnforced = () => enforced;
const denied = (map, base, id) => enforced && deniedRule(map, base, id);
const deniedRule = (map, base, id) => !!(map?.['*']?.includes(id) || (base && map?.[base]?.includes(id)));
export const testerGroupVisible = (rules, base, group) => !enforced || rules?.admin === true || (rules?.verified === true && !denied(rules?.hiddenGroups, base, group));
export const testerLayerDownloadable = (rules, base, layer) => rules?.admin === true || (testerGroupVisible(rules, base, layer.group) && !denied(rules?.blockedDownloads, base, `${layer.slot}|${layer.key}`));
export const testerCanSave = rules => rules?.admin === true;
