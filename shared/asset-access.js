// Who may use a studio library item (props, effects, backgrounds): by default only paid accounts. An admin can mark single items "free for everyone".
// Everybody still SEES every item (its picture is in the list); a free account just cannot add a paid-only one.
export const LOCKABLE_TYPES = Object.freeze(['background', 'prop', 'effect']);
export const ACCESS_VALUES = Object.freeze(['paid', 'free']);
export const PAID_MESSAGE = 'This item is for paid accounts. Buy Coins to unlock it.';
/** an item with no setting (every item uploaded before this existed) is paid-only */
export const isFreeAsset = (asset) => asset?.access === 'free';
/** can this account not use this item? `tier` is 'free' or 'paid' (admins count as paid) */
export const lockedFor = (asset, tier) => LOCKABLE_TYPES.includes(asset?.type) && !isFreeAsset(asset) && tier !== 'paid';
