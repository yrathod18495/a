export const CREDIT_PLANS = [
  {
    id: 'starter', name: 'Starter', amountPaise: 45000, credits: 500,
    features: ['500 Gold Coins (50 bonus Gold Coins)', 'One-time payment', 'Account-linked Gold Coins balance', 'Payment receipt in your account'],
  },
  {
    id: 'creator', name: 'Creator', amountPaise: 85000, credits: 1000, popular: true,
    features: ['1,000 Gold Coins (150 bonus Gold Coins)', 'One-time payment', 'Account-linked Gold Coins balance', 'Payment receipt in your account'],
  },
  {
    id: 'studio', name: 'Studio', amountPaise: 99900, credits: 1500,
    features: ['1,500 Gold Coins (501 bonus Gold Coins)', 'One-time payment', 'Account-linked Gold Coins balance', 'Payment receipt in your account'],
  },
].map((plan) => ({ ...plan, currency: 'INR', discountPercent: 30, compareAtPaise: Math.round(plan.amountPaise / 0.7) }));

export const publicPlan = ({ id, name, amountPaise, credits, features, popular, currency, discountPercent, compareAtPaise }) => ({
  id, name, amountPaise, credits, features, popular: !!popular, currency, discountPercent, compareAtPaise,
});
